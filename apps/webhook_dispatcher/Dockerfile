FROM node:24.12.0-bookworm-slim AS tooling

ENV TURBO_TELEMETRY_DISABLED=1

RUN corepack enable && \
    corepack prepare pnpm@11.9.0 --activate && \
    npm add --global turbo@2.10.0

FROM tooling AS pruned

WORKDIR /app
COPY . .
RUN turbo prune webhook_dispatcher --docker

FROM tooling AS builder

WORKDIR /app
COPY --from=pruned /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruned /app/out/full/ .
COPY packages ./packages
RUN pnpm exec turbo run build --filter=webhook_dispatcher

FROM node:24.12.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

COPY --from=builder /app/apps/webhook_dispatcher/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/webhook_dispatcher/package.json ./apps/webhook_dispatcher/package.json

EXPOSE 3007
USER node
WORKDIR /app/apps/webhook_dispatcher
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const port=process.env.WEBHOOK_DISPATCHER_PORT||process.env.PORT||3007;fetch(`http://127.0.0.1:${port}/health/check`).then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "src/index.js"]
