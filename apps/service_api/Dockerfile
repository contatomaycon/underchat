FROM node:24.12.0-bookworm-slim AS base

FROM base AS turbo

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      git \
      g++ \
      make \
      python3 \
      pkg-config \
      libssl-dev \
      libsasl2-dev \
      librdkafka-dev \
      zlib1g-dev \
      libzstd-dev \
      zstd \
      curl \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate && \
    corepack prepare yarn@4.9.2 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune service --docker

FROM turbo AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose
RUN pnpm install --unsafe-perm
RUN RDKAFKA_PATH=$(find node_modules/.pnpm/node-rdkafka@* -type d -name "node-rdkafka" -path "*/node_modules/node-rdkafka" | head -1) && \
    if [ -n "$RDKAFKA_PATH" ] && [ ! -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then \
      cd "$RDKAFKA_PATH" && npm run install; \
    fi

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .
COPY packages ./packages

RUN pnpm build:service
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:24.12.0-bookworm-slim

WORKDIR /app

COPY --from=builder /app/apps/service_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/service_api/package*.json ./apps/service_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales

RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      librdkafka1 \
      curl \
      wget \
      gnupg \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      fonts-symbola \
      fontconfig \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgcc1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      lsb-release \
      xdg-utils && \
    mkdir -p /usr/share/keyrings && \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      google-chrome-stable && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/bin/google-chrome-stable /usr/bin/chrome && \
    ln -sf /usr/bin/google-chrome-stable /usr/bin/google-chrome && \
    fc-cache -f -v

RUN mkdir -p /home/pptruser/Downloads \
    /home/pptruser/.local/share/applications \
    /home/pptruser/.local/share/mime \
    /home/pptruser/.config \
    /home/pptruser/.cache \
    /tmp/.chrome-user-data \
    /tmp/.chrome-crashpad \
    /app && \
    chown -R pptruser:pptruser /home/pptruser /tmp/.chrome-user-data /tmp/.chrome-crashpad /app && \
    chmod -R 755 /home/pptruser/.local/share

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    CHROME_BIN=/usr/bin/google-chrome-stable \
    CHROME_PATH=/usr/bin/google-chrome-stable \
    HOME=/home/pptruser \
    XDG_CONFIG_HOME=/home/pptruser/.config \
    XDG_CACHE_HOME=/home/pptruser/.cache \
    XDG_DATA_HOME=/home/pptruser/.local/share \
    XDG_RUNTIME_DIR=/tmp \
    TMPDIR=/tmp \
    CHROME_CRASHPAD_DATABASE_PATH=/tmp/.chrome-crashpad

USER pptruser

EXPOSE 3004

WORKDIR /app/apps/service_api

CMD ["node", "src/index.js"]
