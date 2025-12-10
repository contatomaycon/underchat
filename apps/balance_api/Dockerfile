FROM node:22.18.0-alpine AS base

FROM base AS turbo

RUN apk update && \
    apk add --no-cache \
      bash \
      git \
      g++ \
      libc6-compat \
      make \
      musl-dev \
      python3 \
      pkgconf \
      openssl-dev \
      cyrus-sasl-dev \
      zstd-dev \
      curl \
      openssh-client

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate && \
    corepack prepare yarn@4.9.2 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune balancer --docker

FROM pruned AS deps

RUN apk update && \
    apk add --no-cache openssh-client

WORKDIR /app

COPY --from=pruned /app/out/json/ .
COPY --from=pruned /app/infra/ssh/docker_key /tmp/docker_key
COPY --from=pruned /app/infra/ssh/known_hosts /tmp/known_hosts

RUN mkdir -p ~/.ssh && \
    cp /tmp/docker_key ~/.ssh/id_rsa && \
    chmod 600 ~/.ssh/id_rsa && \
    cp /tmp/known_hosts ~/.ssh/known_hosts && \
    chmod 644 ~/.ssh/known_hosts && \
    eval "$(ssh-agent -s)" > /dev/null && \
    ssh-add ~/.ssh/id_rsa 2>/dev/null || true && \
    git config --global url."git@github.com:".insteadOf "https://github.com/" || true && \
    git config --global url."git@gitlab.com:".insteadOf "https://gitlab.com/" || true

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose
RUN pnpm install --unsafe-perm

RUN rm -rf ~/.ssh/id_rsa ~/.ssh/known_hosts /tmp/docker_key && \
    ssh-add -D 2>/dev/null || true

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:balancer
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:22.18.0-alpine

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/balance_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/balance_api/package*.json ./apps/balance_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales

EXPOSE 3003

WORKDIR /app/apps/balance_api

CMD ["node", "src/index.js"]
