FROM node:22.18.0-bookworm-slim AS base

FROM base AS turbo

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      git \
      g++ \
      make \
      python3 \
      pkg-config \
      libssl-dev \
      libsasl2-dev \
      zstd \
      curl \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && \
    corepack prepare pnpm@10.22.0 --activate && \
    corepack prepare yarn@4.9.2 --activate && \
    npm add -g turbo@2.6.3

FROM turbo AS pruned

WORKDIR /app

COPY . .

RUN turbo prune web --docker

FROM pruned AS deps

WORKDIR /app

COPY --from=pruned /app/out/json/ .

ENV CI=true \
    npm_config_build_from_source=true \
    npm_config_loglevel=verbose

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    ulimit -n 1048576 || true && \
    pnpm install --frozen-lockfile --ignore-scripts --unsafe-perm

FROM deps AS builder

WORKDIR /app

COPY --from=pruned /app/out/full/ .

ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL} \
    CI=true

WORKDIR /app/apps/web

RUN ulimit -n 1048576 || true && \
    pnpm run build:icons && \
    pnpm run msw:init

RUN ulimit -n 1048576 || true && \
    pnpm run build

FROM nginx:1.27-alpine AS runner

WORKDIR /usr/share/nginx/html

RUN rm -rf ./* && \
    rm -rf /docker-entrypoint.d/* && \
    cat > /etc/nginx/nginx.conf <<'NGINX'
worker_processes auto;
error_log /dev/stderr warn;
pid /tmp/nginx.pid;

events { worker_connections 1024; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;

  access_log /dev/stdout;

  sendfile on;
  keepalive_timeout 65;

  client_body_temp_path /tmp/client_temp;
  proxy_temp_path /tmp/proxy_temp;
  fastcgi_temp_path /tmp/fastcgi_temp;
  uwsgi_temp_path /tmp/uwsgi_temp;
  scgi_temp_path /tmp/scgi_temp;

  gzip on;
  gzip_vary on;
  gzip_min_length 1024;
  gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json;

  include /etc/nginx/conf.d/*.conf;
}
NGINX

RUN cat > /etc/nginx/conf.d/default.conf <<'CONF'
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
CONF

COPY --from=builder /app/apps/web/dist/ .

RUN chown -R 101:101 /usr/share/nginx/html /etc/nginx

USER 101

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
