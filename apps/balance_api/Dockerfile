FROM node:22.17.0-alpine AS base

FROM base AS turbo

RUN apk update
RUN apk add --no-cache libc6-compat
RUN npm add -g pnpm
RUN npm add -g turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune balancer --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

RUN pnpm install

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:balancer
RUN mkdir -p /build_locales

COPY packages/core/plugins/i18next/locales /build_locales

FROM node:22.17.0-alpine

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/balance_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/balance_api/package*.json ./apps/balance_api
COPY --from=builder /build_locales ./packages/core/plugins/i18next/locales

EXPOSE 3003

WORKDIR /app/apps/balance_api

CMD ["node", "src/index.js"]