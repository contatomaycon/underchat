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

COPY --from=deps /app/node_modules ./node_modules
COPY --from=pruned /app/out/full/ .

ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL} \
    CI=true \
    CHOKIDAR_USEPOLLING=true \
    CHOKIDAR_INTERVAL=100

RUN ulimit -n 1048576 || true && \
    cd apps/web && \
    pnpm run build:icons && \
    pnpm run msw:init

RUN ulimit -n 1048576 || true && \
    pnpm build:web

FROM nginx:1.27-alpine AS runner

WORKDIR /usr/share/nginx/html

RUN rm -rf ./*

COPY --from=builder /app/apps/web/dist .

RUN echo 'server {' > /etc/nginx/conf.d/default.conf && \
    echo '    listen 8080;' >> /etc/nginx/conf.d/default.conf && \
    echo '    server_name _;' >> /etc/nginx/conf.d/default.conf && \
    echo '    root /usr/share/nginx/html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    index index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    gzip on;' >> /etc/nginx/conf.d/default.conf && \
    echo '    gzip_vary on;' >> /etc/nginx/conf.d/default.conf && \
    echo '    gzip_min_length 1024;' >> /etc/nginx/conf.d/default.conf && \
    echo '    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json;' >> /etc/nginx/conf.d/default.conf && \
    echo '    location / {' >> /etc/nginx/conf.d/default.conf && \
    echo '        try_files $uri $uri/ /index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    }' >> /etc/nginx/conf.d/default.conf && \
    echo '    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {' >> /etc/nginx/conf.d/default.conf && \
    echo '        expires 1y;' >> /etc/nginx/conf.d/default.conf && \
    echo '        add_header Cache-Control "public, immutable";' >> /etc/nginx/conf.d/default.conf && \
    echo '    }' >> /etc/nginx/conf.d/default.conf && \
    echo '}' >> /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]