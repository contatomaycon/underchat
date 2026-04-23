"""
app/api/audio.py - OpenAI-compatible audio endpoints
"""

from __future__ import annotations

from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.api.deps import verify_auth
from app.core.config import get_logger
from app.services.audio_service import audio_service, AudioServiceError

logger = get_logger("API.AUDIO")
router = APIRouter(tags=["audio"])


class SpeechRequest(BaseModel):
    model: Optional[str] = Field(default=None)
    input: str = Field(..., min_length=1)
    voice: Optional[str] = Field(default="alloy")
    response_format: Optional[str] = Field(default=None)
    speed: Optional[float] = Field(default=1.0, ge=0.25, le=4.0)


def _as_optional_text(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_optional_float(value: object, *, field_name: str) -> Optional[float]:
    text = _as_optional_text(value)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid float for '{field_name}'.") from exc


@router.post("/v1/audio/transcriptions")
async def create_audio_transcription(
    request: Request,
    authenticated: bool = Depends(verify_auth),
):
    """
    OpenAI-compatible transcription endpoint.
    Accepts multipart/form-data.
    """
    form = await request.form()
    upload = form.get("file")
    if not isinstance(upload, StarletteUploadFile):
        raise HTTPException(status_code=400, detail="Field 'file' is required (multipart/form-data).")

    file_bytes = await upload.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    timestamp_granularities: List[str] = []
    for key in ("timestamp_granularities[]", "timestamp_granularities"):
        for item in form.getlist(key):
            value = _as_optional_text(item)
            if value:
                timestamp_granularities.append(value)

    try:
        result = await run_in_threadpool(
            audio_service.transcribe,
            file_name=upload.filename or "audio",
            file_bytes=file_bytes,
            content_type=upload.content_type or "application/octet-stream",
            model=_as_optional_text(form.get("model")),
            language=_as_optional_text(form.get("language")),
            prompt=_as_optional_text(form.get("prompt")),
            response_format=_as_optional_text(form.get("response_format")),
            temperature=_parse_optional_float(form.get("temperature"), field_name="temperature"),
            timestamp_granularities=timestamp_granularities,
        )
    except AudioServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception as exc:
        logger.error(f"Unhandled transcription error: {exc}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc

    if result.is_json:
        return JSONResponse(content=result.payload)
    return Response(content=result.payload, media_type=result.content_type)


@router.post("/v1/audio/speech")
async def create_audio_speech(
    body: SpeechRequest,
    authenticated: bool = Depends(verify_auth),
):
    """
    OpenAI-compatible text-to-speech endpoint.
    """
    try:
        result = await run_in_threadpool(
            audio_service.create_speech,
            text=body.input,
            voice=body.voice,
            model=body.model,
            response_format=body.response_format,
            speed=body.speed,
        )
    except AudioServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except Exception as exc:
        logger.error(f"Unhandled speech error: {exc}")
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {exc}") from exc

    return Response(
        content=result.payload,
        media_type=result.content_type,
        headers={"Content-Disposition": f'inline; filename="speech.{result.extension}"'},
    )
