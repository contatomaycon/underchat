FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=8199 \
    APP_DEBUG=false \
    BROWSER_PORT=9222 \
    AUTO_UPDATE_ENABLED=false \
    DISPLAY=:99 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080

ARG APP_UID=10001
ARG APP_GID=10001

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    fluxbox \
    ffmpeg \
    espeak-ng \
    xclip \
    curl \
    tini \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

RUN if [ -d /app/apps/universal_web_api ]; then \
      cp -a /app/apps/universal_web_api/. /app/; \
    fi \
  && cp -a /app/config /app/config.dist \
  && python3 -m pip install --upgrade pip \
  && python3 -m pip install -r requirements.txt \
  && python3 patch_drissionpage.py \
  && mkdir -p /app/chrome_profile /app/image /app/download_images \
  && mkdir -p /data/config /data/chrome_profile /data/image /data/download_images \
  && chown "${APP_UID}:${APP_GID}" /app \
  && chown -R "${APP_UID}:${APP_GID}" /app/config /app/config.dist /app/chrome_profile /app/image /app/download_images /data

USER ${APP_UID}:${APP_GID}

EXPOSE 8199 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${APP_PORT:-8199}/health" || exit 1

ENTRYPOINT ["tini", "--", "/app/docker/entrypoint.sh"]
