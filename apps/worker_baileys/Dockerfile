FROM node:22.18.0-alpine AS base

FROM base AS turbo

RUN apk update && \
    apk add --no-cache \
      bash \
      git \
      g++ \
      libc6-compat \
      librdkafka-dev \
      make \
      musl-dev \
      python3 \
      pkgconf \
      openssl-dev \
      cyrus-sasl-dev \
      zstd-dev

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate && \
    corepack prepare yarn@4.9.2 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune worker_baileys --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose
RUN pnpm install --unsafe-perm
RUN pnpm rebuild node-rdkafka

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:worker_baileys

FROM node:22.18.0-alpine

RUN apk update && \
    apk add --no-cache \
      lz4 \
      lz4-libs \
      librdkafka \
      cyrus-sasl \
      openssl \
      zstd-libs \
      curl

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/worker_baileys/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_baileys/package*.json ./apps/worker_baileys

EXPOSE 3005

WORKDIR /app/apps/worker_baileys

CMD ["node", "src/index.js"]