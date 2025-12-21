FROM node:22.18.0-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      git \
      curl \
      ca-certificates && \
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

COPY infra/atlas/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/entrypoint.sh"]