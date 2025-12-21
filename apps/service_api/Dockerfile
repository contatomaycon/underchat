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

RUN turbo prune service --docker

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

RUN pnpm build:service
RUN mkdir -p /build_locales

COPY packages/plugins/i18next/locales /build_locales

FROM node:22.18.0-alpine

WORKDIR /app

COPY --from=builder /app/apps/service_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/service_api/package*.json ./apps/service_api
COPY --from=builder /build_locales ./packages/plugins/i18next/locales

RUN apk update && \
    apk add --no-cache \
      ffmpeg \
      curl \
      libc6-compat

EXPOSE 3004

WORKDIR /app/apps/service_api

CMD ["node", "src/index.js"]