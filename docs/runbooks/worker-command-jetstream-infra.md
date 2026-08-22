# Runbook de infraestrutura do JetStream de comandos

Este runbook opera o transporte definido em [Transporte central de comandos](../architecture/worker-command-jetstream.md). Ele distingue rigorosamente o ambiente local já entregue da infraestrutura de produção ainda não aplicada.

## Estado desta entrega

Implementado em `/home/maycon/underchat`:

- cluster local JetStream com três nós no `docker-compose.yml`;
- volumes persistentes `nats_data_1`, `nats_data_2` e `nats_data_3`;
- configuração em `infra/nats/nats-server.conf`;
- contratos declarativos em `infra/nats/streams/`;
- bootstrap e verificação idempotentes em `infra/nats/init.sh`;
- variáveis locais em `.env` e contrato documentado em `.env.example`;
- imagens oficiais fixadas em `nats:2.14.3-alpine` e `natsio/nats-box:0.19.7-nonroot`.

Não implementado/aplicado:

- cluster/PVC/Service/Ingress/NetworkPolicy NATS em `/home/maycon/underchat-argocd`;
- endpoint público ou privado de produção;
- TLS, credenciais, secret store, scrape ou alertas de produção;
- alteração do Kafka de produção.

Os valores de senha presentes no exemplo são descartáveis e exclusivos do Compose local. Nunca os promover.

## Contrato local de rede

| Nó             | Cliente anunciado |  Monitor no host | Rota interna do cluster |
| -------------- | ----------------: | ---------------: | ----------------------- |
| `under-nats-1` |  `10.0.2.12:4222` | `127.0.0.1:8222` | `under-nats-1:6222`     |
| `under-nats-2` |  `10.0.2.12:4223` | `127.0.0.1:8223` | `under-nats-2:6222`     |
| `under-nats-3` |  `10.0.2.12:4224` | `127.0.0.1:8224` | `under-nats-3:6222`     |

Publishers executados no host usam `NATS_URL`. Containers de canal ativos ou warm recebem `NATS_PUBLIC_URL`; `WorkerService` escolhe essa lista antes de qualquer `NATS_URL` herdada, remove espaços/duplicatas e a entrega também no nome canônico `NATS_URL`. `NATS_PRIVATE_URL` nunca cruza o boundary desses workers. Os três valores apontam para `10.0.2.12`, usando as portas 4222, 4223 e 4224. Os nomes `under-nats-*` permanecem somente nas rotas Docker internas que formam o cluster e nunca são anunciados aos clientes.

```dotenv
WORKER_COMMAND_TRANSPORT=jetstream
NATS_URL=nats://10.0.2.12:4222,nats://10.0.2.12:4223,nats://10.0.2.12:4224
NATS_PUBLIC_URL=nats://10.0.2.12:4222,nats://10.0.2.12:4223,nats://10.0.2.12:4224
NATS_PRIVATE_URL=nats://10.0.2.12:4222,nats://10.0.2.12:4223,nats://10.0.2.12:4224
```

`NATS_PRIVATE_URL` permanece disponível somente para serviços internos explicitamente autorizados. Ele não é fallback do worker. `WORKER_COMMAND_TRANSPORT` também não é propagado aos containers: o runtime de comandos do worker é JetStream-only por construção.

Kafka não é rota alternativa. Se o cluster não fornecer `PubAck`, o comando é rejeitado/retornado como desconhecido e só pode ser repetido com a mesma identidade dentro da janela de dois minutos.

## Autenticação estática dos runtimes

Produção usa duas identidades de aplicação, entregues pelo secret store como
variáveis de ambiente:

```dotenv
# Service API / plano de controle
NATS_ADMIN_USER=<admin-user>
NATS_ADMIN_PASSWORD=<admin-password>

# Balance e containers de worker
NATS_USER=<runtime-user>
NATS_PASSWORD=<runtime-password>
```

