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
    corepack prepare pnpm@10.28.2 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune balancer --docker

FROM turbo AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose
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

RUN pnpm build:balancer
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:24.12.0-bookworm-slim

WORKDIR /app

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/balance_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/balance_api/package*.json ./apps/balance_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales
COPY --from=builder /app/packages/proto ./packages/proto

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3003 50051

ENV UNDERCHAT_ENV_SCOPE=public

WORKDIR /app/apps/balance_api

CMD ["node", "src/index.js"]
