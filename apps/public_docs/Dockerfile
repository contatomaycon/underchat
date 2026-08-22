FROM node:24.12.0-bookworm-slim AS turbo

ENV TURBO_TELEMETRY_DISABLED=1

RUN corepack enable && \
    corepack prepare pnpm@11.9.0 --activate && \
    npm add --global turbo@2.10.0

FROM turbo AS pruned

WORKDIR /app
COPY . .
RUN turbo prune public_docs --docker

FROM turbo AS dependencies

WORKDIR /app
COPY --from=pruned /app/out/json/ .

ENV CI=true

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS builder

WORKDIR /app
COPY --from=pruned /app/out/full/ .
COPY --from=dependencies /app/node_modules ./node_modules

ARG VITE_API_PUBLIC_URL
ENV VITE_API_PUBLIC_URL=${VITE_API_PUBLIC_URL} \
    PATH="/app/node_modules/.bin:$PATH"

RUN test -n "$VITE_API_PUBLIC_URL" && \
    pnpm --filter public_docs run build

FROM nginx:1.27-alpine AS runner

ENV TZ=America/Sao_Paulo

WORKDIR /usr/share/nginx/html

RUN rm -rf ./* /docker-entrypoint.d/*

COPY apps/public_docs/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/apps/public_docs/dist/ .

RUN chown -R 101:101 /usr/share/nginx/html /etc/nginx/nginx.conf

USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
