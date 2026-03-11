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

RUN turbo prune worker_wwebjs --docker

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

RUN pnpm build:worker_wwebjs

FROM node:24.12.0-bookworm-slim

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/worker_wwebjs/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_wwebjs/package*.json ./apps/worker_wwebjs
COPY --from=builder /app/packages/proto ./packages/proto
COPY apps/worker_wwebjs/docker-entrypoint.sh /usr/local/bin/worker-wwebjs-entrypoint.sh

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      curl \
      ca-certificates \
      chromium \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      xdg-utils && \
    update-ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN chmod +x /usr/local/bin/worker-wwebjs-entrypoint.sh

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3005 50052

WORKDIR /app/apps/worker_wwebjs

CMD ["/usr/local/bin/worker-wwebjs-entrypoint.sh", "node", "src/index.js"]
