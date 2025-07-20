FROM node:22.17.0-alpine AS base

FROM base AS turbo

RUN apk update && \
    apk add --no-cache \
      bash \
      python3 \
      make \
      g++ \
      libc6-compat \
      librdkafka-dev \
      musl-dev

RUN npm add -g pnpm turbo
 
FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune socket --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

RUN pnpm install

FROM deps AS builder

WORKDIR /app

COPY --from=deps /app/node_modules/ .
COPY --from=pruned /app/out/full/ .

RUN pnpm build:socket

FROM node:22.17.0-alpine

WORKDIR /app

COPY .env ./

COPY --from=builder /app/apps/socket_io/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/socket_io/package*.json ./apps/socket_io

EXPOSE 3005

WORKDIR /app/apps/socket_io

CMD ["node", "src/index.js"]