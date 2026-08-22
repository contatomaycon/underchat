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

RUN turbo prune balancer --docker

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

COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruned /app/out/full/ .
COPY packages ./packages
COPY scripts/build-command-heartbeat.mjs ./scripts/build-command-heartbeat.mjs

RUN rm -rf /app/apps/balance_api/dist && \
    UNDERCHAT_COMMAND_HEARTBEAT_LABEL=balance-api-typescript-build \
    UNDERCHAT_COMMAND_HEARTBEAT_INTERVAL_MS=30000 \
    UNDERCHAT_COMMAND_TIMEOUT_MS=1800000 \
    node scripts/build-command-heartbeat.mjs -- \
      node node_modules/typescript/bin/tsc \
        -p apps/balance_api/tsconfig.json && \
    node node_modules/tsc-alias/dist/bin/index.js \
      -p apps/balance_api/tsconfig.json \
      -f \
      -fe .js
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM docker:27-cli AS docker_cli

FROM node:24.12.0-bookworm-slim

WORKDIR /app

ARG TINI_VERSION=0.19.0-1+b3

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/balance_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/balance_api/package*.json ./apps/balance_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales
COPY --from=builder /app/packages/proto ./packages/proto
COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker /usr/local/libexec/docker
COPY scripts/worker-liveness-conditional-remove.sh /app/scripts/worker-liveness-conditional-remove.sh
COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck
COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      curl \
      ca-certificates \
      coreutils \
      util-linux \
      tini="${TINI_VERSION}" && \
    update-ca-certificates && \
    test -s /etc/ssl/certs/ca-certificates.crt && \
    test "$(dpkg-query -W -f='${Version}' tini)" = "${TINI_VERSION}" && \
    test -x /usr/bin/tini && \
    chmod 0755 \
      /app/scripts/worker-liveness-conditional-remove.sh \
      /usr/local/bin/worker-liveness-healthcheck \
      /usr/local/bin/worker-liveness-entrypoint && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3003 50051

ENV UNDERCHAT_ENV_SCOPE=public \
    BALANCE_API_SHUTDOWN_TIMEOUT_MS=8000 \
    UNDERCHAT_LIVENESS_HEALTH_URL=http://127.0.0.1:3003/v1/health/check

WORKDIR /app/apps/balance_api

HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3 \
  CMD ["/usr/local/bin/worker-liveness-healthcheck"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]
CMD ["node", "src/index.js"]
