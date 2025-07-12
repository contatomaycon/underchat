FROM public.ecr.aws/docker/library/node:22.17.0-alpine

RUN apk add --no-cache curl bash
RUN curl -sSf https://atlasgo.sh | sh
RUN npm install -g pnpm

WORKDIR /app