`NATS_SYSTEM_*` e `NATS_ROUTE_*` pertencem exclusivamente à infraestrutura do
cluster. O Balance não cria identidade por canal, não lê `.creds` e não monta
diretório de credenciais. `NATS_TOKEN` e `NATS_CREDS_BASE64` são legados e
devem estar ausentes.

Antes de qualquer criação de volume, remoção ou substituição de container, o
Balance valida que usuário e senha de runtime estão presentes como um par. Um
valor ausente ou parcial interrompe a operação sem tocar no runtime existente.
Cold, recreate e warm recebem a mesma identidade estática; a ativação de um
warm altera a atribuição fenced, mas não transporta nem substitui segredos.

Ao rotacionar a identidade estática, publique primeiro a nova configuração no
NATS e no secret store, faça um rollout coordenado de Service API, Balances e
workers e só então revogue a identidade anterior. Nunca grave usuário/senha em
logs ou em argumentos de processo.

### ACL obrigatória do KV de epoch

O SDK de KV usado pelos três runtimes (`WhatsMeow`, `Baileys` e `WWebJS`)
resolve `KV.Get(worker.<worker_id>)` pela API otimizada de leitura direta. Não
basta autorizar somente `$JS.API.STREAM.MSG.GET...`: o principal do worker
precisa publicar no subject abaixo e receber a resposta pela inbox:

```text
$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.$KV.UC_WORKER_EPOCH_V1.worker.<worker_id>
```

No Compose local e em produção, o principal compartilhado de runtime fica
limitado ao wildcard `worker.*`, além da escrita CAS e das permissões de
watch/consumer descritas no contrato. Nunca conceder `DIRECT.GET ... .>` ao
runtime.

Essa permissão é parte da prontidão, não um detalhe opcional. Sem ela, o
WhatsApp pode autenticar e conectar normalmente, mas o ingress de comandos não
consegue validar o epoch; o canal permanece em `connecting` e falha fechado
antes de aceitar efeitos. O mesmo defeito afeta os três providers.

O `under-nats-init` grava uma chave de probe reservada, executa o direct-get
com a credencial real de runtime, compara o valor e remove o probe. O init deve
encerrar com código diferente de zero se a ACL não funcionar. Em produção,
repetir o mesmo teste com a identidade estática antes do canário, usando uma
chave real já provisionada e sem imprimir a senha:

```bash
nats kv get UC_WORKER_EPOCH_V1 "worker.${WORKER_ID}" \
  --raw --server "${NATS_URL}" --user "${NATS_USER}" --password "${NATS_PASSWORD}"
```

O teste precisa ser executado a partir da mesma rede dos workers. Validar
apenas stream health, quorum ou a credencial administrativa não cobre essa
fronteira.

### Teste obrigatório de reconnect e rebind

O gate não termina quando o socket NATS registra `reconnected`. O runtime só
está recuperado quando uma nova solicitação pull está vinculada ao durable e as
barreiras de health voltaram a autorizar comandos.

Execute o teste com um worker online de cada provider — Baileys, WWebJS e
WhatsMeow — e anote antes da falha o `worker_id`, o nome do durable, a runtime
generation e o container. Para cada worker, confirme o baseline:

```bash
nats consumer info UC_WORKER_COMMANDS_V1 "${DURABLE}" --json \
  | jq '{num_waiting, num_pending, num_redelivered, delivered, ack_floor}'
```

Guarde essa amostra junto dos contadores de requests/pulls e da atividade recente
do consumer. Como o runtime refaz `FetchBatch` com `MaxWait=1s`,
`num_waiting` oscila entre `0` e `1` conforme o timing e o nó/leader consultado;
ele não deve ser usado sozinho como assertiva de sucesso ou falha.

Confirme também no health nativo do runtime:

```json
{
  "command_ingress_ready": true,
  "command_ingress_authorized": true
}
```

Em um ambiente de teste representativo, execute separadamente:

1. restart/troca de leader de um nó NATS por vez;
2. interrupção e retorno de todos os endpoints NATS acessíveis ao runtime, sem
   parar ou recriar os containers dos workers.

Depois de cada cenário, o aceite exige, para os três providers:

