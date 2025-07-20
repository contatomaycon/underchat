FROM node:22.17.0-alpine AS base

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

WORKDIR /app
COPY . .
RUN turbo prune socket --docker

FROM base AS deps
WORKDIR /app
COPY --from=base /app/out/json/ ./
RUN pnpm install

FROM deps AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=base /app/out/full/     ./
RUN pnpm build:socket

FROM node:22.17.0-alpine AS runner
WORKDIR /app
COPY --from=builder /app/apps/socket_io/dist ./dist
COPY --from=builder /app/node_modules    ./node_modules
COPY --from=builder /app/apps/socket_io/package*.json ./

EXPOSE 3005
CMD ["node", "dist/index.js"]
