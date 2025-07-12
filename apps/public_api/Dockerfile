FROM node:22.17.0-alpine AS base

RUN apk add --no-cache libc6-compat curl bash
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN npm install -g turbo@latest

FROM base AS pruned
WORKDIR /app
COPY . .
RUN turbo prune public --docker

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
RUN apk add --no-cache curl bash \
 && curl -sSfL https://atlasgo.sh -o /tmp/atlasgo.sh \
 && echo "$ATLASGO_SHA256  /tmp/atlasgo.sh" | sha256sum -c - \
 && bash /tmp/atlasgo.sh \
 && rm /tmp/atlasgo.sh
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/apps/public_api/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/public_api/package*.json ./apps/public_api
COPY --from=builder /app/atlas ./atlas
COPY --from=builder /app/atlas.hcl ./atlas.hcl
COPY --from=builder /build_locales ./packages/core/plugins/i18next/locales

EXPOSE 3001
WORKDIR /app/apps/public_api
CMD ["node", "src/index.js"]
