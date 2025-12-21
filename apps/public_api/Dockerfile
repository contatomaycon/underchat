FROM node:22.18.0-bookworm-slim AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      curl \
      ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

FROM base AS pruned
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/public_api ./apps/public_api
COPY packages/plugins/i18next/locales ./packages/plugins/i18next/locales
RUN pnpm dlx turbo@latest prune public --docker

FROM pruned AS deps

WORKDIR /app
COPY --from=pruned /app/out/json/ .

RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS builder
WORKDIR /app
COPY --from=deps /app/node_modules/ ./
COPY --from=pruned /app/out/full/ ./
RUN pnpm build:public
RUN mkdir -p /build_locales
COPY packages/plugins/i18next/locales /build_locales

FROM node:22.18.0-bookworm-slim AS release
WORKDIR /app
ARG ATLASGO_SHA256
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash \
      curl \
      ca-certificates && \
    curl --proto '=https' --tlsv1.2 -sSfL https://atlasgo.sh -o /tmp/atlasgo.sh \
    && echo "$ATLASGO_SHA256  /tmp/atlasgo.sh" | sha256sum -c - \
    && bash /tmp/atlasgo.sh \
    && rm /tmp/atlasgo.sh \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@latest --activate

COPY --from=builder /app/apps/public_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json .
COPY --from=builder /app/apps/public_api/package*.json ./apps/public_api
COPY --from=builder /app/atlas ./atlas
COPY --from=builder /app/atlas.hcl ./atlas.hcl
COPY --from=builder /build_locales ./packages/plugins/i18next/locales
RUN groupadd -r app && useradd -r -g app app
USER app
EXPOSE 3001
WORKDIR /app/apps/public_api
CMD ["node","src/index.js"]
