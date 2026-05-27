# Memoria: QR Code Nao Abriu Por Lifecycle Incompleto Do Worker

Este documento registra o diagnostico do canal abaixo e define o que deve ser implementado para que o debug de conexao cubra o fluxo inteiro.

- `worker_id`: `019e6753-3945-75d2-a1d4-3e2de147a725`
- `name`: `vas`
- `worker_type`: `baileys`
- `account_id`: `019a930d-c6f4-75ad-88ff-8d2fcd5839e1`
- servidor: `Servidor 7`
- `web_domain` / `ssh_ip`: `198.27.69.140`

## Diagnostico Do Incidente

O QR Code nao abriu porque o endpoint do Manager que a tela usa para pedir o QR recebeu erro depois de aproximadamente 30 segundos.

Tentativas observadas no Manager:

```text
2026-05-27T02:46:16Z POST /v1/worker/019e6753-3945-75d2-a1d4-3e2de147a725/connection/qrcode -> 500 em 30172ms
2026-05-27T02:48:58Z POST /v1/worker/019e6753-3945-75d2-a1d4-3e2de147a725/connection/qrcode -> 500 em 30148ms
2026-05-27T02:53:59Z POST /v1/worker/019e6753-3945-75d2-a1d4-3e2de147a725/connection/qrcode -> 500 em 30142ms
```

Eventos `connection_lifecycle` do Balancer:

```text
stage=connection.balancer.worker_connection_grpc.qrcode_error
decision=grpc_request_connection_qrcode
outcome=error
reason=grpc_error
grpc_method=RequestConnection
grpc_address=019e6753-3945-75d2-a1d4-3e2de147a725:50052
error=4 DEADLINE_EXCEEDED: Deadline exceeded after 30s ... Waiting for LB pick
```

Na terceira tentativa tambem apareceu:

```text
stage=connection.balancer.worker_command_grpc.qrcode_error
reason=handler_error
error=Worker service is not healthy
```

O container do worker chegou a iniciar e o WorkerConnection gRPC server chegou a subir depois que a resposta HTTP ja tinha falhado. Tambem houve eventos do worker `baileys` com `has_qr=true`, por exemplo:

```text
2026-05-27T02:47:04Z worker_connection_request_dispatched has_qr=true
2026-05-27T02:49:47Z worker_connection_request_dispatched has_qr=true
2026-05-27T02:57:05Z worker_connection_request_dispatched has_qr=true
```

Conclusao: o problema principal foi uma corrida entre criacao/saude do container e a chamada sincrona de QR. O Balancer tentou falar com `worker_id:50052` antes do worker estar realmente pronto ou enquanto o container existente ainda estava inconsistente. A chamada consumiu a deadline de 30s, retornou `500`, e o QR gerado posteriormente nao chegou pela resposta HTTP que a tela aguardava.

Ha tambem um problema no fluxo externo da tela: `apps/web/src/pages/connection/external/[token].vue` aplica `qrcode` na resposta direta de `requestExternalConnectionQrCode`, mas o handler de eventos `handleWorkerConnectionMessage` nao seta `qrcode.value` quando chega `data.qrcode`. Se o QR vier por evento assincrono depois do `500`, a tela externa continua sem exibir o QR.

## Onde Olhar No Codigo

- `packages/useCases/worker/WorkerConnectionQrCodeRequester.useCase.ts`
  - Manager valida worker, pega `server_id` e chama `WorkerGrpcClientService.requestConnectionQrCode`.
- `packages/services/workerGrpcClient.service.ts`
  - Manager chama o Balancer via `RequestConnectionQrCode`.
- `packages/plugins/proto/workerGrpcServer.ts`
  - Balancer recebe `RequestConnectionQrCode` e chama `WorkerCommandHandlerService.handleRequestConnectionQrCode`.
- `packages/services/workerCommandHandler.service.ts`
  - Fluxo principal de QR esta em `runConnectionQrCodeWorkflow`.
  - O fluxo verifica container existente, tenta gRPC direto, valida saude, cria/recria container e chama o worker.
- `packages/services/workerBaileysGrpcClient.service.ts`
  - Balancer chama o worker em `${workerId}:50052`.
- `packages/services/containerHealth.service.ts`
  - Saude atual usa HTTP interno `/v1/health/check` via Docker exec.
- `apps/web/src/pages/connection/external/[token].vue`
  - Tela externa precisa aceitar QR vindo por evento assincrono.

## O Que Deve Ser Corrigido

1. Corrigir a ordem do workflow de QR no Balancer.

   Antes de gastar 30s tentando `RequestConnection` em `${workerId}:50052`, o fluxo deve identificar se o container existe, se o container esta rodando, se o HTTP health esta ok e se o gRPC do worker esta pronto. Se qualquer etapa falhar, o fluxo deve recriar ou aguardar o container de forma explicita antes da chamada de QR.