- o mesmo runtime/container e a mesma sessão do provider, sem `recreate`;
- o mesmo durable e o mesmo filtro exato por `worker_id`;
- atividade recente de pull no consumer, comprovada por requests/counters que
  avançam, ou por um comando de teste sem efeito em runtime isolado; observar
  `num_waiting=1` na janela de amostragem é evidência adicional;
- `command_ingress_ready=true` e `command_ingress_authorized=true` novamente;
- nenhum backlog, pending ou redelivery inesperado depois da estabilização;
- nenhuma `Authorization Violation` para a credencial scoped e nenhum fallback
  Kafka;
- recuperação dentro do SLO medido e, como limite absoluto deste gate, em menos
  de cinco minutos.

O estado deve ser amostrado até estabilizar, não apenas consultado uma vez.
`num_waiting=0` sustentado só caracteriza falha quando também não há atividade
recente nem novos requests de pull. A oscilação `0`/`1` com counters ativos é
normal para `MaxWait=1s`. Reiniciar/recriar o worker para fazer o teste passar
mascara a falha e reprova o gate.

### Teste obrigatório de outage PostgreSQL e lease dos providers

Execute a mesma matriz para Baileys, WWebJS e WhatsMeow:

| Cenário      | Injeção obrigatória                                                                                   | Resultado obrigatório                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Outage curto | Interromper o PostgreSQL por menos de 30 segundos, abrangendo pelo menos uma renovação real da lease. | A primeira renovação que falhar suspende imediatamente command ingress e efeitos do provider; o grace geral não posterga a perda da lease. |
| Outage longo | Manter a indisponibilidade por mais de 30 segundos e observar pelo menos uma renovação falhar.        | O runtime permanece suspenso e fail-closed durante todo o outage, sem reconnect autônomo, segundo executor ou chamada ao provider.         |

Antes de cada cenário, registre `worker_id`, provider, runtime generation, sessão,
runtime fence, fencing token, owner e último heartbeat. Depois de restaurar o
PostgreSQL, confirme a ordem de retomada por logs/eventos correlacionados:

1. o probe de reachability confirma apenas que o banco voltou;
2. o runtime fence é ativado novamente para a mesma geração autorizada;
3. uma nova session lease é adquirida com novo fencing token;
4. somente então a sessão durável e o provider são reabertos;
5. existe exatamente um socket/browser, executor e consumer por durable;
6. o reconhecimento online central volta e, por último, health e autorização do
   command ingress ficam positivos.

Os passos 2 a 4 formam a ordem de segurança obrigatória
`runtime fence → session lease → provider`. Nos dois outages, a mesma sessão deve
voltar sem QR, `recreate`, nova runtime generation ou pareamento. O teste reprova
se apenas o reconnect do socket torna o runtime saudável, se uma lease vencida é
reutilizada ou se o provider abre antes do novo fencing token.

Além da matriz comum, valide as fronteiras específicas:

- Baileys e WWebJS: a primeira falha de renovação do store deve entrar
  diretamente no guard de disponibilidade. No WWebJS, o callback deve existir
  antes da abertura do Chromium e só o código exato
  `whatsapp_session_lease_lost` deve classificar lease perdida;
- WhatsMeow: a perda deve fechar imediatamente a fronteira de efeito e deixar o
  erro de lease sticky. O reachability probe bruto usado durante a suspensão só
  pode destravar `ReacquireSessionLease`; sozinho ele nunca limpa o estado,
  autoriza ingress ou abre o provider.

Para cada provider, simule também listener de lease ausente/falhando, `stop`
enquanto `onResume` está em voo e uma segunda perda durante a recuperação. A
geração antiga deve fechar, timers de reconnect devem ser cancelados, recursos
parcialmente abertos devem ser suspensos outra vez e callback atrasado não pode
reautorizar o runtime. Logout, `bad_session` e demais estados terminais apagam a
evidência de recuperação; outage recuperável nunca deve disparar QR ou
`recreate`.

