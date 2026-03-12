# Observability Baseline (OTel + LGTM)

## Goal

Provide a minimum, production-ready baseline for traces, metrics, logs, and alerts across all non-mobile workspaces:

- `public`
- `manager`
- `balancer`
- `service`
- `schedule_api`
- `worker_baileys`
- `worker_wwebjs`
- `web`

## Required Runtime Conventions

- `service.name` must be unique per workspace.
- Backend services should prefer fallback service naming from `npm_package_name` when `OTEL_SERVICE_NAME` is empty.
- Web uses OTLP HTTP to `VITE_OTEL_COLLECTOR_URL`.
- OTLP config keys:
  - `OTEL_EXPORTER_OTLP_PROTOCOL`
  - `OTEL_EXPORTER_OTLP_ENDPOINT`

## Dedicated Docker Services (balance, baileys, wwebjs)

These services run outside Kubernetes, so Kubernetes log discovery (Promtail with
`__meta_kubernetes_*`) does not see their stdout logs.

To keep traces and logs aligned in Grafana:

- Keep OTEL enabled in each container.
- Set explicit `OTEL_SERVICE_NAME` in runtime env:
  - `balance`
  - `baileys`
  - `wwebjs`
- Use OTLP endpoint reachable from the dedicated host (for example `https://otel.devunder.com`).

The telemetry plugin now emits logs both to stdout (for local/container debugging)
and to OpenTelemetry logs API (OTLP), so dedicated Docker services can reach Loki
through the OTel Collector logs pipeline.

## Collector/Ingress CORS (Web OTLP)

The OTLP HTTP endpoint (for example `https://otel.devunder.com`) must allow browser preflight and POST:

- Methods: `POST, OPTIONS`
- Allowed headers (minimum): `content-type, traceparent, tracestate, baggage`
- Allowed origins: web origins used by local/dev/prod (for example `http://localhost:5173` and production frontend domain)
- Response must include:
  - `Access-Control-Allow-Origin`
  - `Access-Control-Allow-Headers`
  - `Access-Control-Allow-Methods`

## Baseline Dashboards

Create at least one dashboard with:

- Request volume (`http.server.requests.total`) by service and route
- Error rate (4xx and 5xx split; plus 5xx only)
- Latency p95 by service and route (`http.server.requests.duration.ms`)
- Consumer error counters (`message_send_error`, `message_status_update_error`, etc.)
- Service telemetry heartbeat/absence panel

## Baseline Alerts

Suggested initial alerts (tune thresholds after 1-2 weeks of data):

1. High error rate (5xx)

- Expression (PromQL):

```promql
sum by (service) (
  rate(http_server_requests_total{http_status_code=~"5.."}[5m])
)
/
clamp_min(sum by (service) (rate(http_server_requests_total[5m])), 1)
> 0.05
```

- For: `10m`

2. High latency p95

- Expression (PromQL):

```promql
histogram_quantile(
  0.95,
  sum by (service, le) (
    rate(http_server_requests_duration_ms_bucket[5m])
  )
)
> 1000
```

- For: `10m`

3. Missing telemetry by service

- Expression (PromQL), one rule per expected service:

```promql
absent(sum(rate(http_server_requests_total{service="manager"}[10m])))
```

- For: `15m`

4. Consumer failure spike

- Expression (PromQL):

```promql
sum by (service) (increase(message_send_error[10m])) > 20
```

- For: `5m`

5. Runtime unhandled exceptions (logs)

- Loki example:

```logql
sum by (service) (
  count_over_time({service=~".+"} |= "Uncaught exception detected" [5m])
) > 0
```

## Trace/Log Correlation Validation

- Logs must carry `trace_id` and `span_id`.
- For incident triage:
  - Start in Grafana logs panel (Loki).
  - Pivot by `trace_id` to Tempo trace view.
  - Confirm related span errors/events and route attributes.

## Smoke Validation Checklist

1. Start each backend workspace and confirm OTel init log with protocol/endpoint/service.
2. Execute one HTTP request per service and confirm:

- trace appears in Tempo
- request metrics in Prometheus/Grafana
- logs correlated with `trace_id`/`span_id`

3. Trigger one controlled error and confirm exception events in trace/log.
4. In web:

- load app and confirm page-load trace
- call API and confirm `traceparent` propagation to backend
- confirm no console spam with `VITE_OTEL_CONSOLE_LOGS=false`
