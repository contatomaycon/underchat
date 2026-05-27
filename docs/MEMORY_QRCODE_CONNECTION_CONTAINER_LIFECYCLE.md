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

## Adendo 2026-05-27: Diagnostico WWebJS

### Contexto Do Teste

- Worker: `019e6753-3945-75d2-a1d4-3e2de147a725`
- Nome: `vas`
- `worker_type`: `wwebjs`
- Request lento observado: `POST /connection/qrcode`
- Inicio aproximado: `2026-05-27T15:36:45Z`
- Resposta: `2026-05-27T15:37:36Z`
- Duracao no Manager: `50272ms`
- Trace id principal: `a3dd66a28bb03809b8de13217060844b`

### Linha Do Tempo Observada

- `2026-05-27T15:36:46Z`: o Balancer recebeu o pedido de QR e resolveu o worker como `worker_type_name=wwebjs`.
- `2026-05-27T15:36:46Z`: a inspecao Docker encontrou um container existente:
  - `container_id=6f901a056636cdb8c544b26c03032be446f6dd03de3fd6d8a82ac69b47c0ef45`
  - `container_name=019e6753-3945-75d2-a1d4-3e2de147a725`
  - `container_state=running`
  - `container_status=running`
  - `container_started_at=2026-05-27T15:36:25.139076908Z`
- `2026-05-27T15:36:49Z` ate `2026-05-27T15:37:25Z`: o health HTTP do container existente falhou em todas as `10/10` tentativas com `status_code=000`.
- Cada tentativa do container existente consumiu cerca de `3000ms` de timeout HTTP mais `1000ms` de intervalo.
- `2026-05-27T15:37:25Z`: o container existente foi considerado `unhealthy`, com motivo `http_health_not_ready`.
- `2026-05-27T15:37:25Z`: o Balancer decidiu recriar o container com `reason=container_unhealthy`.
- `2026-05-27T15:37:26Z`: o container antigo foi removido e um novo container foi criado com imagem `under-worker-wwebjs:latest`.
- Novo container:
  - `container_id=7bbc038e4cc5561a3b6a92a122961ec12f6e4384e0aae0b59a2f5857d8dd62a8`
  - `worker_type=wwebjs`
- `2026-05-27T15:37:31Z`: o novo container ficou saudavel na tentativa `6/30`.
- `2026-05-27T15:37:31Z`: a readiness gRPC para `019e6753-3945-75d2-a1d4-3e2de147a725:50053` passou.
- `2026-05-27T15:37:31Z`: o Balancer chamou `RequestConnection` no worker WWebJS.
- `2026-05-27T15:37:36Z`: o worker WWebJS gerou QR:
  - `status=connecting`
  - `code=202`
  - `has_qr=true`
  - `qr_length=6282`
  - `qr_hash=8ee870e8f3b0fbd4`
- `2026-05-27T15:37:36Z`: o Manager respondeu `200`.

### Causa Do Atraso

O atraso nao ocorreu na geracao do QR pelo WWebJS. Depois que o novo container ficou pronto, o worker gerou QR em cerca de `5s`.

O atraso ocorreu antes, no caminho de reaproveitamento de container existente. O Balancer encontrou um container antigo em estado `running`, mas o health HTTP nunca respondeu. Mesmo assim, o fluxo aguardou o budget completo de `10` tentativas antes de remover e recriar o container. Esse trecho consumiu cerca de `39s` do request.

Hipotese provavel: o worker havia acabado de mudar de tipo para `wwebjs`, mas ainda existia um container nomeado pelo mesmo `worker_id` que estava `running` e nao estava saudavel para o tipo atual. O fluxo validou apenas existencia/estado/health, sem decidir recriacao imediata por divergencia de tipo, imagem, label ou configuracao esperada.

### Diferenca Em Relacao Ao Baileys

O Baileys ja foi corrigido e passou a abrir rapidamente porque o fluxo chega ao worker correto sem pagar o custo de recuperar um container antigo que falha no health.

No teste WWebJS, o novo container tambem respondeu rapido depois de criado:

- container novo saudavel em cerca de `5s`
- readiness gRPC passou imediatamente depois do health
- QR gerado cerca de `5s` depois do `RequestConnection`

Portanto, o gargalo especifico deste teste foi o container existente/stale, nao o motor WWebJS em si.

### Risco Na Tela

Os logs mostram que o backend gerou e publicou QR com `has_qr=true`. Se a tela continuar parada em `Iniciando conexao`, investigar o frontend/evento assincrono:

- confirmar se o componente aplica `data.qrcode` vindo do evento de status/conexao
- garantir que o handler assincrono atualize o mesmo estado usado pela resposta direta do endpoint
- nao depender apenas da resposta direta quando o QR chegar por evento de publish

Esse ponto permanece importante porque o backend pode gerar QR corretamente e ainda assim a UI ficar presa em loading se ignorar o payload assincrono com QR.

### Correcao Recomendada Para WWebJS

Implementar deteccao de incompatibilidade antes do health longo do container existente:

- Ao inspecionar um container existente, logar e validar:
  - imagem atual do container
  - labels do container
  - envs relevantes, especialmente `WORKER_TYPE`, portas HTTP/gRPC e identificadores do worker
  - porta gRPC esperada para o tipo atual
  - imagem esperada para o tipo atual
- Se o banco diz `worker_type=wwebjs`, mas o container existente nao for claramente `under-worker-wwebjs:latest` ou nao tiver label/env compativel, remover e recriar imediatamente.
- Separar o budget de health em dois modos:
  - container existente: health curto, por exemplo `2` ou `3` tentativas, suficiente para detectar container realmente pronto
  - container recem-criado: health completo, por exemplo `30` tentativas, porque startup real pode levar alguns segundos
- Para requests de QR, nao gastar o budget longo tentando recuperar container antigo que ja falhou no health basico.
- Incluir `recreate_reason=worker_type_mismatch`, `image_mismatch`, `label_mismatch` ou `existing_container_health_failed` nos logs.

### Requisito De Debug Quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true`

Quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED` estiver ativo, o debug precisa cobrir o ciclo inteiro da conexao, do comeco ao fim:

- entrada do request no Manager
- validacao do worker/account
- resolucao de server, worker status e worker type
- decisao de criar, reaproveitar, remover ou recriar container
- inspecao do container existente, incluindo imagem, labels e envs sanitizadas
- criacao do container, incluindo imagem, portas, network, labels e resultado Docker
- health HTTP do container, com tentativa, status, erro e duracao
- readiness gRPC, com endereco, deadline e erro quando houver
- chamada `RequestConnection`
- resposta do worker, com `has_qr`, `qr_hash`, `qr_length`, status e code
- publish para eventos assincronos
- resposta HTTP final do Manager

Nao logar QR completo, pairing code completo, token, senha ou segredo. Usar somente flags, hash e length.

## Adendo 2026-05-27: Diagnostico Worker Novo Baileys `teste`

### Contexto Do Teste

- Worker: `019e6a1c-0f41-7418-a6b4-180868d714fb`
- Nome: `teste`
- `worker_type`: `baileys`
- Status atual no banco: `disponible`
- Server: `Servidor 2`
- Account: `UnderChat`
- `created_at`: `2026-05-27T15:44:44.352109Z`
- `container_id` atual no banco: `270e370df6276125f707ef6e32d99724d54ff923d32cec663392ef49f440a56e`
- Request lento observado: `POST /v1/worker/019e6a1c-0f41-7418-a6b4-180868d714fb/connection/qrcode`
- Inicio do request no Manager: `2026-05-27T15:44:53.863Z`
- Resposta do Manager: `2026-05-27T15:45:39.572Z`
- Duracao do request: `45709ms`
- Trace id principal do QR: `0fdf94298910557d0853d91d590491b0`

### Linha Do Tempo Observada

Criacao do worker:

- `2026-05-27T15:44:44.102Z`: `POST /v1/worker` entrou no Manager.
- `2026-05-27T15:44:44.352Z`: registro do worker foi criado no banco.
- `2026-05-27T15:44:44.765Z`: Balancer iniciou criacao de container com imagem `under-worker-baileys:latest`.
- `2026-05-27T15:44:44.982Z`: container inicial foi criado:
  - `container_id=adb0861e8f3d5c797c6aed885981de9c00cd30030ab8df90819d696cdfb66711`
- Health da criacao inicial:
  - `2026-05-27T15:44:45.039Z`: tentativa `1/30`, `health_status_code=000`
  - `2026-05-27T15:44:47.110Z`: tentativa `2/30`, `health_status_code=000`
  - `2026-05-27T15:44:49.175Z`: tentativa `3/30`, `health_status_code=200`
- `2026-05-27T15:44:48.931Z`: Balancer recebeu `NotifyWorkerStatus` para o worker.
- `2026-05-27T15:44:49.185Z`: `POST /v1/worker` respondeu `200` apos `5083ms`.

Pedido de QR logo depois da criacao:

- `2026-05-27T15:44:53.863Z`: `POST /connection/qrcode` entrou no Manager.
- `2026-05-27T15:44:54.035Z`: Balancer resolveu o worker como `worker_type_name=baileys`.
- `2026-05-27T15:44:54.037Z`: Balancer inspecionou o container inicial:
  - `container_id=adb0861e8f3d5c797c6aed885981de9c00cd30030ab8df90819d696cdfb66711`
  - `container_state=running`
  - `container_status=running`
  - `container_started_at=2026-05-27T15:44:44.851211663Z`
- Health do container inicial durante o QR:
  - `2026-05-27T15:44:57.093Z`: tentativa `1/10`, `health_status_code=000`
  - `2026-05-27T15:45:01.150Z`: tentativa `2/10`, `health_status_code=000`
  - `2026-05-27T15:45:05.206Z`: tentativa `3/10`, `health_status_code=000`
  - `2026-05-27T15:45:09.264Z`: tentativa `4/10`, `health_status_code=000`
  - `2026-05-27T15:45:13.322Z`: tentativa `5/10`, `health_status_code=000`
  - `2026-05-27T15:45:17.379Z`: tentativa `6/10`, `health_status_code=000`
  - `2026-05-27T15:45:21.436Z`: tentativa `7/10`, `health_status_code=000`
  - `2026-05-27T15:45:25.490Z`: tentativa `8/10`, `health_status_code=000`
  - `2026-05-27T15:45:29.586Z`: tentativa `9/10`, `health_status_code=000`
  - `2026-05-27T15:45:33.711Z`: tentativa `10/10`, `health_status_code=000`
- `2026-05-27T15:45:33.712Z`: health falhou com `reason=http_health_not_ready`.
- `2026-05-27T15:45:33.713Z`: Balancer decidiu recriar com `reason=container_unhealthy`.
- `2026-05-27T15:45:34.126Z`: container inicial foi removido.
- `2026-05-27T15:45:34.128Z`: Balancer iniciou nova criacao com imagem `under-worker-baileys:latest`.
- `2026-05-27T15:45:34.302Z`: novo container foi criado:
  - `container_id=270e370df6276125f707ef6e32d99724d54ff923d32cec663392ef49f440a56e`
- Health do container novo:
  - `2026-05-27T15:45:34.363Z`: tentativa `1/30`, `health_status_code=000`
  - `2026-05-27T15:45:35.421Z`: tentativa `2/30`, `health_status_code=000`
  - `2026-05-27T15:45:36.482Z`: tentativa `3/30`, `health_status_code=000`
  - `2026-05-27T15:45:37.545Z`: tentativa `4/30`, `health_status_code=000`
  - `2026-05-27T15:45:38.613Z`: tentativa `5/30`, `health_status_code=200`
- `2026-05-27T15:45:38.651Z`: readiness gRPC passou em `019e6a1c-0f41-7418-a6b4-180868d714fb:50052`.
- `2026-05-27T15:45:38.652Z`: Balancer chamou `RequestConnection`.
- `2026-05-27T15:45:39.509Z`: worker Baileys gerou QR.
- `2026-05-27T15:45:39.564Z`: worker respondeu sucesso:
  - `status=connecting`
  - `code=202`
  - `has_qr=true`
  - `qr_length=6378`
  - `qr_hash=88e0347b803200ab`
- `2026-05-27T15:45:39.572Z`: Balancer retornou sucesso e o Manager respondeu `200`.

### Causa Do Atraso

O atraso nao ocorreu na geracao do QR pelo Baileys. Depois que o container novo ficou saudavel e gRPC ready, o QR foi gerado em menos de `1s`.

O atraso ocorreu porque a criacao inicial marcou o worker como pronto depois de um unico health `200`, mas o mesmo container passou a retornar `000` poucos segundos depois, quando o QR foi solicitado.

Na pratica, houve um falso positivo de readiness na criacao:

- `createWorker` considerou o container inicial pronto com `isServiceHealthy`.
- O worker foi atualizado para `disponible`.
- O frontend solicitou QR cerca de `4s` depois.
- O Balancer encontrou o container `running`, mas o health HTTP nao respondia.
- O fluxo de QR gastou `10` tentativas com deadline HTTP de `3000ms` e intervalo de `1000ms`, consumindo cerca de `39s`.
- So depois disso removeu o container e criou outro.

O container recriado funcionou corretamente. O problema principal e o caminho entre criacao e primeiro QR: a aplicacao publica/retorna `disponible` antes de garantir que o container esta estavel e pronto para receber conexao.

### Evidencias Importantes

- O `POST /v1/worker` demorou `5083ms` e respondeu `200`.
- O container inicial `adb086...` teve health `200` na tentativa `3/30`.
- O mesmo container `adb086...`, cinco segundos depois, falhou `10/10` no health durante o QR com `health_status_code=000`.
- Nao apareceram logs de startup do worker Baileys para o container inicial `adb086...` na janela analisada; os logs de consumidores Kafka apareceram para o container recriado `270e370...`.
- O container novo `270e370...` ficou saudavel na tentativa `5/30`, passou readiness gRPC e gerou QR normalmente.

### Correcao Recomendada

1. Nao marcar worker como `disponible` apenas com um unico HTTP health `200`.
   - Em `packages/services/workerCommandHandler.service.ts`, no metodo `createWorker`, apos `containerHealthService.isServiceHealthy`, aguardar tambem readiness gRPC do worker pelo tipo correto.
   - Para Baileys, validar `waitForReady(worker_id, worker_type_id, timeout)` em `:50052`.
   - So atualizar `worker_status_id=disponible` depois de HTTP health e gRPC readiness passarem.

2. Exigir health estavel antes de finalizar criacao.
   - Alterar `ContainerHealthService` para aceitar uma opcao como `requiredConsecutiveSuccesses`.
   - Na criacao, exigir pelo menos `2` ou `3` sucessos HTTP `200` consecutivos antes de considerar o container saudavel.
   - Isso evita o caso observado: um unico `200` momentaneo seguido de varios `000`.

3. Reduzir o custo de falha para container existente no fluxo de QR.
   - Em `ensureQrContainerReady`, o caminho de container existente usa `maxAttempts: 10` e `delayMs: 1000`.
   - Para QR, usar health curto em container existente, por exemplo `2` ou `3` tentativas.
   - Manter budget longo apenas para container recem-criado.
   - Se um container `disponible` falha health curto, recriar rapido em vez de bloquear a tela por `40s`.

4. Manter status `creating` ate readiness real.
   - Se o container ainda esta bootando, o QR deve cair no caminho `waitForExistingQrContainerReady`, nao no caminho de container `disponible` que espera `10` health checks e so depois recria.
   - O status `disponible` deve significar "HTTP health estavel + gRPC ready", nao apenas "Docker running + um health 200".

5. Capturar diagnostico do container que sera removido.
   - Quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true` e um container falhar health antes de remocao, registrar:
     - `docker inspect` com imagem, estado, exit code, started_at, finished_at, restart_count, health se existir
     - ultimas linhas de `docker logs --tail`, sanitizadas
     - erro do `curl` no health, nao apenas `000`
   - Isso e necessario porque neste teste o container inicial falhou depois de parecer saudavel, mas nao deixou logs de app visiveis no Loki antes da remocao.