Crie alertas separados por `provider=baileys`, `provider=wwebjs` e
`provider=whatsmeow`, sempre correlacionando worker, runtime generation, writer
epoch, owner antigo/novo e último heartbeat, sem capability ou credenciais. São
condições mínimas de alerta:

- falha de renovação sem entrada imediata no estado suspenso;
- provider/command ingress ativo sem runtime fence e session lease válidos;
- `lease_lost` sem nova lease e novo fencing token dentro do SLO de recuperação;
- QR, `recreate` ou segundo executor após outage recuperável;
- no WhatsMeow, PostgreSQL alcançável com reacquire sticky sem progresso.

### Supervisão obrigatória do Service API e recuperação do outbox

O `service_api` mantém o dispatcher de `worker_runtime_event_outbox`, além dos
consumers Kafka globais que continuam intencionalmente no sistema. Um consumer
nativo que não consegue encerrar com segurança solicita substituição do
processo: a aplicação falha a liveness e termina para não criar outro membro ao
lado de um possível membro fantasma. Esse encerramento é fail-closed e
preserva os offsets e as linhas do outbox, mas depende do orquestrador para
voltar a processá-los.

Em produção são obrigatórios:

- `restartPolicy: Always` no Pod do `service_api` e controle equivalente no
  runtime de containers;
- liveness HTTP em `GET /v1/health/live`; resposta diferente de 200 deve
  substituir o Pod, nunca apenas removê-lo do Service;
- readiness HTTP em `GET /v1/health/ready`; ela controla admissão, mas não
  substitui liveness nem reinicia processo;
- `terminationGracePeriodSeconds` maior que o orçamento de drain configurado
  para o Service API, permitindo fechar os consumers e deixando o
  orquestrador aplicar `SIGKILL` apenas depois do limite;
- alerta para processo sem listener HTTP ou outbox sem avanço, mesmo que um
  wrapper/supervisor de desenvolvimento ainda esteja vivo. `tsx watch` não é
  mecanismo de supervisão de produção.

Todo ensaio de restart de PostgreSQL, Redis, Centrifugo, Kafka global ou NATS
deve incluir o outbox no gate final. Depois de as dependências e o
`service_api` voltarem a healthy/ready, interrompa os writers do ensaio ou use
uma janela quieta e confirme que não restou linha não terminal:

```sql
SELECT
  count(*) FILTER (WHERE state = 'pending') AS pending,
  count(*) FILTER (WHERE state = 'publishing') AS publishing,
  min(created_at) FILTER (
    WHERE state IN ('pending', 'publishing')
  ) AS oldest_unpublished
FROM worker_runtime_event_outbox;
```

O aceite exige `pending = 0`, `publishing = 0` e
`oldest_unpublished IS NULL`, repetidos em duas amostras consecutivas. Também
confirme que um novo evento fenced chega a `published` pelos dois canais
strict do Centrifugo e que `/v1/health/live` e `/v1/health/ready` continuam em 200. Nunca apagar, marcar como publicado ou pular uma linha para fechar o
gate. Se houver lease `publishing` abandonada, o dispatcher deve recuperá-la
após `lease_expires_at`; se não houver avanço, substitua o Pod e investigue a
dependência, sem transformar Kafka global em fallback de comandos.

## Subir e validar localmente

Pré-requisitos: Docker com Compose V2; IP `10.0.2.12` presente no host; portas 4222–4224 livres nesse IP; portas 8222–8224 livres em loopback; pelo menos 50 GiB de disco disponível para os três volumes no limite teórico local.

1. Valide a expansão do Compose sem imprimir o documento expandido, que conteria segredos:

   ```bash
   docker compose config --quiet
   ```

2. Inicie os servidores e execute o init uma única vez:

   ```bash
   docker compose up -d under-nats-1 under-nats-2 under-nats-3
   docker compose run --rm under-nats-init
   ```

3. Repita o init. A segunda execução deve editar/verificar sem remover stream, mensagem ou KV:

   ```bash
   docker compose run --rm under-nats-init
   ```

