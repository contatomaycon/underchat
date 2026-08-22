FROM node:24.12.0-bookworm-slim AS base

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

FROM base AS turbo

ENV TURBO_TELEMETRY_DISABLED=1

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
    corepack prepare pnpm@11.9.0 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune manager --docker

FROM turbo AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN pnpm install --unsafe-perm
RUN RDKAFKA_PATH=$(find /app/node_modules -type d -name "node-rdkafka" 2>/dev/null | head -1) && \
    if [ -z "$RDKAFKA_PATH" ]; then echo "node-rdkafka não encontrado em node_modules"; exit 1; fi && \
    if [ ! -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then \
      (cd "$RDKAFKA_PATH" && npm run install) || (echo "Falha ao compilar node-rdkafka"; exit 1); \
    fi && \
    if [ ! -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then echo "Binding node-librdkafka.node não gerado"; exit 1; fi

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .
COPY packages ./packages
COPY apps/service_api/scripts/assertMessageUpsertArtifact.mjs /app/apps/service_api/scripts/assertMessageUpsertArtifact.mjs

RUN rm -rf /app/apps/manager_api/dist && \
    pnpm build:manager && \
    node /app/apps/service_api/scripts/assertMessageUpsertArtifact.mjs \
      --window-recorder-only \
      /app/apps/manager_api/dist/packages/services/officialWhatsappWebhookWindowRecorder.service.js && \
    OFFICIAL_WINDOW_RECORDER_SHA256="$(sha256sum /app/apps/manager_api/dist/packages/services/officialWhatsappWebhookWindowRecorder.service.js | cut -d ' ' -f 1)" && \
    printf '%s  /app/packages/services/officialWhatsappWebhookWindowRecorder.service.js\n' \
      "$OFFICIAL_WINDOW_RECORDER_SHA256" > /manager-official-window-recorder.sha256
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:24.12.0-bookworm-slim

WORKDIR /app

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/manager_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/manager_api/package*.json ./apps/manager_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales
COPY --from=builder /app/packages/proto ./packages/proto
COPY --from=builder /manager-official-window-recorder.sha256 /usr/local/share/underchat/manager-official-window-recorder.sha256

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-core \
      librdkafka1 \
      curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3002

WORKDIR /app/apps/manager_api

CMD ["sh", "-c", "sha256sum -c /usr/local/share/underchat/manager-official-window-recorder.sha256 && exec node src/index.js"]
