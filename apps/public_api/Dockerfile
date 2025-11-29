FROM node:22.18.0-alpine AS base

RUN apk add --no-cache bash curl libc6-compat \
      corepack enable \
    && corepack prepare pnpm@latest --activate

FROM base AS pruned
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/public_api ./apps/public_api
COPY packages/plugins/i18next/locales ./packages/plugins/i18next/locales
RUN pnpm dlx turbo@latest prune public --docker

FROM pruned AS deps

RUN apk update && \
    apk add --no-cache openssh-client

WORKDIR /app
COPY --from=pruned /app/out/json/ .
COPY --from=pruned /app/infra/ssh/docker_key /tmp/docker_key
COPY --from=pruned /app/infra/ssh/known_hosts /tmp/known_hosts

RUN mkdir -p ~/.ssh && \
    cp /tmp/docker_key ~/.ssh/id_rsa && \
    chmod 600 ~/.ssh/id_rsa && \
    cp /tmp/known_hosts ~/.ssh/known_hosts && \
    chmod 644 ~/.ssh/known_hosts && \
    eval "$(ssh-agent -s)" > /dev/null && \
    ssh-add ~/.ssh/id_rsa 2>/dev/null || true && \
    git config --global url."git@github.com:".insteadOf "https://github.com/" || true && \
    git config --global url."git@gitlab.com:".insteadOf "https://gitlab.com/" || true

RUN pnpm install --frozen-lockfile --ignore-scripts

RUN rm -rf ~/.ssh/id_rsa ~/.ssh/known_hosts /tmp/docker_key && \
    ssh-add -D 2>/dev/null || true

FROM deps AS builder
WORKDIR /app
COPY --from=deps /app/node_modules/ ./
COPY --from=pruned /app/out/full/ ./
RUN pnpm build:public
RUN mkdir -p /build_locales
COPY packages/plugins/i18next/locales /build_locales

FROM node:22.18.0-alpine AS release
WORKDIR /app
ARG ATLASGO_SHA256
RUN apk add --no-cache bash curl \
    && curl --proto '=https' --tlsv1.2 -sSfL https://atlasgo.sh -o /tmp/atlasgo.sh \
    && echo "$ATLASGO_SHA256  /tmp/atlasgo.sh" | sha256sum -c - \
    && bash /tmp/atlasgo.sh \
    && rm /tmp/atlasgo.sh \
    && corepack enable \
    && corepack prepare pnpm@latest --activate

COPY --from=builder /app/apps/public_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json .
COPY --from=builder /app/apps/public_api/package*.json ./apps/public_api
COPY --from=builder /app/atlas ./atlas
COPY --from=builder /app/atlas.hcl ./atlas.hcl
COPY --from=builder /build_locales ./packages/plugins/i18next/locales
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3001
WORKDIR /app/apps/public_api
CMD ["node","src/index.js"]
