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

ARG TINI_VERSION=0.19.0-1+b3

ENV TZ=America/Sao_Paulo \
    PGTZ=America/Sao_Paulo

WORKDIR /app/apps/worker_whatsmeow

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libsqlite3-0 tini="${TINI_VERSION}" tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && test "$(dpkg-query -W -f='${Version}' tini)" = "${TINI_VERSION}" \
  && test -x /usr/bin/tini

COPY --from=builder /out/worker /usr/local/bin/worker-whatsmeow
COPY scripts/worker-liveness-healthcheck.sh /usr/local/bin/worker-liveness-healthcheck
COPY scripts/worker-liveness-entrypoint.sh /usr/local/bin/worker-liveness-entrypoint
RUN chmod +x \
  /usr/local/bin/worker-liveness-healthcheck \
  /usr/local/bin/worker-liveness-entrypoint

EXPOSE 3005 50054
ENV UNDERCHAT_ENV_SCOPE=public

HEALTHCHECK --interval=15s --timeout=4s --start-period=90s --start-interval=15s --retries=3 \
  CMD ["/usr/local/bin/worker-liveness-healthcheck"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]
CMD ["/usr/local/bin/worker-whatsmeow"]
