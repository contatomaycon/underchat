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

RUN turbo prune worker_wwebjs --docker

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
COPY scripts/prepare-worker-runtime.mjs ./scripts/prepare-worker-runtime.mjs
COPY scripts/worker-runtime-kafka-boundary.cjs ./scripts/worker-runtime-kafka-boundary.cjs

RUN rm -rf apps/worker_wwebjs/dist && \
    node node_modules/typescript/bin/tsc \
      -p apps/worker_wwebjs/tsconfig.json && \
    node node_modules/tsc-alias/dist/bin/index.js \
      -p apps/worker_wwebjs/tsconfig.json \
      -f \
      -fe .js
RUN UNDERCHAT_ENV_SCOPE=public node --input-type=module -e \
      "await import('reflect-metadata'); const bridge = await import('@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js'); if (typeof bridge.normalizeCanonicalProjection !== 'function') process.exit(1); await import('./apps/worker_wwebjs/dist/packages/services/wwebjs/methods/connection.service.js'); await import('./apps/worker_wwebjs/dist/packages/services/wwebjs/methods/postgresSessionStore.js')"
RUN node scripts/prepare-worker-runtime.mjs \
      --dist apps/worker_wwebjs/dist \
      --node-modules node_modules

FROM node:24.12.0-bookworm-slim AS runtime-base

WORKDIR /app

ARG TINI_VERSION=0.19.0-1+b3

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/worker_wwebjs/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_wwebjs/package*.json ./apps/worker_wwebjs
COPY --from=builder /app/packages/proto ./packages/proto
COPY apps/worker_wwebjs/docker-entrypoint.sh /usr/local/bin/worker-wwebjs-entrypoint.sh
COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck
COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      librdkafka1 \
      util-linux \
      tini="${TINI_VERSION}" \
      curl \
      gnupg \
      ca-certificates \
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
    mkdir -p /usr/share/keyrings && \
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      google-chrome-stable && \
    test "$(dpkg-query -W -f='${Version}' tini)" = "${TINI_VERSION}" && \
    test -x /usr/bin/tini && \
    test "$(od -An -tx1 -N4 /usr/bin/tini | tr -d ' \n')" = "7f454c46" && \
    test -x /opt/google/chrome/chrome && \
    test "$(od -An -tx1 -N4 /opt/google/chrome/chrome | tr -d ' \n')" = "7f454c46" && \
    update-ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/bin/google-chrome-stable /usr/bin/chrome && \
    ln -sf /usr/bin/google-chrome-stable /usr/bin/google-chrome

RUN chmod +x \
    /usr/local/bin/worker-wwebjs-entrypoint.sh \
    /usr/local/bin/worker-liveness-healthcheck \
    /usr/local/bin/worker-liveness-entrypoint

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/opt/google/chrome/chrome \
    CHROME_BIN=/opt/google/chrome/chrome \
    CHROME_PATH=/opt/google/chrome/chrome \
    CHROME_WRAPPER=/opt/google/chrome/google-chrome \
    CHROME_VERSION_EXTRA=stable \
    GNOME_DISABLE_CRASH_DIALOG=SET_BY_GOOGLE_CHROME \
    NODE_ENV=production \
    UNDERCHAT_ENV_SCOPE=public

EXPOSE 3005 50053

WORKDIR /app/apps/worker_wwebjs

HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3 \
  CMD ["/usr/local/bin/worker-liveness-healthcheck"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]
CMD ["node", "src/index.js"]

FROM runtime-base AS browser-reaper-contract

COPY apps/worker_wwebjs/browser-reaper.contract.mjs /usr/local/libexec/underchat/browser-reaper.contract.mjs

CMD ["node", "/usr/local/libexec/underchat/browser-reaper.contract.mjs"]

FROM runtime-base AS runtime
