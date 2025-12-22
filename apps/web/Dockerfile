FROM node:22.18.0-bookworm-slim AS builder

WORKDIR /app
SHELL ["/bin/bash", "-lc"]

RUN corepack enable && \
    corepack prepare pnpm@10.14.0 --activate

ENV CI=true
ENV NODE_ENV=production
ENV CHOKIDAR_USEPOLLING=true
ENV CHOKIDAR_INTERVAL=250
ENV WATCHPACK_POLLING=true
ENV WATCHPACK_POLLING_INTERVAL=250

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
COPY . .

RUN \
  ulimit -n 65536 || true && \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm i; \
  elif [ -f pnpm-lock.yaml ]; then pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

RUN \
  ulimit -n 65536 || true && \
  if [ -f yarn.lock ]; then yarn build --filter=web; \
  elif [ -f package-lock.json ]; then npm run build --workspace=apps/web; \
  elif [ -f pnpm-lock.yaml ]; then pnpm --filter web build; \
  else yarn build --filter=web; \
  fi

FROM nginx:stable-alpine

RUN mkdir -p /tmp/nginx/client_temp \
  /tmp/nginx/proxy_temp \
  /tmp/nginx/fastcgi_temp \
  /tmp/nginx/uwsgi_temp \
  /tmp/nginx/scgi_temp && \
  chmod -R 777 /tmp/nginx && \
  chmod 777 /tmp

COPY apps/web/nginx-main.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]