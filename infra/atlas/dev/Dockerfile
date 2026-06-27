FROM node:24.12.0-alpine

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

RUN apk add --no-cache curl bash
RUN curl -sSf https://atlasgo.sh | sh
RUN npm install -g pnpm

WORKDIR /app
