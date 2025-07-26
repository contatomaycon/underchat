FROM node:22.17.0-alpine AS base

FROM base AS turbo

RUN apk update && \
    apk add --no-cache \
      bash \
      g++ \
      libc6-compat \
      librdkafka-dev \
      make \
      musl-dev \
      python3

RUN npm add -g pnpm turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune worker_baileys --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

RUN pnpm install

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:worker_baileys

FROM node:22.17.0-alpine

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/worker_baileys/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/worker_baileys/package*.json ./apps/worker_baileys

EXPOSE 3005

WORKDIR /app/apps/worker_baileys

CMD ["node", "src/index.js"]