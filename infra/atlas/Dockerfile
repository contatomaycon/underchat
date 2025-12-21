FROM node:22.18.0-alpine

WORKDIR /app

RUN apk update && \
    apk add --no-cache \
      bash \
      git \
      curl

RUN mkdir -p /.cache/node/corepack && \
    chmod -R 777 /.cache

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate && \
    npm install -g pnpm@10.14.0

RUN curl -sSf https://atlasgo.sh | sh

COPY . .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose

RUN pnpm install --unsafe-perm

COPY infra/atlas/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app

ENTRYPOINT ["/entrypoint.sh"]