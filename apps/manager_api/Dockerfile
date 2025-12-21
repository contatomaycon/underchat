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
      curl

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate && \
    corepack prepare yarn@4.9.2 --activate && \
    npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune manager --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV npm_config_build_from_source=true \
    npm_config_loglevel=verbose
RUN pnpm install --unsafe-perm

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:manager
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:22.18.0-alpine

WORKDIR /app

COPY --from=builder /app/apps/manager_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/manager_api/package*.json ./apps/manager_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales

RUN apk update && \
    apk add --no-cache \
      ffmpeg \
      curl

RUN curl -sSf https://atlasgo.sh | sh

EXPOSE 3002

WORKDIR /app/apps/manager_api

CMD ["node", "src/index.js"]