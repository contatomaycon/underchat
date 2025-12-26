FROM node:22.18.0-bookworm-slim

WORKDIR /app

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
      curl \
      ca-certificates \
      procps && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /.cache/node/corepack && \
    chmod -R 777 /.cache

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate

RUN curl -sSf https://atlasgo.sh | sh

COPY . .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose

RUN pnpm install --unsafe-perm
RUN RDKAFKA_PATH=$(find node_modules/.pnpm/node-rdkafka@* -type d -name "node-rdkafka" -path "*/node_modules/node-rdkafka" | head -1) && \
    if [ -n "$RDKAFKA_PATH" ] && [ ! -f "$RDKAFKA_PATH/build/Release/node-librdkafka.node" ]; then \
      cd "$RDKAFKA_PATH" && npm run install; \
    fi

COPY infra/atlas/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/entrypoint.sh"]