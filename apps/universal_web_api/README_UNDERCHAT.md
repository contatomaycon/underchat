# Underchat Integration Notes

This workspace is a pinned snapshot of `lumingya/universal-web-api`.

## Upstream

- Repo: `https://github.com/lumingya/universal-web-api`
- Commit: `103bfe26f3a7a780a938f1f060012da8a64440ce`

## Local Scripts

- `python3 scripts/check_syntax.py`
- `docker build -f Dockerfile -t underchat/universal-web-api:latest .`

## Production Container

Exposed ports:

- `8199` API
- `6080` noVNC

OpenAI-compatible audio endpoints:

- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`

Backend strategy (configurable):

- `AUDIO_TRANSCRIPTION_MODE=auto|api|local` (`local` uses `faster-whisper`)
- `AUDIO_SPEECH_MODE=auto|api|local` (`local` uses `espeak-ng` + `ffmpeg`)

Persistent volumes:

- `/data/config`
- `/data/chrome_profile`
- `/data/image`
- `/data/download_images`

Example run:

```bash
docker run -d --name underchat-uwa \
  -p 8199:8199 \
  -p 6080:6080 \
  -e APP_HOST=0.0.0.0 \
  -e APP_PORT=8199 \
  -e BROWSER_PORT=9222 \
  -e NOVNC_PORT=6080 \
  -e VNC_PORT=5900 \
  -e AUTO_UPDATE_ENABLED=false \
  -v /opt/uwa/config:/data/config \
  -v /opt/uwa/chrome_profile:/data/chrome_profile \
  -v /opt/uwa/image:/data/image \
  -v /opt/uwa/download_images:/data/download_images \
  underchat/universal-web-api:latest
```

Optional VNC password:

- Set `VNC_PASSWORD=<your-password>`

Access noVNC:

- `http://<host>:6080/vnc.html`
