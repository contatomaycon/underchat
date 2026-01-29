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

RUN turbo prune worker_baileys --docker

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

RUN pnpm build:worker_baileys

FROM node:24.12.0-bookworm-slim

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/worker_baileys/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_baileys/package*.json ./apps/worker_baileys
COPY --from=builder /app/packages/proto ./packages/proto

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      curl \
      ca-certificates && \
    update-ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3005

WORKDIR /app/apps/worker_baileys

CMD ["node", "src/index.js"]