4. Consulte os healthchecks ligados ao loopback:

   ```bash
   curl --fail --silent 'http://127.0.0.1:8222/healthz?js-enabled-only=true'
   curl --fail --silent 'http://127.0.0.1:8223/healthz?js-enabled-only=true'
   curl --fail --silent 'http://127.0.0.1:8224/healthz?js-enabled-only=true'
   ```

5. Considere o cluster pronto somente quando os três servidores, o líder de metadata e as réplicas forem aprovados pelo init. Um `/healthz` isolado não comprova quorum:

   ```bash
   docker compose run --rm under-nats-init
   docker compose ps --all under-nats-1 under-nats-2 under-nats-3
   ```

O resultado esperado contém `three servers and the JetStream metadata leader are ready`, `stream, KV and replica contract verified` e `runtime epoch KV direct-get ACL verified`. Qualquer saída diferente bloqueia o runtime.

## Verificar o contrato sem revelar credenciais

As credenciais são injetadas como ambiente do serviço init. Não as copie para argumentos, logs ou histórico do shell.

```bash
docker compose run --rm --entrypoint sh under-nats-init -c \
  'nats stream info UC_WORKER_COMMANDS_V1 --json | jq ".config, .state"'

docker compose run --rm --entrypoint sh under-nats-init -c \
  'nats stream info UC_WORKER_FAILURES_V1 --json | jq ".config, .state"'

docker compose run --rm --entrypoint sh under-nats-init -c \
  'nats stream info UC_WORKER_DEFERRED_V1 --json | jq ".config, .state"'

docker compose run --rm --entrypoint sh under-nats-init -c \
  'nats kv info UC_WORKER_EPOCH_V1'

docker compose run --rm --entrypoint sh under-nats-init -c \
  'nats server check jetstream --replicas --replica-seen-critical 10s --replica-lag-critical 0'
```

O próprio `infra/nats/init.sh` compara nomes, subjects, retenção, idades, bytes, contagens, tamanho, compressão, R3, descarte, proteção contra purge/delete e contrato do KV. Em stream ou bucket existente, ele reconcilia campos mutáveis sem apagar dados e depois valida o estado efetivo; campo imutável/protegido que não possa convergir, falha de edição ou divergência restante encerra o init com código diferente de zero.

O valor `worker.<worker_id>` no KV é um registro V1 de até 1 KiB. `epoch` é a
identidade lógica estável dos comandos e não deve ser girado em restart ou
recreate. Nesses eventos, o runtime faz CAS somente de
`runtime_writer_epoch`, `runtime_generation` e `updated_at`, preservando
`activated_at`. Exclusão permanente faz CAS de `active` para `draining` e
depois `closed`; a chave fechada permanece como tombstone e não pode ser
apagada ou reaberta por automação de startup.

## Parar sem destruir dados

```bash
docker compose stop under-nats-1 under-nats-2 under-nats-3
```

Não usar `docker compose down -v`: ele elimina os três volumes. Não usar `nats stream purge`, `stream delete`, `kv purge` nem apagar diretamente `/data/jetstream`. Os streams bloqueiam purge/delete, e o runtime não possui essa permissão.

## Gate obrigatório para produção

Antes de habilitar qualquer publisher, a infraestrutura de produção deve satisfazer todos estes itens:

- três nós JetStream em domínios de falha distintos, com File storage persistente e R3;
- no mínimo 4 CPU e 8 GiB de RAM por nó antes do benchmark;
- PV de 100 GiB por nó, com pelo menos 30% livre após WAL/índices, IOPS e fsync medidos sob carga;
- `max_ha_assets >= 2000` e `max_consumers >= 2000`; o Compose usa 4096 de headroom local, e produção deve elevar o mínimo quando o inventário mais 30% de margem ultrapassar 2.000;
- exatamente os três streams e o bucket KV deste contrato;
- NATS com suporte a message scheduling, `allow_msg_schedules` e `allow_msg_ttl`; o stream diferido precisa aceitar agenda one-shot e o relay global precisa estar pronto antes dos workers;
- TLS em cliente e rotas, CA confiável e hostname validado;
- credenciais separadas para sistema, rota, bootstrap/admin e runtime;
- identidade estática de runtime validada contra o direct-get de
  `worker.<worker_id>`; a credencial de bootstrap não substitui essa prova;
