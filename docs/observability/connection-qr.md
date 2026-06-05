# Connection QR Observability Runbook

Use este runbook quando um canal Baileys, WWebJS ou WhatsMeow nao gerar QR.

## Loki

Filtre por worker:

```logql
{log_type=~"connection_qr_summary|connection_attempt_summary|connection_lifecycle"} |= "WORKER_ID"
```

Filtre por tentativa:

```logql
{log_type=~"connection_qr_summary|connection_attempt_summary|connection_lifecycle"} |= "CONNECTION_ATTEMPT_ID"
```

Timeout de primeiro QR:

```logql
{log_type=~"connection_qr_summary|connection_attempt_summary|connection_lifecycle"} |= "first_qr_timeout"
```

Recriacao ou supressao de recriacao:

```logql
{log_type=~"connection_qr_summary|connection_attempt_summary|connection_lifecycle"} |~ "qrcode_container_recreate|qrcode_container_recreate_suppressed"
```

Warm pool rejeitado:

```logql
{log_type=~"connection_attempt_summary|connection_lifecycle"} |= "warm_activation_rejected"
```

## Metricas

Series principais:

```promql
sum by (worker_type, server_id, outcome, reason) (rate(underchat_connection_qr_outcomes_total[5m]))
```

```promql
histogram_quantile(0.95, sum by (le, worker_type, server_id) (rate(underchat_connection_qr_time_to_first_qr_ms_bucket[10m])))
```

```promql
sum by (worker_type, server_id, reason) (rate(underchat_connection_container_recreates_total[5m]))
```

```promql
sum by (worker_type, server_id, reason) (rate(underchat_warm_pool_activation_rejections_total[5m]))
```

## Alertas Recomendados

- `first_qr_timeout`: qualquer aumento sustentado por tipo/servidor por 10 minutos.
- Recriacao excessiva: mais de 3 recriacoes em 5 minutos para o mesmo worker via Loki.
- Warm activation rejected: qualquer evento em producao deve abrir investigacao.
- QR p95: `underchat_connection_qr_time_to_first_qr_ms` acima de 60000 ms por 10 minutos.

## Campos Chave

- `connection_attempt_id`: correlacao de uma tentativa de QR.
- `connection_lifecycle_id`: correlacao distribuida entre manager, balancer e worker.
- `runtime_generation`: aumenta a cada troca de runtime/container.
- `warm_pool_id`: identifica ativacao a partir de warm pool.
- `reason`: causa normalizada, por exemplo `first_qr_timeout`, `qr_event_timeout`, `worker_response_without_qr`, `recreate_cooldown_active`.
