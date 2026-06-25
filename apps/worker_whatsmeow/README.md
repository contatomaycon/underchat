# worker_whatsmeow

Worker WhatsApp nativo em Go baseado em `go.mau.fi/whatsmeow`, integrado como terceiro provider ao lado de `worker_baileys` e `worker_wwebjs`.

## Estrutura

- `cmd/worker`: entrada do binario.
- `internal/app`: codigo do worker Underchat.
- `forks/whatsmeow`: fork vendorizado da lib whatsmeow. Tudo dentro desta pasta deve ser tratado como codigo do fork.
- `forks/README.md`: nota curta sobre a separacao do fork.
- `Dockerfile`: build Go nativo, sem Node/Chrome.

O `go.mod` usa:

```go
replace go.mau.fi/whatsmeow => ./forks/whatsmeow
```

## Runtime

- HTTP health: `:3005`
  - `/v1/health/check`
  - `/v1/connection/health/check`
- gRPC `worker_connection.WorkerConnection`: `:50054`
- Storage local da sessao: `/app/data/whatsmeow/${WORKER_ID}/store.db`
- Imagem default: `under-worker-whatsmeow:latest`

O container recebe as mesmas variaveis globais dos workers existentes via `WorkerService`, incluindo Kafka, Redis, S3, Centrifugo, balance gRPC e proxy.

## Kafka

Consumidores:

- `worker.${WORKER_ID}.send.message`
- `worker.${WORKER_ID}.schedule.send.message`
- `worker.${WORKER_ID}.validate.phone`
- `worker.${WORKER_ID}.notification.message`
- `worker.${WORKER_ID}.webhook.integration`
- `mark.message.read`
- `worker.config.update`

Publicadores:

- `upsert.message`
- `update.message`
- `update.message.status`
- `phone.validation.response`
- `user.phone.jid.update`
- `schedule.status.update`
- `update.profile.status.external.id`
- eventos de conexao, QR code, pairing code, status e presenca via Centrifugo

## Cobertura

Coberto:

- Conexao por QR code e pairing code.
- Bootstrap/reconnect, logout e remocao de sessao via gRPC.
- Health HTTP e bridge gRPC usada pelo balance.
- Validacao de telefone com `IsOnWhatsApp`.
- Envio de texto, imagem, video, video note, audio, voice note, documento, sticker, localizacao, contato unico, lista de contatos, reacao, edicao e revoke/delete.
- Quoted message simples, mentions, view-once em midia de saida e link preview basico quando o payload ja traz os metadados.
- Mensagens agendadas, notificacoes e webhook integration.
- Mensagens recebidas comuns e download de midia para S3.
- Mensagens recebidas com wrappers `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension`, `documentWithCaptionMessage`, `lottieStickerMessage` e `editedMessage`, alinhado ao `unwrapMessage` usado pelo Baileys.
- Mensagens recebidas de sistema para pin/unpin e configuracao de mensagens temporarias (`set_disappearing_messages`), publicadas no mesmo contrato consumido por `MessageUpsert`.
- Templates recebidos com `hydratedTemplate` sao classificados como texto, como no Baileys.
- Conversas LID usam `remoteJidAlt` quando o whatsmeow entrega alias PN, evitando descarte por telefone ausente.
- Foto de contato em mensagens e chamadas recebidas via `GetProfilePictureInfo`, persistida no S3 pelo proprio worker antes do `upsert.message`, com cache Redis e fallback sem foto quando o WhatsApp negar ou nao houver imagem.
- Receipts de enviada/entregue/lida/reproduzida mapeados para `update.message.status`.
- Mark read.
- Presenca/digitando via Centrifugo.
- Chamadas recebidas como evento de mensagem, auto-reject e auto-reply usando o contrato gRPC do balance.
- Upload/download de midia com fallback explicito para S3 backup.
- Stories/status de perfil: envio best-effort de texto, imagem, video e audio para `status@broadcast`, publicando `update.profile.status.external.id`.
- Delete/revoke de status por `external_id` em modo best-effort.
- Perfil: atualizacao do "about/status" e foto/remocao de foto em modo best-effort.

## Cobertura Parcial

- `statusJidList` em stories/status nao e aplicado com seguranca no whatsmeow atual. Quando vier lista customizada, o worker falha com `unsupported_whatsmeow_feature:status_custom_audience`.
- Nome de perfil nao tem metodo publico seguro no whatsmeow vendorizado; payload com `name` falha com `unsupported_whatsmeow_feature:profile_name`.
- Link preview nao faz fetch automatico nem gera thumbnail; usa apenas `matchedText`, `title`, `description` e `jpegThumbnail` quando ja vierem no payload.
- Quoted message rico e reconstruido como quoted textual quando nao ha representacao comum segura.
- Tipo de chamada de video e confiavel em `CallOfferNotice`; em `CallOffer` puro fica best-effort conforme metadados do evento.
- Midia recebida que nao puder ser baixada ou enviada ao S3 segue para o contrato com `media_download_failed: true`.
- Mensagem recebida view-once segue a paridade do Baileys: publica `type=view_once` e nao baixa/armazena a midia.
- Falhas terminais de mensagens sao registradas em log/estado e o offset e avancado; nao ha redrive por topico Kafka.
- Reacao criptografada (`encReactionMessage`) e classificada como `react`, mas a atualizacao depende do payload trazer chave alvo suficiente no protojson.

## Unsupported Explicito

O worker nao ignora payload rico sem mapeamento seguro. Estes casos viram erro terminal `unsupported_whatsmeow_feature:<feature>` sem redrive automatico:

- iniciar ou aceitar chamada de voz/video pelo worker.
- broadcast lists comuns.
- envio de botoes, listas, templates, produtos, polls e flows.
- envio de pin, disappearing/ephemeral, forward e payloads interativos sem representacao comum.
- stories/status com audiencia customizada.
- nome de perfil.
- mensagens recebidas de polls, produtos, listas, flows, albuns ou payloads comerciais ricos continuam sem conversao comum segura; sao ignoradas quando nao houver representacao textual/media equivalente.

## Integracao TypeScript Verificada

- `EWorkerType.whatsmeow = e80ad183-2b46-4628-9105-a036f2d28720`.
- `EWorkerImage.whatsmeow = under-worker-whatsmeow:latest`.
- `EServerBuildType.whatsmeow`.
- `ERouteModule.worker_whatsmeow`.
- Migration Atlas para inserir `worker_type = whatsmeow`.
- Build server, Harbor, default images, install scripts Ubuntu, schemas e i18n reconhecem `whatsmeow`.
- `WorkerBaileysGrpcClientService` roteia `whatsmeow` para a porta `50054`.
- `WorkerCommandHandlerService` e `WorkerService` contemplam create/recreate, health e env do container.

## Manutencao

Quando atualizar `packages/proto/*.proto`, atualizar tambem `internal/app/proto_dynamic.go`, pois o worker Go usa descriptors dinamicos para nao depender de geracao TS/Node.

Comandos usados para validacao local:

```bash
go test ./...
pnpm build:worker_whatsmeow
docker build -f apps/worker_whatsmeow/Dockerfile -t under-worker-whatsmeow:latest .
pnpm test -- packages/tests/contracts/services/workerBaileysGrpcClient.service.contract.test.ts packages/tests/contracts/useCases/server/ServerBuildGenerator.useCase.contract.test.ts packages/tests/contracts/services/workerCommandHandler.service.test.ts
```