- runtime sem delete/purge e bootstrap fora do deployment de aplicação;
- todos os hosts remotos capazes de resolver e alcançar pelo menos os três endpoints anunciados;
- `service_api` com `restartPolicy: Always`, liveness e readiness separadas, e
  recuperação do `worker_runtime_event_outbox` validada até `pending=0` e
  `publishing=0` depois de restart das dependências;
- reconnect/rebind testado nos três providers, em restart de um nó e outage
  completa dos endpoints, sem recreate, com atividade de pull no mesmo durable,
  sem backlog/redelivery inesperado e ambos os sinais `command_ingress_*`
  voltando a `true`; `num_waiting` não foi usado como critério isolado;
- relógios sincronizados, porque deadline e TTL fazem parte da segurança;
- scrape, dashboards e alertas ativos antes do primeiro comando;
- inventário de 1.070 workers validado contra `MaxConsumers=2000`.

Redis de produção também é gate do command plane, não apenas cache auxiliar:

- primary com réplicas monitoradas por pelo menos três instâncias Sentinel, com failover ensaiado;
- AOF habilitado e política de fsync explicitamente aprovada;
- `maxmemory-policy noeviction`, para nunca perder o fence por pressão de memória;
- `min-replicas-to-write` e `min-replicas-max-lag` compatíveis com a topologia e a latência medida, fazendo a chamada ao provider falhar fechada quando a durabilidade mínima não estiver disponível;
- credenciais em secret store externo, TLS quando houver tráfego fora da rede confiável e rotação testada;
- alerta de replication lag, réplica desconectada, AOF, eviction, blocked clients e memória por prefixo antes do rollout.

AOF e replicação diminuem o risco de perder o ledger, mas não tornam a chamada ao WhatsApp transacional. Resultado incerto depois de `provider_invoked` continua `ambiguous` e nunca é reenviado automaticamente.

Antes do primeiro canário, executar soak com 1.500 durables e pelo menos duas vezes o pico medido, incluindo burst concentrado em uma única conversa, reconnect simultâneo e perda de leader. Expandir o cluster para cinco nós se qualquer condição ocorrer: `PubAck` p99 acima de 100 ms, CPU sustentada acima de 60%, I/O incapaz de recuperar backlog em cinco minutos ou reconnect storm que não estabilize em cinco minutos. A expansão não substitui corrigir uma violação de ordem, dedupe ou quota.

O endpoint externo precisa ser estável e anunciar nomes acessíveis aos 11 hosts remotos observados. Não depender de endereço de Pod, nome Compose ou rota que funcione apenas dentro do cluster. Validar MTU, firewall, NAT idle timeout, keepalive, resolução DNS, latência de ida/volta e certificado a partir de cada host.

## Observabilidade e SLO inicial

### Gate do Manager

Depois de subir a infraestrutura, valide também `GET /v1/health/check` em cada
réplica do Manager. Não basta consultar somente a réplica atendida pelo Service:
as quatro eleições são independentes.

- `command_plane.ready=true` é obrigatório;
- componentes líderes devem mostrar `running=true`, `ready=true` e, quando
  `nats.required=true`, `connected=true` e `contract_valid=true`;
- componentes followers devem mostrar `leadership=standby` e
  `election_healthy=true`;
- `worker_command_operational_barrier.available=true` e `state=active` são
  obrigatórios para readiness 200;
- `electing`, `stopped`, drift de contrato, conexão NATS perdida, barrier
  pausada ou erro Redis produzem 503 e devem bloquear o rollout.

O health lê somente o snapshot NATS atualizado em background; não use o
endpoint para gerar probes adicionais no broker. Acompanhe `nats.checked_at` e
alerte se a evidência ficar mais velha que dois intervalos de 15 segundos.