6. Corrigir lacuna de contexto nos logs da criacao.
   - No trace inicial `aee168604303da15918b10f806b135a8`, varios eventos de criacao/health nao carregaram `worker_id`, `account_id` e `worker_type` como labels/campos.
   - Todos os eventos `container_create_*` e `container_health_*` devem incluir esses campos quando o debug estiver ativo.

### Resolucao Esperada

Com a correcao, o fluxo de criar worker e abrir QR deve ficar assim:

1. `POST /v1/worker` cria o container.
2. Balancer aguarda HTTP health estavel.
3. Balancer aguarda readiness gRPC.
4. So entao marca o worker como `disponible`.
5. Ao clicar QR, o Balancer encontra container realmente pronto.
6. `RequestConnection` e chamado sem recriar container.
7. QR deve aparecer em poucos segundos.

Se o container cair entre a criacao e o QR:

1. QR faz health curto no container existente.
2. Se falhar, registra diagnostico completo.
3. Remove/recria imediatamente.
4. Aguarda readiness do container novo.
5. Retorna QR na resposta direta.

### Arquivos Provaveis Para Alterar

- `packages/services/workerCommandHandler.service.ts`
  - `createWorker`
  - `ensureQrContainerReady`
  - `waitForExistingQrContainerReady`
- `packages/services/containerHealth.service.ts`
  - adicionar suporte a `requiredConsecutiveSuccesses`
  - registrar erro detalhado do `curl`/exec quando `health_status_code=000`
