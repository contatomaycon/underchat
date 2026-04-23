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

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    fluxbox \
    xclip \
    curl \
    tini \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

RUN cp -a /app/config /app/config.dist \
  && python3 -m pip install --upgrade pip \
  && python3 -m pip install -r requirements.txt \
  && python3 patch_drissionpage.py

VOLUME ["/data/config", "/data/chrome_profile", "/data/image", "/data/download_images"]

EXPOSE 8199 6080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${APP_PORT:-8199}/health" || exit 1

ENTRYPOINT ["tini", "--", "/app/docker/entrypoint.sh"]