A porta HTTP de monitoramento do NATS não tem autenticação; mantê-la interna e coletá-la por agente/sidecar autorizado. Coletar `/varz`, `/jsz`, `/routez`, `/connz` e advisories JetStream. Não expor essas rotas à internet.

### Métricas obrigatórias

O código já expõe no health do Manager o snapshot
`worker_command_telemetry` e registra o mesmo objeto como log estruturado a
cada 60 segundos. Os nomes estáveis são `publish.outcomes`,
`publish.by_command_type`, `publish.public_retry_requests`,
`publish.technical_retries`, `publish.puback_latency_ms`, `deferred` e os
gauges `admission_identities`/`deadline_records`. O histograma usa buckets
fixos de 10, 25, 50, 100, 250, 500, 1.000, 2.500 e 5.000 ms, mais `+Inf`.
Esses campos são a fonte para transformação em séries Prometheus/OTLP pelo
coletor de produção. `worker_id`, `account_id`, chat e operation id nunca são
labels; esses identificadores pertencem somente a logs/traces correlacionados.
O health também publica o estado leader/standby e readiness dos quatro jobs do
command plane, portanto um leader sem relay/reconciliador pronto responde 503.

Produtor:

- publishes, `PubAck` aceitos, duplicados, timeouts, retries e rejeições por `command_type`;
- latência de `PubAck` p50/p95/p99;
- tamanho do envelope armazenado e rejeições por 64 KiB; `max_payload=80KiB` no servidor é somente folga de wire para headers/framing, não um novo limite de negócio;
- UNKNOWN ao fim da janela de dois minutos;
- tentativas de fallback ou transporte diferente de `jetstream` — devem permanecer zero.

Stream/consumer:

- bytes, mensagens e utilização percentual de cada limite;
- mensagens por subject e rejeições `DiscardNew`;
- idade da mensagem pendente mais antiga;
- `num_ack_pending`, redeliveries, `num_waiting`, consumer sem atividade e falhas de `AckSync`;
- `num_waiting` correlacionado com requests/pulls e atividade do consumer;
  `num_waiting=0` só é falha de rebind quando não há atividade nem pull;
- leader, replicas offline, replica lag, election, API errors, store errors, fsync e espaço livre;
- expirações por `MaxAge`, inclusive comandos nunca entregues;
- taxa e saturação do stream de falhas.
- agendas criadas/disparadas, ready pendente, latência park→relay→command, erros de `PubAck`/`AckSync` e saúde do durable `uc_worker_deferred_relay_v1`;
- bytes/mensagens do diferido e uso da quota da conta, mesmo sem limite de bytes no próprio stream;

Worker/Redis/provedor:

- tempo aceite→fetch, fetch→início e aceite→terminal;
- lanes ativas, profundidade/espera por lane e paralelismo global;
- estado do ledger (`reserved`, `provider_invoked`, `succeeded`, `failed`, `expired`, `ambiguous`);
- dedupes por redelivery, epoch mismatch, prazo expirado e falha de KV;
- Redis p95/p99, AOF delayed fsync, replication lag, disconnected replicas, memória, blocked clients e erro de script;
- chamada ao provedor, timeout, falha e possíveis duplicatas de efeito;
- falha ao publicar evidência em `UC_WORKER_FAILURES_V1`.
- cardinalidade, memória, idade mais antiga, claims, reschedules e erros do índice Redis `{worker-command-deadline:v1}`; ele armazena somente identidade compacta e nunca o payload.

### Limiares de alerta iniciais