- `packages/services/worker.service.ts`
  - incluir labels/envs de worker em container inspect/create
  - logar imagem, labels e envs sanitizadas
- `packages/tests/contracts/services/workerCommandHandler.service.test.ts`
  - cobrir criacao que so marca `disponible` depois de health estavel + gRPC ready
  - cobrir QR com container existente unhealthy recriando rapido
- `packages/tests/contracts/services/containerHealth.service.contract.test.ts`
  - cobrir sucessos consecutivos exigidos
  - cobrir `000` com detalhe de erro sanitizado

### Consultas Loki Usadas

Por worker:

```logql
{service_name=~".+"}
|= "019e6a1c-0f41-7418-a6b4-180868d714fb"
```

Lifecycle de QR:

```logql
{service_name=~".+"}
| debug_index="connection_lifecycle"
| worker_id="019e6a1c-0f41-7418-a6b4-180868d714fb"
```

Container inicial:

```logql
{service_name="balance"}
| debug_index="connection_lifecycle"
| container_id="adb0861e8f3d5c797c6aed885981de9c00cd30030ab8df90819d696cdfb66711"
```

Container recriado:

```logql
{service_name="balance"}
| debug_index="connection_lifecycle"
| container_id="270e370df6276125f707ef6e32d99724d54ff923d32cec663392ef49f440a56e"
```

## Adendo 2026-05-27: Criacao Lenta E Erro Do Canal `Vasco`

### Contexto Do Caso

- Worker: `019e6a6b-5103-72b3-90fd-3599264bd132`
- Nome: `Vasco`
- `worker_type`: `baileys`
- Server: `Servidor 2`
- Account: `UnderChat`
- `created_at`: `2026-05-27T17:11:18.532835Z`
- Sintoma observado:
  - ao criar canal, o modal fica carregando por muito tempo
  - depois de `F5`, o canal aparece como `error`
  - ao clicar em `Recriar Canal`, o canal sobe rapido e fica `disponible`
- Container inicial que falhou: `be87ea524b52a81ae159a0428e18f994bf33b1a4533d55611c5e2b694ce25ee8`
- Container apos recriar: `5aee8bebc00854105f42e77b72319a722f2b770c97c90dcc264ab09902b44b95`

### Linha Do Tempo Da Criacao Inicial

- `2026-05-27T17:11:18.221Z`: `POST /v1/worker` entrou no Manager.
- `2026-05-27T17:11:19.094Z`: Balancer iniciou o lifecycle `create_worker`.
- `2026-05-27T17:11:19.321Z`: Balancer criou container com imagem `under-worker-baileys:latest`.
- `2026-05-27T17:11:19.507Z`: container inicial foi criado:
  - `container_id=be87ea524b52a81ae159a0428e18f994bf33b1a4533d55611c5e2b694ce25ee8`
