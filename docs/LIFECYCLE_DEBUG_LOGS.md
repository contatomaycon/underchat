# Logs De Debug Do Ciclo De Vida

Este documento explica os logs temporarios de investigacao para:

- ciclo de vida de mensagens: `debug_index="message_lifecycle"`
- ciclo de vida de conexoes: `debug_index="connection_lifecycle"`

Esses logs existem para diagnosticar onde uma mensagem ou uma conexao parou no fluxo ponta a ponta. Eles emitem apenas excecoes do fluxo: erro, retry, DLQ, descarte, skip, ignored/dropped ou outro ponto que encerra o fluxo sem continuidade. Eventos de sucesso/progresso nao sao enviados.

## Ativacao

Configure as variaveis no ambiente do servico que precisa emitir os logs e reinicie o processo/container.

```env
# Logs de debug do ciclo de vida da mensagem
MESSAGE_LIFECYCLE_DEBUG_ENABLED: "true"
MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT: "500"
MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT: "4000"

# Logs de debug do ciclo de vida da conexao dos canais
CONNECTION_LIFECYCLE_DEBUG_ENABLED: "true"
CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT: "500"
CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT: "4000"
```

Para desligar, volte os flags para `false` e reinicie os servicos.

```env
MESSAGE_LIFECYCLE_DEBUG_ENABLED=false
CONNECTION_LIFECYCLE_DEBUG_ENABLED=false
```

## O Que E Emitido

Com os flags ligados, o lifecycle debug registra apenas eventos problematicos:

- `level="warn"` ou `level="error"`
- `outcome` em `error`, `failed`, `partial_error`, `timeout`, `dlq`, `discarded`, `dropped`, `skipped`, `ignored`, `ignore_totally`, `ignore_automation`, `retrying`, `closed`, `message_creation_skipped` ou `chat_saved_without_message`
- qualquer evento que tenha `error`, `err`, `exception`, `stack` ou `error_message`

Eventos normais como `received`, `started`, `success`, `published`, `committed`, `completed`, `created`, `mapped`, `queued` e `chatbot` sao descartados no helper antes de serializar payload, truncar raw ou capturar arquivo/linha.

## Onde Fica Salvo

Os eventos de excecao sao emitidos como logs OpenTelemetry e seguem o pipeline OTLP configurado pelo ambiente. No fluxo esperado, eles chegam ao OTel Collector e sao armazenados no Loki. Eles nao criam indice Elasticsearch.

O "indice unico" citado na implementacao e um indice logico via campo:

- `debug_index="message_lifecycle"`
- `debug_index="connection_lifecycle"`

Tambem existe `log_type` com o mesmo valor, para facilitar filtros em backends que exibem atributos de forma diferente.

Para reduzir custo, os spans de lifecycle sao curtos e criados apenas para eventos emitidos. Quando o log tiver `trace_id` e `span_id`, da para sair do log no Loki/Grafana e abrir a trace correspondente no Tempo.

No Whatsmeow, se o exporter OTLP de logs nao estiver disponivel, existe fallback operacional em stdout. Nesse caso os logs podem aparecer no stdout/container e tambem chegar ao Loki pelo coletor de logs do ambiente, se houver.

## Campos Principais

Campos comuns:

- `debug_index`
- `log_type`
- `stage`
- `decision`
- `outcome`
- `reason`
- `account_id`
- `worker_id`
- `channel_id`
- `source_provider`
- `source_file`
- `source_line`
- `source_function`
- `trace_id`
- `span_id`

Campos de mensagem:

- `message_lifecycle_id`
- `message_key_id`
- `phone`
- `jid`
- `lid`
- `remote_jid`
- `remote_jid_alt`
- `message_text`
- `message_truncated`
- `raw_payload`
- `raw_truncated`

Campos de conexao:

- `connection_lifecycle_id`
- `worker_type`
- `connection_type`
- `connection_action`
- `status`
- `code`
- `worker_status_id`
- `attempt`
- `max_attempts`
- `grpc_method`
- `grpc_address`
- `deadline_ms`

QR code e codigo de pareamento nunca devem aparecer completos. Os logs gravam apenas:

- `has_qr`
- `qr_hash`
- `qr_length`
- `has_pairing_code`
- `pairing_code_hash`
- `pairing_code_length`

## Como Analisar No Grafana/Loki

Abra o Grafana, va em Explore, selecione Loki e filtre pelo indice logico.