| Sinal                           |             Warning |                                                Crítico/page |
| ------------------------------- | ------------------: | ----------------------------------------------------------: |
| `PubAck` p99                    |  > 100 ms por 5 min | > 500 ms por 2 min ou qualquer indisponibilidade sustentada |
| Aceite→fetch p99, worker online |  > 150 ms por 5 min |                                             > 1 s por 2 min |
| Mensagem pendente mais antiga   |              > 15 s |                              > 60 s; page imediato em 240 s |
| Bytes/mensagens/per-subject     |                 50% |                                            75%; page em 90% |
| `num_ack_pending`               |     > 60% do máximo |                                             > 80% por 2 min |
| Redelivery                      |              > 0,5% |                                              > 1% por 5 min |
| Réplica offline/lag             |   qualquer por 30 s |                          quorum perdido ou lag > 0 por 60 s |
| Disco livre por nó              |               < 30% |                                                       < 20% |
| Failure publish rejeitado       |                   — |                                         qualquer ocorrência |
| Comando expirado sem terminal   |                   — |                            qualquer ocorrência após rollout |
| Deadline index                  | > 2 ciclos atrasado |      registro com mais de 10 min ou capacidade acima de 50% |
| Ledger V4 Redis por prefixo     |           > 500 MiB |                                                   > 750 MiB |

Os SLOs de latência são gates a confirmar em benchmark no caminho real; se a linha de base atual já for maior, registrar e aprovar o novo valor antes do rollout, sem simplesmente silenciar o alerta. Nunca reduza TTL automaticamente em resposta a memória: investigue writer antigo, ausência de compactação, volume de `ambiguous` e taxa real de comandos.

## Saturação e incidentes

`DiscardNew` é deliberado nos streams de comandos e falhas: nunca remover uma mensagem antiga para aceitar outra silenciosamente. O scheduler nativo não aceita `DiscardNew`; por isso o stream diferido usa `DiscardOld` sem `MaxBytes`, `MaxMsgs` ou limite por subject. Seu descarte normal ocorre somente por `MaxAge=5m`. A quota da conta e o disco precisam rejeitar novos publishes antes de qualquer pressão destrutiva.

1. Ao receber `PubAck` negativo/rejeição, interrompa admissão do fluxo afetado e preserve `command_id`.
2. Determine qual limite saturou: comandos em bytes/mensagens/subject, failure stream, quota da conta ou disco ocupado pelos diferidos.
3. Não faça purge/delete e não aumente limites durante o incidente sem confirmar espaço físico.
4. Isole consumer/worker lento, Redis ou provedor antes de retomar admissão.
5. Se a mensagem envelheceu cinco minutos, trate-a como expirada/ambígua conforme evidência; não a recrie automaticamente.
6. Se o stream de falhas saturou, mantenha o comando sem ACK enquanto ele existir e acione page. Não confirme sucesso sem evidência terminal.

Perda de um nó com quorum preservado deve causar apenas reconnect/election curto. Perda de quorum bloqueia aceite. Nunca desabilitar R3 ou aceitar Core NATS para “destravar”.

## Backup, recuperação e upgrade

Os comandos e os diferidos vivem no máximo cinco minutos e as falhas 24 horas; eles não substituem histórico de negócio. O KV de epoch, porém, não expira e precisa ser incluído no procedimento de snapshot/restore do JetStream.

Antes de manutenção:

1. aplique barrier de admissão;
2. aguarde comandos/inflight zerarem;
3. obtenha snapshot consistente do KV e registre revisões;
4. confirme backup dos volumes conforme a tecnologia de produção;
5. altere somente um nó por vez e espere réplica sem lag antes do próximo;
6. reexecute o verificador de contrato;
7. libere admissão apenas depois de testar publish, consumer, epoch e ACK.

Upgrade deve usar versão pinada, changelog revisado, teste de compatibilidade de storage e rollback ensaiado. Não usar tags `latest`. Em restore do KV, nunca reduzir epoch: isso poderia reautorizar um container obsoleto.

## Validações desta entrega

Foram executados localmente:

- validação da sintaxe do servidor;
- `docker compose config --quiet`;
- formação real do cluster de três nós e eleição de metadata leader;
- criação dos três streams e do KV;
- agenda one-shot real, emissão no subject `ready` e relay com PubAck antes de AckSync;
- verificação R3 sem lag;
- segunda execução do init comprovando idempotência.

Esses testes validam o ambiente local, não substituem ensaio de carga, falha e conectividade em produção.