- Health HTTP do container inicial:
  - tentativas `1/30` a `5/30`: `health_status_code=000`
  - tentativa `6/30`: `health_status_code=200`, mas apenas `healthy_waiting_for_stability`
  - tentativas `7/30` a `30/30`: `health_status_code=000`
- O health exigia `required_consecutive_successes=3`.
- A tentativa final teve:
  - `health_status_code=000`
  - `health_error=curl_exit_code=28`
  - `health_duration_ms=3060`
  - `reason=http_health_not_ready`
- `2026-05-27T17:13:02.385Z`: health falhou em definitivo.
- `2026-05-27T17:13:02.451Z`: Balancer publicou status `error`.
- `2026-05-27T17:13:02.546Z`: Manager respondeu `500`.
- Duracao do `POST /v1/worker`: `104324ms`.
- Erro final: `Worker service is not healthy`.

### Linha Do Tempo Da Recriacao

- `2026-05-27T17:13:52.970Z`: `PATCH /v1/worker/019e6a6b-5103-72b3-90fd-3599264bd132` entrou no Manager.
- `2026-05-27T17:13:53.181Z`: Balancer iniciou lifecycle `recreate_worker`.
- `2026-05-27T17:13:53.472Z`: Balancer inspecionou o container antigo `be87...` como `running`.
- `2026-05-27T17:13:53.644Z`: removeu o container antigo.
- `2026-05-27T17:13:54.145Z`: criou novo container:
  - `container_id=5aee8bebc00854105f42e77b72319a722f2b770c97c90dcc264ab09902b44b95`
- Health HTTP do container novo:
  - tentativas `1/30` a `4/30`: `health_status_code=000`
  - tentativa `5/30`: `200`, ainda aguardando estabilidade
  - tentativa `6/30`: `200`, ainda aguardando estabilidade
  - tentativa `7/30`: `200`, `healthy`
- `2026-05-27T17:14:00.599Z`: readiness gRPC passou em `019e6a6b-5103-72b3-90fd-3599264bd132:50052`.
- `2026-05-27T17:14:00.687Z`: status `disponible` publicado.
- Duracao do `PATCH`: `208ms` no Manager; o trabalho assincrono do Balancer levou cerca de `7s`.

### Causa Do Problema

O problema nao foi o banco nem o frontend. O backend ficou preso esperando a criacao inicial terminar.

O container inicial `be87...` iniciou, chegou a responder um unico health `200`, mas nao conseguiu manter `3` sucessos consecutivos. Depois disso, todas as chamadas de health deram `000` com `curl_exit_code=28`, ou seja, o `curl` dentro do container estourou timeout ao chamar `http://127.0.0.1:3005/v1/health/check`.

Como a criacao inicial espera `30` tentativas com deadline HTTP de `3000ms` e delay de `1000ms`, o request ficou bloqueado por cerca de `104s`. Ao final, o worker foi marcado como `error`. Quando o usuario clicou em recriar, o container ruim foi removido e um novo container subiu normalmente.

Em termos praticos: a primeira criacao sofreu um container de boot instavel/flapping. O sistema detectou a falha, mas demorou demais e nao tentou automaticamente o mesmo remedio que o usuario aplicou manualmente: remover e recriar o container.

### Lacuna De Telemetria Encontrada

Os logs foram suficientes para ver onde o tempo foi gasto, mas nao foram suficientes para explicar por que o container `be87...` parou de responder internamente.

Nao apareceram logs do app `baileys` para o container `be87...` no Loki. So apareceram os health checks feitos pelo Balancer. Ja o container recriado `5aee...` emitiu logs normais de Kafka/notify.

Isso indica que, quando o container falha cedo antes de emitir logs, a investigacao depende de `docker inspect` e `docker logs --tail` coletados pelo Balancer antes de marcar erro/remover.

### Telemetria Implementada

Foi adicionada telemetria defensiva em `packages/services/workerCommandHandler.service.ts`:

- novo helper `recordContainerDiagnosticsSafely(workerId, reason)`
- antes de marcar erro por falha de health na criacao:
  - `reason=create_health_failed`
- antes de marcar erro por falha de readiness gRPC na criacao:
  - `reason=create_grpc_readiness_failed`
- antes de marcar erro por falha de health na recriacao:
  - `reason=recreate_health_failed`
- antes de marcar erro por falha de readiness gRPC na recriacao:
  - `reason=recreate_grpc_readiness_failed`
- o caminho de QR que registra diagnostico antes de recriar agora usa o helper seguro, para diagnostico nao quebrar o fluxo principal.

Tambem foram adicionados testes em:

- `packages/tests/contracts/services/workerCommandHandler.service.test.ts`

Teste executado:

```bash
pnpm test -- packages/tests/contracts/services/workerCommandHandler.service.test.ts
```

Resultado:

- `19` testes passaram.

### Correcao Recomendada Para Resolver O Fluxo

1. Automatizar a recriacao uma vez durante `create_worker`.
   - Se a criacao inicial falhar health, registrar diagnostico, remover o container e tentar criar novamente uma unica vez antes de retornar `500`.
   - Isso espelha o que o usuario fez manualmente e que funcionou.
   - Usar `create_attempt=1/2`, `create_attempt=2/2` nos logs.

2. Detectar health flapping e falhar mais cedo.
   - Se houve pelo menos um `200`, mas em seguida ocorrerem `2` ou `3` timeouts `curl_exit_code=28`, classificar como `health_flapping_after_success`.
   - Nao aguardar todas as `30` tentativas nesse caso.
   - Registrar diagnostico e recriar.

3. Separar timeout de criacao sincronica do tempo de provisionamento.
   - O `POST /v1/worker` nao deve ficar preso por `104s` no modal.
   - Opcoes:
     - manter o request sincrono, mas com retry automatico e limite menor
     - ou retornar rapido com status `creating` e finalizar por evento assincrono
   - Se a UI continuar sincrona, o backend precisa ter limite previsivel, por exemplo `30s` a `45s`.

4. Garantir que erro de criacao publique detalhes operacionais sanitizados.
   - Quando `CONNECTION_LIFECYCLE_DEBUG_ENABLED=true`, logs devem incluir:
     - `worker_id`
     - `account_id`
     - `server_id`
     - `worker_type`
     - `container_id`
     - `create_attempt`
     - `health_attempt`
     - `health_status_code`
     - `health_error`
     - `consecutive_successes`
     - `required_consecutive_successes`
     - `container_diagnostics`

5. Manter a regra: so marcar `disponible` depois de health estavel e gRPC ready.
   - Essa parte esta correta.
   - O problema e que, quando o container nao estabiliza, o sistema deve se recuperar automaticamente em vez de deixar o usuario descobrir e clicar em recriar.

### Resolucao Esperada

Com a correcao completa:

1. Usuario cria canal.
2. Balancer cria container.
3. Se o container fica estavel, marca `disponible`.
4. Se o container flapa ou nao fica saudavel:
   - registra diagnostico
   - remove container ruim
   - cria outro automaticamente uma vez
5. Se a segunda criacao funciona, o usuario ve `disponible` sem precisar dar `F5` nem clicar em `Recriar Canal`.
6. Se a segunda criacao falhar, marca `error`, mas com diagnostico suficiente para saber se foi Docker, health HTTP, gRPC, proxy, Kafka ou startup do worker.

### Consultas Loki Usadas

Trace da criacao inicial:

```logql
{service_name=~"balance|baileys|manager"}
| trace_id="c0caa392f98dd915b428fb1a45c39a10"
```

Trace da recriacao:

```logql
{service_name=~"balance|baileys|manager"}
| trace_id="165352eda18765cd0b86cb785f8db7eb"
```

HTTP do Manager:

```logql
{service_name="manager"}
|= "/v1/worker"
```

Logs do worker Baileys:

```logql
{service_name="baileys"}
|= "019e6a6b-5103-72b3-90fd-3599264bd132"
```