Dependendo de como o Loki/Collector promove atributos OTLP, `debug_index` pode aparecer como label ou como campo/metadata. Use a primeira forma se funcionar; caso contrario, use a segunda.

Mensagem, quando `debug_index` esta como label:

```logql
{debug_index="message_lifecycle"}
```

Mensagem, quando `debug_index` esta como campo/metadata:

```logql
{service_name=~".+"} | debug_index="message_lifecycle"
```

Conexao, quando `debug_index` esta como label:

```logql
{debug_index="connection_lifecycle"}
```

Conexao, quando `debug_index` esta como campo/metadata:

```logql
{service_name=~".+"} | debug_index="connection_lifecycle"
```

### Mensagem Especifica

Filtre por `message_lifecycle_id` quando ja tiver o ID:

```logql
{debug_index="message_lifecycle", message_lifecycle_id="ID_DA_MENSAGEM"}
```

Ou por campo/metadata:

```logql
{service_name=~".+"}
| debug_index="message_lifecycle"
| message_lifecycle_id="ID_DA_MENSAGEM"
```

Filtros uteis:

```logql
{service_name=~".+"}
| debug_index="message_lifecycle"
| account_id="ACCOUNT_ID"
| worker_id="WORKER_ID"
| message_key_id="MESSAGE_KEY_ID"
```

Para achar descartes, retries, DLQ e falhas:

```logql
{service_name=~".+"}
| debug_index="message_lifecycle"
| outcome=~"skipped|discarded|dropped|ignored|retrying|dlq|failed|partial_error|timeout|error"
```

### Conexao Especifica

Filtre por `connection_lifecycle_id` quando ja tiver o ID:

```logql
{debug_index="connection_lifecycle", connection_lifecycle_id="ID_DA_CONEXAO"}
```

Ou por campo/metadata:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| connection_lifecycle_id="ID_DA_CONEXAO"
```

Filtros uteis:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| account_id="ACCOUNT_ID"
| worker_id="WORKER_ID"
| source_provider=~"baileys|wwebjs|whatsmeow"
```

Para achar skips, retries e falhas de QR, gRPC, reconnect ou notify:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| outcome=~"skipped|retrying|failed|partial_error|timeout|error"
```

## Ordem De Investigacao

Para mensagem:

1. Busque pelo `message_key_id`, `jid`, `phone` ou `message_lifecycle_id`.
2. Ordene os logs do mais antigo para o mais novo.
3. O primeiro evento encontrado ja representa um ponto de excecao/interrupcao do fluxo.
4. Use `stage`, `decision`, `outcome` e `reason` para entender a causa.
5. Use `source_file`, `source_line` e `source_function` para ir direto ao branch do codigo.
6. Se houver `trace_id`, abra a trace no Tempo para ver o span curto do ponto problematico e qualquer trace pai ativa.

Para conexao:

1. Busque pelo `worker_id`, `account_id` ou `connection_lifecycle_id`.
2. O primeiro evento encontrado ja representa um ponto de excecao/interrupcao do fluxo.
3. Verifique branches como validacao, fallback gRPC, health check, QR/auth, disconnect, reconnect, notify e publish.
4. Use `grpc_method`, `grpc_address`, `attempt`, `max_attempts`, `status` e `code` para identificar timeout, rota errada, reconnect ou falha de autenticacao.
5. Abra o `trace_id` no Tempo quando disponivel.

## Como Deletar Esses Logs

Antes de apagar, desligue a emissao e reinicie os servicos:

```env
MESSAGE_LIFECYCLE_DEBUG_ENABLED=false
CONNECTION_LIFECYCLE_DEBUG_ENABLED=false
```

Depois confirme que nao existem novos eventos recentes:

```logql
{service_name=~".+"} | debug_index=~"message_lifecycle|connection_lifecycle"
```

### Opcao Recomendada: Retencao Curta No Loki

Para uso recorrente, configure retencao curta no Loki para streams com `debug_index="message_lifecycle"` e `debug_index="connection_lifecycle"`. Isso evita manutencao manual e reduz risco operacional.

A retencao e delecao fisica em Loki dependem do Compactor. A documentacao oficial da Grafana informa que a retencao e processada pelo Compactor e que a delecao de entradas exige configuracao propria de retencao/delecao.

### Opcao Manual: Delete API Do Loki

Use a Delete API quando precisar apagar uma janela especifica de investigacao.

Requisitos no Loki:

- Compactor com `retention_enabled=true`
- `delete_request_store` configurado
- runtime config com `deletion_mode=filter-and-delete` para remover fisicamente
- se `deletion_mode=filter-only`, os logs deixam de aparecer nas consultas, mas nao sao removidos do storage

Exemplo para apagar logs de mensagem:

```bash
export LOKI_URL="http://localhost:3100"
export LOKI_TENANT="1"

