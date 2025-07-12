FROM node:22.17.0-alpine AS base

RUN apk add --no-cache bash curl libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@latest --activate

FROM base AS pruned
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/public_api ./apps/public_api
COPY packages/core/plugins/i18next/locales ./packages/core/plugins/i18next/locales
RUN pnpm dlx turbo@latest prune public --docker

FROM pruned AS deps
WORKDIR /app
COPY --from=pruned /app/out/json/ ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS builder
WORKDIR /app
COPY --from=deps /app/node_modules/ ./
COPY --from=pruned /app/out/full/ ./
RUN pnpm build:public
RUN mkdir -p /build_locales
COPY packages/core/plugins/i18next/locales /build_locales

FROM node:22.17.0-alpine AS release
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
COPY --from=builder /build_locales ./packages/core/plugins/i18next/locales
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 3001
WORKDIR /app/apps/public_api
CMD ["node","src/index.js"]
