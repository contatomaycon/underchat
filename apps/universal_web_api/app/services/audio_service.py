"""
app/services/audio_service.py - Audio transcription and speech services
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.core.config import AppConfig, get_logger

logger = get_logger("SERVICE.AUDIO")

_TRANSCRIPTION_RESPONSE_FORMATS = {"json", "text", "srt", "verbose_json", "vtt"}
_SPEECH_RESPONSE_FORMATS = {"mp3", "opus", "aac", "flac", "wav", "pcm"}

_SPEECH_CONTENT_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/L16",
}

_OPENAI_VOICE_ALIASES = {
    "alloy": "en-us",
    "ash": "en-us",
    "ballad": "en",
    "coral": "en-us",
    "echo": "en-us",
    "fable": "en-gb",
    "nova": "en-us+f3",
    "onyx": "en-us+m3",
    "sage": "en",
    "shimmer": "en-us+f2",
    "verse": "en",
    "cove": "en-us",
}


class AudioServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class AudioTranscriptionResponse:
    payload: Any
    is_json: bool
    content_type: str


@dataclass
class AudioSpeechResponse:
    payload: bytes
    content_type: str
    extension: str


class AudioService:
    def __init__(self) -> None:
        self._local_models: Dict[Tuple[str, str, str], Any] = {}
        self._local_models_lock = threading.Lock()

    def transcribe(
        self,
        *,
        file_name: str,
        file_bytes: bytes,
        content_type: str,
        model: Optional[str],
        language: Optional[str],
        prompt: Optional[str],
        response_format: Optional[str],
        temperature: Optional[float],
        timestamp_granularities: Optional[List[str]],
    ) -> AudioTranscriptionResponse:
        if not file_bytes:
            raise AudioServiceError("Audio file is empty.", status_code=400)

        fmt = (response_format or "json").strip().lower()
        if fmt not in _TRANSCRIPTION_RESPONSE_FORMATS:
            raise AudioServiceError(
                f"Unsupported response_format '{fmt}'.",
                status_code=400,
            )

        mode = AppConfig.get_audio_transcription_mode()
        last_error: Optional[AudioServiceError] = None

        should_try_api = mode == "api" or (mode == "auto" and self._is_transcription_api_configured())
        if should_try_api:
            try:
                return self._transcribe_via_api(
                    file_name=file_name,
                    file_bytes=file_bytes,
                    content_type=content_type,
                    model=model,
                    language=language,
                    prompt=prompt,
                    response_format=fmt,
                    temperature=temperature,
                    timestamp_granularities=timestamp_granularities,
                )
            except AudioServiceError as exc:
                last_error = exc
                logger.warning(f"[audio/transcribe] API backend failed: {exc.message}")
                if mode == "api":
                    raise

        if mode in ("local", "auto"):
            try:
                return self._transcribe_local(
                    file_name=file_name,
                    file_bytes=file_bytes,
                    model=model,
                    language=language,
                    prompt=prompt,
                    response_format=fmt,
                    temperature=temperature,
                )
            except AudioServiceError as exc:
                last_error = exc
                logger.warning(f"[audio/transcribe] Local backend failed: {exc.message}")
                if mode == "local":
                    raise

        if last_error is not None:
            raise last_error

        raise AudioServiceError(
            "No audio transcription backend available. Configure AUDIO_TRANSCRIPTION_MODE or backend credentials.",
            status_code=503,
        )

    def create_speech(
        self,
        *,
        text: str,
        voice: Optional[str],
        model: Optional[str],
        response_format: Optional[str],
        speed: Optional[float],
    ) -> AudioSpeechResponse:
        normalized_text = (text or "").strip()
        if not normalized_text:
            raise AudioServiceError("Field 'input' must not be empty.", status_code=400)

        fmt = (response_format or AppConfig.get_audio_speech_default_format()).strip().lower()
        if fmt not in _SPEECH_RESPONSE_FORMATS:
            raise AudioServiceError(
                f"Unsupported response_format '{fmt}'.",
                status_code=400,
            )

        mode = AppConfig.get_audio_speech_mode()
        last_error: Optional[AudioServiceError] = None

        should_try_api = mode == "api" or (mode == "auto" and self._is_speech_api_configured())
        if should_try_api:
            try:
                return self._speech_via_api(
                    text=normalized_text,
                    voice=voice,
                    model=model,
                    response_format=fmt,
                    speed=speed,
                )
            except AudioServiceError as exc:
                last_error = exc
                logger.warning(f"[audio/speech] API backend failed: {exc.message}")
                if mode == "api":
                    raise

        if mode in ("local", "auto"):
            try:
                return self._speech_local(
                    text=normalized_text,
                    voice=voice,
                    response_format=fmt,
                    speed=speed,
                )
            except AudioServiceError as exc:
                last_error = exc
                logger.warning(f"[audio/speech] Local backend failed: {exc.message}")
                if mode == "local":
                    raise

        if last_error is not None:
            raise last_error

        raise AudioServiceError(
            "No audio speech backend available. Configure AUDIO_SPEECH_MODE or backend credentials.",
            status_code=503,
        )

    def _transcribe_via_api(
        self,
        *,
        file_name: str,
        file_bytes: bytes,
        content_type: str,
        model: Optional[str],
        language: Optional[str],
        prompt: Optional[str],
        response_format: str,
        temperature: Optional[float],
        timestamp_granularities: Optional[List[str]],
    ) -> AudioTranscriptionResponse:
        base_url = AppConfig.get_audio_transcription_base_url().rstrip("/")
        api_key = AppConfig.get_audio_transcription_api_key().strip()

        if not base_url:
            raise AudioServiceError(
                "AUDIO_TRANSCRIPTION_BASE_URL is required for API transcription backend.",
                status_code=503,
            )
        if not api_key:
            raise AudioServiceError(
                "AUDIO_TRANSCRIPTION_API_KEY (or OPENAI_API_KEY) is required for API transcription backend.",
                status_code=503,
            )

        target_url = f"{base_url}/v1/audio/transcriptions"
        resolved_model = (model or AppConfig.get_audio_transcription_model()).strip()

        form_data: List[Tuple[str, str]] = [("model", resolved_model), ("response_format", response_format)]
        if language:
            form_data.append(("language", language))
        if prompt:
            form_data.append(("prompt", prompt))
        if temperature is not None:
            form_data.append(("temperature", str(temperature)))
        for item in timestamp_granularities or []:
            if item:
                form_data.append(("timestamp_granularities[]", str(item)))

        files = {
            "file": (
                file_name or "audio",
                file_bytes,
                content_type or "application/octet-stream",
            )
        }
        headers = {"Authorization": f"Bearer {api_key}"}

        try:
            resp = requests.post(
                target_url,
                data=form_data,
                files=files,
                headers=headers,
                timeout=AppConfig.get_audio_api_timeout(),
            )
        except requests.RequestException as exc:
            raise AudioServiceError(f"Transcription API request failed: {exc}", status_code=502)

        if resp.status_code >= 400:
            detail = self._extract_error_message(resp)
            raise AudioServiceError(detail, status_code=resp.status_code)

        if response_format in ("json", "verbose_json"):
            try:
                payload = resp.json()
            except ValueError:
                payload = {"text": resp.text}
            return AudioTranscriptionResponse(payload=payload, is_json=True, content_type="application/json")

        return AudioTranscriptionResponse(
            payload=resp.text,
            is_json=False,
            content_type="text/plain; charset=utf-8",
        )

    def _transcribe_local(
        self,
        *,
        file_name: str,
        file_bytes: bytes,
        model: Optional[str],
        language: Optional[str],
        prompt: Optional[str],
        response_format: str,
        temperature: Optional[float],
    ) -> AudioTranscriptionResponse:
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:
            raise AudioServiceError(
                "Local transcription backend requires 'faster-whisper'.",
                status_code=503,
            ) from exc

        suffix = Path(file_name or "audio").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
            tmp_file.write(file_bytes)
            tmp_path = tmp_file.name

        try:
            local_model_name = (model or "").strip()
            if not local_model_name or local_model_name == "whisper-1":
                local_model_name = AppConfig.get_audio_transcription_local_model()

            whisper_model = self._get_or_create_local_model(WhisperModel, local_model_name)
            segments_iter, info = whisper_model.transcribe(
                tmp_path,
                language=language or None,
                initial_prompt=prompt or None,
                temperature=temperature if temperature is not None else 0.0,
            )

            segments: List[Dict[str, Any]] = []
            collected_text: List[str] = []
            for idx, seg in enumerate(list(segments_iter)):
                segment_text = (seg.text or "").strip()
                collected_text.append(segment_text)
                segments.append(
                    {
                        "id": idx,
                        "seek": 0,
                        "start": float(seg.start),
                        "end": float(seg.end),
                        "text": segment_text,
                        "tokens": [],
                        "temperature": float(temperature if temperature is not None else 0.0),
                        "avg_logprob": 0.0,
                        "compression_ratio": 0.0,
                        "no_speech_prob": 0.0,
                    }
                )

            full_text = " ".join(item for item in collected_text if item).strip()
            if response_format == "json":
                return AudioTranscriptionResponse(
                    payload={"text": full_text},
                    is_json=True,
                    content_type="application/json",
                )
            if response_format == "verbose_json":
                payload = {
                    "task": "transcribe",
                    "language": str(getattr(info, "language", "") or language or ""),
                    "duration": float(getattr(info, "duration", 0.0) or 0.0),
                    "text": full_text,
                    "segments": segments,
                }
                return AudioTranscriptionResponse(
                    payload=payload,
                    is_json=True,
                    content_type="application/json",
                )
            if response_format == "srt":
                return AudioTranscriptionResponse(
                    payload=self._segments_to_srt(segments),
                    is_json=False,
                    content_type="text/plain; charset=utf-8",
                )
            if response_format == "vtt":
                return AudioTranscriptionResponse(
                    payload=self._segments_to_vtt(segments),
                    is_json=False,
                    content_type="text/vtt; charset=utf-8",
                )

            return AudioTranscriptionResponse(
                payload=full_text,
                is_json=False,
                content_type="text/plain; charset=utf-8",
            )
        except AudioServiceError:
            raise
        except Exception as exc:
            raise AudioServiceError(f"Local transcription failed: {exc}", status_code=500) from exc
        finally:
            with contextlib.suppress(Exception):
                os.remove(tmp_path)

    def _speech_via_api(
        self,
        *,
        text: str,
        voice: Optional[str],
        model: Optional[str],
        response_format: str,
        speed: Optional[float],
    ) -> AudioSpeechResponse:
        base_url = AppConfig.get_audio_speech_base_url().rstrip("/")
        api_key = AppConfig.get_audio_speech_api_key().strip()

        if not base_url:
            raise AudioServiceError(
                "AUDIO_SPEECH_BASE_URL is required for API speech backend.",
                status_code=503,
            )
        if not api_key:
            raise AudioServiceError(
                "AUDIO_SPEECH_API_KEY (or OPENAI_API_KEY) is required for API speech backend.",
                status_code=503,
            )

        target_url = f"{base_url}/v1/audio/speech"
        payload: Dict[str, Any] = {
            "model": (model or AppConfig.get_audio_speech_model()).strip(),
            "input": text,
            "voice": (voice or "alloy").strip(),
            "response_format": response_format,
        }
        if speed is not None:
            payload["speed"] = float(speed)

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            resp = requests.post(
                target_url,
                json=payload,
                headers=headers,
                timeout=AppConfig.get_audio_api_timeout(),
            )
        except requests.RequestException as exc:
            raise AudioServiceError(f"Speech API request failed: {exc}", status_code=502)

        if resp.status_code >= 400:
            detail = self._extract_error_message(resp)
            raise AudioServiceError(detail, status_code=resp.status_code)

        content_type = (resp.headers.get("content-type") or "").strip()
        if not content_type:
            content_type = _SPEECH_CONTENT_TYPES.get(response_format, "application/octet-stream")

        return AudioSpeechResponse(
            payload=resp.content,
            content_type=content_type,
            extension=response_format,
        )

    def _speech_local(
        self,
        *,
        text: str,
        voice: Optional[str],
        response_format: str,
        speed: Optional[float],
    ) -> AudioSpeechResponse:
        voice_name = self._resolve_local_voice(voice)
        rate = self._resolve_speech_rate(speed)

        with tempfile.TemporaryDirectory(prefix="audio_speech_") as work_dir:
            wav_path = Path(work_dir) / "speech.wav"
            cmd = [
                "espeak-ng",
                "-w",
                str(wav_path),
                "-v",
                voice_name,
                "-s",
                str(rate),
                "--stdin",
            ]
            try:
                subprocess.run(
                    cmd,
                    input=text.encode("utf-8"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
            except FileNotFoundError as exc:
                raise AudioServiceError(
                    "Local speech backend requires 'espeak-ng' binary.",
                    status_code=503,
                ) from exc
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
                raise AudioServiceError(
                    f"Local speech generation failed: {stderr or 'espeak-ng error'}",
                    status_code=500,
                ) from exc

            if response_format == "wav":
                payload = wav_path.read_bytes()
                return AudioSpeechResponse(
                    payload=payload,
                    content_type=_SPEECH_CONTENT_TYPES["wav"],
                    extension="wav",
                )

            out_path = Path(work_dir) / f"speech.{response_format}"
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(wav_path),
                "-ac",
                "1",
                "-ar",
                "24000",
            ]

            if response_format == "mp3":
                ffmpeg_cmd += ["-b:a", "96k", str(out_path)]
            elif response_format == "aac":
                ffmpeg_cmd += ["-c:a", "aac", "-b:a", "128k", str(out_path)]
            elif response_format == "opus":
                ffmpeg_cmd += ["-c:a", "libopus", "-b:a", "48k", str(out_path)]
            elif response_format == "flac":
                ffmpeg_cmd += ["-c:a", "flac", str(out_path)]
            elif response_format == "pcm":
                ffmpeg_cmd += ["-f", "s16le", "-c:a", "pcm_s16le", str(out_path)]
            else:
                raise AudioServiceError(
                    f"Unsupported local speech format '{response_format}'.",
                    status_code=400,
                )

            try:
                subprocess.run(
                    ffmpeg_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                )
            except FileNotFoundError as exc:
                raise AudioServiceError(
                    "Local speech backend requires 'ffmpeg' binary.",
                    status_code=503,
                ) from exc
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
                raise AudioServiceError(
                    f"Local speech conversion failed: {stderr or 'ffmpeg error'}",
                    status_code=500,
                ) from exc

            return AudioSpeechResponse(
                payload=out_path.read_bytes(),
                content_type=_SPEECH_CONTENT_TYPES.get(response_format, "application/octet-stream"),
                extension=response_format,
            )

    def _get_or_create_local_model(self, whisper_model_cls: Any, model_name: str) -> Any:
        key = (
            model_name,
            AppConfig.get_audio_transcription_device(),
            AppConfig.get_audio_transcription_compute_type(),
        )
        if key in self._local_models:
            return self._local_models[key]

        with self._local_models_lock:
            if key in self._local_models:
                return self._local_models[key]

            logger.info(
                "[audio/transcribe] Loading local Whisper model "
                f"model={key[0]} device={key[1]} compute_type={key[2]}"
            )
            model = whisper_model_cls(
                model_size_or_path=key[0],
                device=key[1],
                compute_type=key[2],
            )
            self._local_models[key] = model
            return model

    @staticmethod
    def _extract_error_message(resp: requests.Response) -> str:
        prefix = f"Upstream audio API failed with status {resp.status_code}"
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict):
                    message = str(error.get("message") or "").strip()
                    if message:
                        return f"{prefix}: {message}"
                detail = str(payload.get("detail") or "").strip()
                if detail:
                    return f"{prefix}: {detail}"
        except ValueError:
            pass

        body = (resp.text or "").strip()
        if body:
            return f"{prefix}: {body[:500]}"
        return prefix

    @staticmethod
    def _segments_to_srt(segments: List[Dict[str, Any]]) -> str:
        rows: List[str] = []
        for idx, segment in enumerate(segments, start=1):
            start = AudioService._format_timestamp(float(segment["start"]), use_comma=True)
            end = AudioService._format_timestamp(float(segment["end"]), use_comma=True)
            text = str(segment.get("text") or "").strip()
            rows.append(f"{idx}\n{start} --> {end}\n{text}\n")
        return "\n".join(rows).strip() + "\n"

    @staticmethod
    def _segments_to_vtt(segments: List[Dict[str, Any]]) -> str:
        rows: List[str] = ["WEBVTT", ""]
        for segment in segments:
            start = AudioService._format_timestamp(float(segment["start"]), use_comma=False)
            end = AudioService._format_timestamp(float(segment["end"]), use_comma=False)
            text = str(segment.get("text") or "").strip()
            rows.append(f"{start} --> {end}")
            rows.append(text)
            rows.append("")
        return "\n".join(rows).strip() + "\n"

    @staticmethod
    def _format_timestamp(seconds: float, use_comma: bool) -> str:
        safe_seconds = max(0.0, float(seconds))
        hours = int(safe_seconds // 3600)
        minutes = int((safe_seconds % 3600) // 60)
        secs = int(safe_seconds % 60)
        millis = int(round((safe_seconds - int(safe_seconds)) * 1000))

        if millis >= 1000:
            millis -= 1000
            secs += 1
            if secs >= 60:
                secs = 0
                minutes += 1
                if minutes >= 60:
                    minutes = 0
                    hours += 1

        separator = "," if use_comma else "."
        return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"

    @staticmethod
    def _resolve_local_voice(voice: Optional[str]) -> str:
        requested = (voice or "").strip().lower()
        if not requested:
            requested = AppConfig.get_audio_speech_local_voice().strip().lower()
        if not requested:
            return "en-us"
        return _OPENAI_VOICE_ALIASES.get(requested, requested)

    @staticmethod
    def _resolve_speech_rate(speed: Optional[float]) -> int:
        base_rate = 175.0
        normalized_speed = 1.0 if speed is None else float(speed)
        normalized_speed = max(0.25, min(4.0, normalized_speed))
        rate = int(round(base_rate * normalized_speed))
        return max(80, min(450, rate))

    @staticmethod
    def _is_transcription_api_configured() -> bool:
        return bool(
            AppConfig.get_audio_transcription_base_url().strip()
            and AppConfig.get_audio_transcription_api_key().strip()
        )

    @staticmethod
    def _is_speech_api_configured() -> bool:
        return bool(
            AppConfig.get_audio_speech_base_url().strip()
            and AppConfig.get_audio_speech_api_key().strip()
        )


audio_service = AudioService()