curl -g -X POST "$LOKI_URL/loki/api/v1/delete" \
  -H "X-Scope-OrgID: $LOKI_TENANT" \
  --data-urlencode 'query={debug_index="message_lifecycle"}' \
  --data-urlencode 'start=2026-05-26T00:00:00Z' \
  --data-urlencode 'end=2026-05-26T23:59:59Z'
```

Exemplo para apagar logs de conexao:

```bash
export LOKI_URL="http://localhost:3100"
export LOKI_TENANT="1"

curl -g -X POST "$LOKI_URL/loki/api/v1/delete" \
  -H "X-Scope-OrgID: $LOKI_TENANT" \
  --data-urlencode 'query={debug_index="connection_lifecycle"}' \
  --data-urlencode 'start=2026-05-26T00:00:00Z' \
  --data-urlencode 'end=2026-05-26T23:59:59Z'
```

Se `debug_index` nao estiver promovido para label, use query com filtro:

```bash
curl -g -X POST "$LOKI_URL/loki/api/v1/delete" \
  -H "X-Scope-OrgID: $LOKI_TENANT" \
  --data-urlencode 'query={service_name=~".+"} | debug_index="message_lifecycle"' \
  --data-urlencode 'start=2026-05-26T00:00:00Z' \
  --data-urlencode 'end=2026-05-26T23:59:59Z'
```

Para Grafana Cloud ou Grafana Enterprise Logs, use autenticacao:

```bash
export LOKI_URL="https://LOKI_URL_DO_STACK"
export LOKI_USER="TENANT_OU_USER"
export API_TOKEN="TOKEN_COM_PERMISSAO_LOGS_DELETE"

curl -u "$LOKI_USER:$API_TOKEN" \
  -g -X POST "$LOKI_URL/loki/api/v1/delete" \
  --data-urlencode 'query={debug_index="message_lifecycle"}' \
  --data-urlencode 'start=2026-05-26T00:00:00Z' \
  --data-urlencode 'end=2026-05-26T23:59:59Z'
```

Listar requests de delecao:

```bash
curl -G "$LOKI_URL/loki/api/v1/delete" \
  -H "X-Scope-OrgID: $LOKI_TENANT"
```

Cancelar um request, se ainda estiver dentro do periodo de cancelamento:

```bash
curl -X DELETE \
  "$LOKI_URL/loki/api/v1/delete?request_id=REQUEST_ID" \
  -H "X-Scope-OrgID: $LOKI_TENANT"
```

Observacoes importantes:

- A Delete API retorna sucesso quando o request foi aceito; a remocao pode ocorrer depois.
- O periodo de cancelamento padrao do Loki pode atrasar a delecao.
- Use `start` e `end` sempre que possivel para limitar o impacto.
- Confira o tenant correto antes de apagar.
- Nao execute deletes amplos como `{service_name=~".+"}` sem filtro de `debug_index`.

## Checklist De Encerramento Da Investigacao

1. Identifique e corrija o ponto de parada.
2. Desligue `MESSAGE_LIFECYCLE_DEBUG_ENABLED` e/ou `CONNECTION_LIFECYCLE_DEBUG_ENABLED`.
3. Reinicie os servicos afetados.
4. Confirme no Loki que nao ha eventos novos com `debug_index` de debug.
5. Abra request de delecao no Loki para a janela investigada, ou aguarde a retencao curta configurada.
6. Liste os delete requests para confirmar que foram aceitos/processados.

## Referencias

- Observabilidade base do projeto: [OBSERVABILITY_BASELINE.md](./OBSERVABILITY_BASELINE.md)
- Grafana Loki Log Entry Deletion: https://grafana.com/docs/loki/latest/operations/storage/logs-deletion/
- Grafana Loki HTTP API: https://grafana.com/docs/loki/latest/reference/loki-http-api/
- Grafana Loki Retention: https://grafana.com/docs/loki/latest/operations/storage/retention/
