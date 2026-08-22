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
    npm add -g turbo@2.10.0
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune worker_baileys --docker

FROM turbo AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN pnpm install --frozen-lockfile --unsafe-perm
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
COPY scripts/prepare-worker-runtime.mjs ./scripts/prepare-worker-runtime.mjs
COPY scripts/worker-runtime-kafka-boundary.cjs ./scripts/worker-runtime-kafka-boundary.cjs

RUN rm -rf apps/worker_baileys/dist && \
    node node_modules/typescript/bin/tsc \
      -p apps/worker_baileys/tsconfig.json && \
    node node_modules/tsc-alias/dist/bin/index.js \
      -p apps/worker_baileys/tsconfig.json \
      -f \
      -fe .js
RUN node scripts/prepare-worker-runtime.mjs \
      --dist apps/worker_baileys/dist \
      --node-modules node_modules

FROM node:24.12.0-bookworm-slim

WORKDIR /app

ARG TINI_VERSION=0.19.0-1+b3

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/worker_baileys/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_baileys/package*.json ./apps/worker_baileys
COPY --from=builder /app/packages/proto ./packages/proto
COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck
COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      tini="${TINI_VERSION}" \
      curl \
      ca-certificates && \
    chmod +x \
      /usr/local/bin/worker-liveness-healthcheck \
      /usr/local/bin/worker-liveness-entrypoint && \
    test "$(dpkg-query -W -f='${Version}' tini)" = "${TINI_VERSION}" && \
    test -x /usr/bin/tini && \
    update-ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3005 50052

ENV NODE_ENV=production \
    UNDERCHAT_ENV_SCOPE=public

WORKDIR /app/apps/worker_baileys

HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3 \
  CMD ["/usr/local/bin/worker-liveness-healthcheck"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]
CMD ["node", "src/index.js"]