2. Nao confiar apenas em `existsContainerWorkerById`.

   Container existente nao significa worker pronto. O fluxo precisa diferenciar:

   - container inexistente
   - container existe mas parado
   - container existe mas sem HTTP health
   - container existe com HTTP health, mas sem gRPC pronto
   - container pronto para receber `RequestConnection`

3. Usar `container_id` e `worker_id` de forma consistente.

   A validacao de saude por Docker deve usar o identificador correto do container. A chamada gRPC deve usar o nome DNS do container na rede Docker (`worker_id`) somente depois de confirmar que esse container esta realmente pronto.

4. Aguardar readiness antes de retornar erro para a tela.

   Para QR Code, o caminho ideal e:

   ```text
   Manager request QR
   -> Balancer recebe request
   -> resolve worker/account/server/type
   -> inspeciona container
   -> cria ou recria se necessario
   -> aguarda HTTP health
   -> aguarda gRPC readiness ou faz probe curto em 50052
   -> chama RequestConnection no worker
   -> retorna state com qrcode ou erro final claro
   ```

5. Corrigir a tela externa para QR assincrono.

   `handleWorkerConnectionMessage` em `apps/web/src/pages/connection/external/[token].vue` deve tratar `data.qrcode` da mesma forma que `applyDirectConnectionResponse`. Assim, se a resposta direta falhar por timeout mas o QR chegar pelo Centrifugo, a tela ainda consegue abrir o QR.

## Regra Para CONNECTION_LIFECYCLE_DEBUG_ENABLED

Quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true`, o debug de conexao deve cobrir o fluxo do comeco ao fim. Para investigacao de QR/conexao, nao basta registrar apenas o erro final.

O lifecycle deve registrar, com `debug_index="connection_lifecycle"`, todos os marcos abaixo:

- entrada do request no Manager
- validacao de worker/account
- resolucao de `server_id`
- endereco gRPC do Balancer
- entrada do request no Balancer
- resolucao de dados do worker para container
- tipo do worker resolvido (`baileys`, `wwebjs`, `whatsmeow`)
- checagem de container existente
- container atual encontrado, incluindo `container_id`
- estado Docker do container (`running`, `exited`, `restarting`, `dead`, quando disponivel)
- inicio de remocao/recriacao do container
- sucesso/falha da criacao do container
- `container_id` novo
- inicio de health check HTTP
- cada tentativa de health check relevante, com `attempt`, `max_attempts`, `status_code` e `deadline_ms`
- resultado final do health check HTTP
- inicio de readiness gRPC ou probe de porta
- resultado do readiness gRPC
- inicio da chamada `RequestConnection`
- endereco gRPC usado (`grpc_address`)
- deadline da chamada
- erro, retry, fallback ou sucesso da chamada
- se o worker retornou `has_qr=true`, `qr_hash` e `qr_length`
- publish para Centrifugo, incluindo canal e resultado
- resposta final ao Manager
- resposta final HTTP para a tela

Se o helper atual descarta `started`, `success`, `received`, `created`, `completed` ou eventos de progresso, a implementacao deve ser ajustada para o modo de debug de conexao permitir esses eventos quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true`. O objetivo deste flag e investigacao ponta a ponta; durante a investigacao, eventos de progresso sao necessarios para enxergar onde a conexao realmente parou.

Para controlar custo e volume:

- manter truncamento de payload por `CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT` e `CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT`
- nunca logar QR completo nem codigo de pareamento completo
- usar `has_qr`, `qr_hash`, `qr_length`, `has_pairing_code`, `pairing_code_hash`, `pairing_code_length`
- desligar o flag depois da investigacao

## Campos Minimos Novos Para Implementar

Adicionar aos logs de conexao quando existirem:

- `container_id`
- `container_name`
- `container_state`
- `container_status`
- `container_started_at`
- `container_finished_at`
- `health_url`
- `health_status_code`
- `health_attempt`
- `health_max_attempts`
- `health_delay_ms`
- `grpc_ready`
- `grpc_probe_address`
- `grpc_probe_error`
- `server_id`
- `server_name`
- `server_web_domain`
- `worker_type_name`
- `worker_status_id`
- `previous_worker_status_id`
- `centrifugo_channel`
- `publish_result`

## Plano Implementado: Correcao Sincrona Do QR E Logs Ponta A Ponta

### Resumo

- Manter o request de QR 100% sincrono: o endpoint prepara/valida container, aguarda health/readiness, chama `RequestConnection` e retorna o QR na propria resposta.
- Nao criar fallback, retry ou QR em segundo plano no fluxo de QR.
- Com `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true`, registrar progresso e erros do Manager, Balancer, Docker/container, health HTTP, readiness gRPC, worker gRPC, publish e resposta HTTP.

### Mudancas Principais

