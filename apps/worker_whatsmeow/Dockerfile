FROM golang:1.26.2-bookworm AS builder

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

WORKDIR /app/apps/worker_whatsmeow

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc libc6-dev libsqlite3-dev ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY apps/worker_whatsmeow/go.mod apps/worker_whatsmeow/go.sum* ./
COPY apps/worker_whatsmeow/forks ./forks
RUN go mod download

COPY apps/worker_whatsmeow ./
RUN CGO_ENABLED=1 GOOS=linux go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

FROM debian:bookworm-slim AS runner

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

WORKDIR /app/apps/worker_whatsmeow

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libsqlite3-0 tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data

COPY --from=builder /out/worker /usr/local/bin/worker-whatsmeow

EXPOSE 3005 50054
ENV UNDERCHAT_ENV_SCOPE=public
VOLUME ["/app/data"]

CMD ["/usr/local/bin/worker-whatsmeow"]
