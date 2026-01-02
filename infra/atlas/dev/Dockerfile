FROM node:24.12.0-alpine

RUN apk add --no-cache curl bash
RUN curl -sSf https://atlasgo.sh | sh
RUN npm install -g pnpm

WORKDIR /app