- Ajustar `connectionLifecycleDebug` para emitir eventos de progresso (`received`, `started`, `success`, `created`, `completed`) quando o flag de conexao estiver ativo.
- Manter truncamento e sanitizacao: nunca logar QR/pairing code completo; usar so `has_*`, hash e length.
- Adicionar inspecao detalhada de container no `WorkerService`, retornando `container_id`, `container_name`, `container_state`, `container_status`, `container_started_at`, `container_finished_at` e `running`.
- Adicionar health detalhado no `ContainerHealthService`, mantendo `isServiceHealthy` compativel e expondo tentativas, URL, status HTTP, delay e resultado final.
- Adicionar readiness gRPC no `WorkerBaileysGrpcClientService` via `client.waitForReady()`, sem alterar proto.
- Aumentar a deadline Manager -> Balancer do QR para cobrir o fluxo sincrono completo; manter deadline propria na chamada Balancer -> Worker.

### Fluxo De QR

1. `WorkerConnectionQrCodeRequesterUseCase` registra entrada, validacao de worker/account, resolucao de `server_id`, endereco gRPC do Balancer e resposta final.
2. `runConnectionQrCodeWorkflow` resolve worker/account/server/type/status e loga os campos.
3. O Balancer inspeciona o container pelo `worker_id`.
4. Se existir e estiver `running`, checa HTTP health usando `container_id`.
5. Se faltar, estiver parado/dead/restarting problematico ou health falhar, remove/recria sincronicamente.
6. Apos container saudavel, aguarda readiness gRPC com `waitForReady`.
7. So entao chama `RequestConnection` para QR.
8. Retorna QR na resposta direta ou lanca erro claro.
9. Se o worker estiver `creating/recreating`, o QR request aguarda o container chegar a health/readiness antes de decidir recriar.
10. `startConnectionRequestRetry` nao deve ser usado para QR.

### Logs E Tela

- Incluir logs de criacao/recriacao, remocao, health por tentativa, readiness gRPC, chamada `RequestConnection`, sucesso/erro com `qr_hash`/`qr_length`, publish Centrifugo com canal/resultado e resposta HTTP.
- Atualizar `apps/web/src/pages/connection/external/[token].vue` para tratar `data.qrcode` no evento assincrono igual a resposta direta.
- Atualizar `docs/LIFECYCLE_DEBUG_LOGS.md` para refletir que `connection_lifecycle` loga progresso quando ativo; `message_lifecycle` permanece focado em excecoes.

### Testes

- Atualizar contratos de `connectionLifecycleDebug` para garantir emissao de `success/started` e sanitizacao de QR.
- Atualizar contratos de `ContainerHealthService` para tentativas/status detalhados.
- Atualizar contratos de `WorkerCommandHandlerService` cobrindo container pronto, container nao saudavel, container inexistente, falha de readiness e ausencia de retry em background para QR.
- Rodar:

```bash
pnpm test -- packages/tests/contracts/plugins/telemetry/connectionLifecycleDebug.contract.test.ts packages/tests/contracts/services/containerHealth.service.contract.test.ts packages/tests/contracts/services/workerCommandHandler.service.test.ts
pnpm --filter web typecheck
```

Com ambiente E2E disponivel, rodar:

```bash
pnpm run e2e:connections
```

### Assumptions

- Readiness gRPC sera via `waitForReady`, sem novo RPC.
- Endpoint e shape da resposta HTTP nao mudam.
- Reset/recreate continua sendo acao separada; a solicitacao de QR nao cria QR em background.

## Consultas Uteis No Loki

Por worker:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| worker_id="019e6753-3945-75d2-a1d4-3e2de147a725"
```

Erros de QR:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| worker_id="019e6753-3945-75d2-a1d4-3e2de147a725"
| outcome=~"error|failed|timeout|retrying|partial_error"
```

Eventos do worker que retornaram QR:

```logql
{service_name="baileys"}
| worker_id="019e6753-3945-75d2-a1d4-3e2de147a725"
| has_qr="true"
```

Timeout gRPC do Balancer para worker:

```logql
{service_name="balance"}
| debug_index="connection_lifecycle"
| grpc_address="019e6753-3945-75d2-a1d4-3e2de147a725:50052"
```

## Criterio De Aceite Da Correcao

A correcao deve ser considerada pronta quando:

- uma tentativa de QR com container inexistente cria o container, aguarda readiness e retorna QR sem `500`
- uma tentativa de QR com container existente mas nao saudavel recria ou recupera o container antes da chamada gRPC final
- uma tentativa de QR com worker pronto retorna QR na resposta direta
- se o QR chegar por evento assincrono, a tela externa tambem exibe o QR
- os logs `connection_lifecycle` mostram a sequencia completa de Manager, Balancer, container, health, gRPC, worker e publish
- nao ha QR completo nem pairing code completo nos logs
