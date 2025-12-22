FROM node:22.18.0-bookworm-slim AS builder

LABEL maintainer="underchat"
LABEL app="web"
LABEL component="frontend"

WORKDIR /app
SHELL ["/bin/bash", "-lc"]

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate

ENV CI=true \
    NODE_ENV=production

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml turbo.json ./
COPY . .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    ulimit -n 65536 || true && \
    has_yarn=false && has_npm=false && has_pnpm=false && \
    [ -f yarn.lock ] && has_yarn=true || true && \
    [ -f package-lock.json ] && has_npm=true || true && \
    [ -f pnpm-lock.yaml ] && has_pnpm=true || true && \
    if $has_yarn; then yarn --frozen-lockfile; fi && \
    if $has_npm && ! $has_yarn; then npm ci; fi && \
    if $has_pnpm && ! $has_yarn && ! $has_npm; then pnpm i --frozen-lockfile; fi && \
    if ! $has_yarn && ! $has_npm && ! $has_pnpm; then echo "Lockfile not found." && exit 1; fi

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    ulimit -n 65536 || true && \
    has_yarn=false && has_npm=false && has_pnpm=false && \
    [ -f yarn.lock ] && has_yarn=true || true && \
    [ -f package-lock.json ] && has_npm=true || true && \
    [ -f pnpm-lock.yaml ] && has_pnpm=true || true && \
    if $has_yarn; then yarn build --filter=web; fi && \
    if $has_npm && ! $has_yarn; then npm run build --workspace=apps/web; fi && \
    if $has_pnpm && ! $has_yarn && ! $has_npm; then pnpm --filter web build; fi && \
    if ! $has_yarn && ! $has_npm && ! $has_pnpm; then echo "Lockfile not found." && exit 1; fi && \
    rm -rf node_modules packages apps/*/node_modules

FROM nginx:stable-alpine

LABEL maintainer="underchat"
LABEL app="web"
LABEL component="frontend"

RUN apk add --no-cache wget && \
    mkdir -p /tmp/nginx/client_temp \
             /tmp/nginx/proxy_temp \
             /tmp/nginx/fastcgi_temp \
             /tmp/nginx/uwsgi_temp \
             /tmp/nginx/scgi_temp \
             /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp \
             /run \
             /var/run && \
    chown -R nginx:nginx /var/cache/nginx \
                         /var/log/nginx \
                         /tmp/nginx \
                         /usr/share/nginx/html \
                         /etc/nginx/conf.d \
                         /run \
                         /var/run && \
    chmod -R 755 /var/cache/nginx \
                 /var/log/nginx \
                 /tmp/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]