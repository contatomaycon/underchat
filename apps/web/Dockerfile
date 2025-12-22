FROM node:22.18.0-bookworm-slim AS builder

LABEL maintainer="underchat"
LABEL app="web"
LABEL component="frontend"

WORKDIR /app
SHELL ["/bin/bash", "-lc"]

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate

ENV CI=true \
    NODE_ENV=production \
    CHOKIDAR_USEPOLLING=true \
    CHOKIDAR_INTERVAL=250 \
    WATCHPACK_POLLING=true \
    WATCHPACK_POLLING_INTERVAL=250

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages

RUN ulimit -n 65536 || true && \
    if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    elif [ -f pnpm-lock.yaml ]; then pnpm i --frozen-lockfile; \
    else echo "Lockfile not found." && exit 1; \
    fi

COPY . .

RUN ulimit -n 65536 || true && \
    if [ -f yarn.lock ]; then yarn build --filter=web; \
    elif [ -f package-lock.json ]; then npm run build --workspace=apps/web; \
    elif [ -f pnpm-lock.yaml ]; then pnpm --filter web build; \
    else yarn build --filter=web; \
    fi && \
    rm -rf node_modules packages apps/*/node_modules

FROM nginx:stable-alpine

LABEL maintainer="underchat"
LABEL app="web"
LABEL component="frontend"

RUN mkdir -p /tmp/nginx/client_temp \
             /tmp/nginx/proxy_temp \
             /tmp/nginx/fastcgi_temp \
             /tmp/nginx/uwsgi_temp \
             /tmp/nginx/scgi_temp \
             /var/cache/nginx/client_temp \
             /var/cache/nginx/proxy_temp \
             /var/cache/nginx/fastcgi_temp \
             /var/cache/nginx/uwsgi_temp \
             /var/cache/nginx/scgi_temp && \
    chown -R nginx:nginx /var/cache/nginx \
                         /var/log/nginx \
                         /tmp/nginx \
                         /usr/share/nginx/html \
                         /etc/nginx/conf.d && \
    chmod -R 755 /var/cache/nginx \
                 /var/log/nginx \
                 /tmp/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

COPY apps/web/nginx-main.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/apps/web/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD test -f /usr/share/nginx/html/index.html && \
        test -f /var/run/nginx.pid && \
        kill -0 $(cat /var/run/nginx.pid) 2>/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]