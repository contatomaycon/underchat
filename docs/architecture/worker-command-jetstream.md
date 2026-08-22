# Transporte central de comandos de workers com NATS JetStream

Status: decisão arquitetural e contrato operacional da implementação V1.

Este documento substitui os tópicos Kafka exclusivos de cada canal no caminho de **comandos destinados aos containers de canal**. Cada canal continua com seu próprio container/worker. A admissão usa um único stream compartilhado de comandos e cada worker consome apenas o subject que lhe pertence. Um segundo stream global, curto e sem recurso por canal, estaciona sucessores que ainda não podem executar para que uma rajada de um chat não ocupe toda a janela de ACKs.

O `docker-compose.yml` local, a configuração em `infra/nats/` e as variáveis locais foram adicionados nesta entrega. Nenhum manifesto de `/home/maycon/underchat-argocd`, cluster de produção, DNS, certificado ou segredo de produção foi alterado ou aplicado. Kafka continua existindo apenas nos fluxos globais de eventos/resultados que ainda o utilizam; ele não é fallback de comandos.

## Decisão

O transporte de comandos é 100% NATS JetStream e falha de forma fechada:

1. o produtor constrói um envelope V1 com identidade estável;
2. publica em `uc.worker.command.<worker_id>`;
3. a operação só é aceita pela API após um `PubAck` válido do stream `UC_WORKER_COMMANDS_V1`;
4. o container do canal possui um pull consumer durável filtrado pelo seu subject exato;
5. o worker valida destino, prazo e epoch, serializa o trabalho pela entidade e, quando o predecessor ainda não iniciou, estaciona o sucessor por um segundo no scheduler JetStream;
6. somente uma operação por entidade cruza a fronteira do provedor, enquanto entidades diferentes avançam em paralelo;
7. o worker confirma o comando após concluir o efeito terminal ou registrar a falha de forma durável.

Não há PostgreSQL outbox, tabela de resultados, stream de resultados, stream separado de tempo real nem KV de idempotência. Redis não é fila e não recebe o payload original: ele mantém somente o ledger curto do efeito, as lanes de ordenação, um índice global de deadlines sem payload e os estados operacionais de recuperação/agendamento. O bucket KV do JetStream serve somente como fence de geração do worker. O estacionamento guarda os mesmos bytes exclusivamente no JetStream e continua limitado pelo deadline original de cinco minutos.

```text
API/produtor
  |  envelope V1 + Nats-Msg-Id=command_id
  v
UC_WORKER_COMMANDS_V1 (R3, File, WorkQueue, 5 min)
  |  filter_subject=uc.worker.command.<worker_id>
  v
container exclusivo do canal
  |-- valida worker/account/deadline/epoch
  |-- Redis: ledger do efeito + lane por entidade
  |-- predecessor ainda não iniciou
  |     `-> UC_WORKER_DEFERRED_V1 -- 1 s --> relay global --+
  |                                                        |
  |                 <--------------------------------------+
  |-- provedor WhatsApp
  `-- falha terminal -> UC_WORKER_FAILURES_V1

Eventos e resultados globais existentes ------------------> Kafka global
```

## Por que um stream compartilhado

O inventário de produção encontrou 5.190 tópicos Kafka, dos quais 5.158 eram tópicos canônicos por worker, para 958 workers encontrados nos nomes. Havia 2.294 consumer groups, sendo 2.267 grupos canônicos de worker. Apesar disso, os logs desses tópicos ocupavam aproximadamente 250,8 MiB e 94,2% dos tópicos de worker estavam vazios. O custo dominante é metadata, partições, grupos, conexões, reconciliação e operação, não volume de mensagens.

Um subject por worker mantém isolamento de roteamento sem criar um stream/tópico por canal. Um consumer filtrado por worker mantém o modelo de um container por canal. O limite de 2.000 consumers cobre os 1.070 workers ativos observados e deixa 930 posições de margem; acima disso o aumento do limite deve ser uma mudança deliberada de capacidade.

## Contrato JetStream imutável da V1

| Recurso             | Contrato                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| Stream de comandos  | `UC_WORKER_COMMANDS_V1`                                                       |
| Subject de comandos | `uc.worker.command.<worker_id>`                                               |
| Retenção            | `WorkQueue`                                                                   |
| Storage/compressão  | `File` / `S2`                                                                 |
| Réplicas            | 3                                                                             |
| `MaxAge`            | 5 minutos                                                                     |
| `DuplicateWindow`   | 5 minutos                                                                     |
| `MaxBytes`          | 8 GiB lógicos                                                                 |
| `MaxMsgs`           | 4.000.000                                                                     |
| `MaxMsgsPerSubject` | 10.000                                                                        |
| `MaxConsumers`      | 2.000                                                                         |
| `MaxMsgSize`        | 64 KiB para o envelope armazenado                                             |
| Saturação           | `DiscardNew`, inclusive por subject                                           |
| Stream diferido     | `UC_WORKER_DEFERRED_V1`                                                       |
| Subjects diferidos  | `uc.worker.deferred.schedule.>` e `uc.worker.deferred.ready.*`                |
| Contrato diferido   | WorkQueue, File/S2, R3, `MaxAge=5m`, `MaxMsgSize=64KiB`, scheduler habilitado |
| Relay diferido      | Um durable global `uc_worker_deferred_relay_v1`, sem consumer por canal       |
| Stream de falhas    | `UC_WORKER_FAILURES_V1`                                                       |
| Subject de falhas   | `uc.worker.failure.<worker_id>`                                               |
| Retenção de falhas  | `Limits`, 24 horas, 1 GiB lógico, R3, File/S2                                 |
| Saturação de falhas | `DiscardNew`; a rejeição do publish é erro crítico, nunca sucesso silencioso  |
| KV de fence         | `UC_WORKER_EPOCH_V1`                                                          |
| KV                  | R3, File/S2, history 1, sem TTL, valor máximo 1 KiB, bucket máximo 64 MiB     |

Comandos e falhas têm `deny_delete` e `deny_purge`. O stream diferido tem `deny_delete=true`, `deny_purge=false`, `allow_rollup_hdrs=true`, `allow_msg_ttl=true` e `allow_msg_schedules=true`, porque o scheduler nativo precisa dessas capacidades. Nenhum principal de runtime recebe permissão de purge/delete; somente o bootstrap/control plane administra o contrato. Alterar esses nomes ou limites exige nova versão, não edição informal em produção.

O stream diferido deliberadamente não possui `MaxBytes`, `MaxMsgs` nem `MaxMsgsPerSubject`. O scheduler JetStream não é compatível com `DiscardNew`; impor um limite com `DiscardOld` poderia remover um comando já aceito para abrir espaço. A contenção é feita por `MaxAge=5m`, deadline imutável, quotas de admissão e pelo limite de armazenamento da conta. Esgotamento da conta deve rejeitar o publish e acionar a barrier, nunca expulsar silenciosamente um registro válido.

Na exclusão permanente de um canal, o lifecycle fecha seu epoch e remove apenas
o durable `uc_worker_<sha256(worker_id)[:32]>`. Ele **não** tenta purgar o
subject: `deny_purge=true` é uma proteção intencional e o backlog descartável
expira naturalmente em no máximo cinco minutos pelo `MaxAge`. O finalizer
registra `backlog_disposition=expires_by_stream_max_age` para que essa decisão
seja auditável e idempotente.

### Capacidade física

Os limites são lógicos, mas R3 replica os dados:

- comandos: até 8 GiB lógicos, aproximadamente 24 GiB físicos;
- falhas: até 1 GiB lógico, aproximadamente 3 GiB físicos;
- KV: até 64 MiB lógicos, aproximadamente 192 MiB físicos;
- diferidos: sem reserva fixa por stream; somente os comandos estacionados por até cinco minutos, limitados pela conta e pelo disco.

Os dois streams com limite de bytes e o KV representam aproximadamente 27,2 GiB físicos em R3, antes do stream diferido, índices, consumers, Raft e WAL. O Compose local limita cada servidor a 16 GiB e a conta a 32 GiB; esses limites também contêm o diferido. Em produção, usar PV de 100 GiB por nó conforme o plano de implantação, manter no mínimo 30% livre e dimensionar o pico de cinco minutos do diferido a 2× a carga observada. Nunca aumentar a quota da conta durante incidente sem confirmar espaço físico e comportamento de rejeição.

O limite de 8 GiB é atingido antes de 4 milhões de mensagens quando a média passa de aproximadamente 2 KiB. Com mensagens de 64 KiB, cerca de 131 mil mensagens já ocupam 8 GiB. Portanto, os três limites (`MaxBytes`, `MaxMsgs` e `MaxMsgsPerSubject`) precisam ser monitorados separadamente.

## Envelope e fronteira de aceite

O envelope V1 contém:

- `schema_version`, `command_id`, `operation_id` e `retry_of`;
- `account_id`, `worker_id`, `command_type` e `entity_key`;
- `entity_sequence` e `predecessor_operation_id`;
- `origin_epoch`, `issued_at` e `deadline_at`;
- `payload_version`, `payload_digest` e `payload`;
- `traceparent` e `source`.

O produtor envia:

- `Nats-Msg-Id: <command_id>` para deduplicação do publish durante cinco minutos;
- `Nats-Expected-Stream: UC_WORKER_COMMANDS_V1` para impedir aceite pelo stream errado;
- no máximo 64 KiB para o envelope serializado que será armazenado no stream.

O servidor local usa `max_payload=80KiB` apenas para dar margem aos headers JetStream/NATS e ao framing do protocolo. Essa folga de wire não aumenta o limite de negócio: o stream continua recusando envelope armazenado acima de 64 KiB e o produtor também precisa validá-lo antes do publish.

O recibo local registra `command_id`, `operation_id`, stream, sequência, indicador de duplicata, `accepted_at` e `expires_at`. Envelope e recibo serializados têm teto de 64 KiB, embora o recibo normal seja muito menor. Um retorno sem `PubAck` válido é **UNKNOWN**, não sucesso. O produtor repete somente o mesmo `command_id` e o mesmo conteúdo dentro da janela pública de dois minutos. Depois disso rejeita a operação; não muda para Kafka e não inventa uma nova identidade.

Para preservar compatibilidade, os endpoints aceitam uma primeira chamada sem
`operation_id`/`idempotency_key`, geram UUIDv7 no servidor e devolvem essa
identidade no corpo e nos headers. A garantia de retry sem novo efeito exige
que o cliente reutilize a identidade devolvida; os clientes web e mobile desta
entrega já a geram antes da primeira chamada e a persistem. Um cliente legado
que perde toda a resposta e repete uma requisição sem identidade não pode ser
correlacionado matematicamente pelo servidor e recebe uma nova operação. Por
isso integrações externas devem enviar ou persistir o identificador retornado.

O `PubAck` R3 significa que o quorum JetStream aceitou a mensagem. Ele não significa que o provedor executou o efeito. Sem outbox transacional, existe uma janela entre a decisão da aplicação e o publish. Esta decisão privilegia menor latência/custo e permite que o cliente reenvie explicitamente uma operação ambígua.

Antes do publish, a admissão grava no Redis um registro compacto, sem payload, em `{worker-command-deadline:v1}`. Ele contém somente identidades, digest, epoch, lane e deadline; cada registro expira no máximo em 24 horas. Um reconciliador singleton consulta o ZSET por score, sem `SCAN`, e resolve aos cinco minutos também o comando que nunca foi entregue ao worker. Operação que nunca adquiriu a lane vira `expired`; operação que cruzou a fronteira mas não tem terminal comprovado vira `ambiguous`. O registro só é removido depois do `PubAck` da evidência em `UC_WORKER_FAILURES_V1`. Para agendamento, o mesmo registro carrega apenas `schedule_id`, `message_id` e `attempt_id`, suficientes para convergir o estado operacional sem guardar o comando.

Um segundo tombstone compacto `worker-command-admission:v1:<digest>` conserva por 24 horas a combinação imutável de `operation_id`, destino, payload digest, epoch, `issued_at` e `command_id`. Ele impede que a mesma operação ganhe um relógio novo depois que a lane de 15 minutos expirar: qualquer nova admissão com a mesma identidade em dois minutos ou mais é rejeitada, e uma divergência de payload/destino falha como conflito. O valor também não contém payload e não é renovado por leitura.

## Ordenação e isolamento

O subject por worker não basta para preservar ordem entre tipos de comando. Todos os comandos que afetam o mesmo chat usam a mesma `entity_key` e a mesma sequência, independentemente de terem vindo de envio direto, agendamento, notificação, marcação de leitura ou outro fluxo. A regra recomendada é:

```text
entity_key = chat:<account_id>:<worker_id>:<jid_canonico_ou_chat_id>
```

O JID canônico tem precedência e `chat_id` é fallback somente quando o JID ainda não existe. Quando não houver conversa, a chave usa a menor entidade que realmente precisa de serialização, por exemplo configuração do próprio worker. O produtor aloca `entity_sequence` e `predecessor_operation_id` de forma atômica. O worker usa a lane Redis e um scheduler round-robin de até 32 lanes ativas.

Uma simples `NAK` não libera `MaxAckPending`. Por isso, quando o predecessor nunca ficou ativo, o worker publica uma agenda one-shot para um segundo depois em `UC_WORKER_DEFERRED_V1`, espera o `PubAck` R3 e somente então faz `AckSync` do registro original. O relay global recebe `uc.worker.deferred.ready.<worker_id>`, valida subject, envelope, deadline e identidade do scheduler, republica no subject original com `Nats-Msg-Id` determinístico, espera o `PubAck` do stream de comandos e só depois confirma o diferido. Crash em qualquer intervalo produz redelivery/dedupe, não perda silenciosa. Somente o sucessor imediato de uma operação que já esteve ativa pode permanecer como waiter: ele consulta a lane a cada 100 ms e mantém a entrega viva com `InProgress`, sem gastar tentativas técnicas nem uma das 32 vagas de execução. Sucessores mais profundos são estacionados. Assim, uma rajada de uma conversa não retém os 128 acks pendentes nem esconde outro chat.

A simulação de digitação permanece dentro da lane, mas ocorre antes de adquirir o semáforo do provedor. A chamada efetiva preserva o limite de quatro operações simultâneas por socket. Logo, a mensagem seguinte do mesmo chat espera a digitação e o envio anteriores, sem que a digitação consuma uma das quatro vagas de outros chats.

Consequências:

- uma mensagem longa bloqueia somente mensagens posteriores do mesmo chat;
- outro chat, outro canal e outra conta continuam em paralelo;
- fluxos diferentes não ultrapassam uns aos outros quando compartilham a mesma entidade;
- falha terminal conclui a posição da lane e não bloqueia indefinidamente o sucessor;
- redelivery não autoriza reexecutar um efeito já terminal no ledger.

O objetivo é ordem preferencial por chat, não uma ordem global. A ordem não é garantida se dois produtores ignorarem a alocação atômica da lane, usarem chaves diferentes para o mesmo chat ou publicarem envelopes fabricados fora do contrato.

## Epoch lógico e fence do runtime

`UC_WORKER_EPOCH_V1` mantém duas identidades diferentes por `worker_id`, com
history 1 e sem TTL:

- `epoch` é o epoch **lógico da fila de comandos**. Ele é criado uma única vez,
  entra no `origin_epoch` dos envelopes e sobrevive a restart e recreate normal
  do container;
- `runtime_writer_epoch` identifica a instância concreta que possui a sessão;
- `runtime_generation` é monotônico e impede que uma instância de geração
  anterior volte a executar efeitos;
- `state` percorre `active → draining → closed` somente em exclusão permanente
  ou cutover administrativo explícito.

O produtor admite usando o `epoch` lógico persistido. No startup, o ingress
valida e conecta o durable antes de fazer CAS no KV: uma geração mais nova
preserva `epoch` e `activated_at`, mas substitui `runtime_writer_epoch` e
`runtime_generation`. Assim, um comando aceito até cinco minutos antes do
recreate continua válido no novo container. Ao mesmo tempo, o runtime anterior
é revogado pela dupla geração/writer e pelo lease de efeito da sessão antes da
fronteira do provider.

Antes do efeito, o worker exige simultaneamente: `origin_epoch` igual ao epoch
lógico ativo; conta e worker idênticos; e runtime writer/generation iguais aos
vinculados no startup. KV ausente, indisponível, divergente ou não ativo falha
de forma fechada. Atualizações usam compare-and-set/revision, nunca `put` cego.
Registros legados sem `runtime_writer_epoch` inferem temporariamente o writer a
partir de `epoch` e são atualizados sem girar a identidade lógica.

`draining` e `closed` nunca são reabertos pelo startup, mesmo com geração maior.
O lifecycle de exclusão mantém o tombstone no KV; remover essa chave não faz
parte do recreate. Um canal criado novamente depois de exclusão permanente
deve possuir novo `worker_id` ou passar por um cutover explicitamente
autorizado, nunca reutilizar implicitamente o epoch fechado.

### Recriação normal do canal e readiness

`Recriar canal` não é handoff entre providers e não é criação de sessão. O
control plane aposenta somente o runtime corrente, preserva a revisão ativa da
sessão e o epoch lógico, sobe uma geração maior do mesmo provider e conecta o
durable/filter exato do worker. Esse fluxo não pode apagar a sessão, gerar QR,
trocar `worker_id`, girar o epoch lógico ou copiar credenciais por um caminho
paralelo.

O novo runtime só pode publicar `online` depois de comprovar, em conjunto:

- lease/fence PostgreSQL e writer/generation correntes;
- sessão nativa autenticada, identidade esperada e capacidade real de enviar e
  receber;
- checkpoint durável exigido pelo provider;
- runtime fence de mensagens preparado e marcado ready;
- `command_ingress_ready=true` e `command_ingress_authorized=true` no consumer
  JetStream do durable atual;
- ACK central do status da geração nova.

Kafka global de eventos/resultados não substitui nem libera nenhum desses
gates. Nomes históricos `kafka_consumers_*` podem aparecer apenas como aliases
binários ou motivos legados; para recriação e health do caminho de comandos, a
autoridade é sempre o ingress JetStream.

No WWebJS, o replay canônico da revisão ativa pode provocar várias navegações
do mesmo `Page`. Cada recuperação de navegação deve carregar uma sequência
monotônica: uma falha só é terminal quando ainda pertence à navegação mais
recente da mesma página e do mesmo runtime. `TargetCloseError` de uma navegação
comprovadamente superada é descartado com telemetria segura; erro da navegação
corrente continua fail-closed. Isso evita encerrar um Chromium saudável e
repetir toda a restauração.

O evento nativo `ready` também permite uma janela curta de reconciliação do
estado, mas não antecipa `online`: identidade, `CONNECTED`, event bridge,
checkpoint, runtime fence, ingress JetStream e ACK central continuam
obrigatórios. A grace genérica de 30 segundos permanece para restores que ainda
não observaram `ready`; reiniciar essa grace depois de um `ready` autêntico é
espera artificial e deve ser evitado.

Antes de aplicar o overlay canônico no WWebJS, a janela de restore exige duas
amostras estáveis do scheduler oficial de App State. Um conjunto
`inFlight + dirty` não pode ser tratado como idle. Quando as mesmas coleções
ficam pelo menos 15 segundos sem progresso, com transporte autenticado e sem
itens `pending`, `retry`, `fatal` ou `blocked`, o bridge classifica
`native_stalled` e permite **uma única** troca do realm JavaScript no mesmo
Chromium. A recuperação comprova novamente documento, identidade, registro,
socket, guard de navegação, proteção contra destruição de credenciais e ausência
de pareamento; depois zera o observador e exige outra janela estável. Ela não
inicia full sync antes da instalação do overlay. Segundo stall, ABI inesperada,
perda de identidade ou prova ambígua continuam fail-closed.

O fechamento oficial do socket durante o checkpoint offline também precisa ser
provado, não apenas invocado. Algumas versões de `WAComms.closeSocketAndResume`
lançam uma exceção depois de já aplicar o fechamento. Nesse caso o bridge mantém
o fence de rede do CDP e aceita a quiescência somente quando observa, de forma
independente, stream `DISCONNECTED` e `WAComms.isSocketConnected() === false`.
Se o transporte continuar vivo até o deadline, a recriação falha fechada e a
revisão anterior permanece recuperável.

Antes ou depois de `hasSynced=true`, o modelo visual também não basta. Um
runtime WWebJS pode declarar `Socket=CONNECTED` e backend `CONNECTED` enquanto
o stream está `DISCONNECTED`, `WAComms.isCommsInitialized()=false`,
`WAComms.isSocketConnected()=false` e não existe tráfego de entrada. O bridge só
classifica esse estado como `canonical_transport_native_stall` quando
`hasSynced` é um booleano conhecido e essa contradição completa permanece por
15 segundos, o documento continua válido, o runtime está registrado, os
listeners oficiais existem e todos os guards de credencial/pareamento
permanecem íntegros. Nesse caso permite uma única troca do realm JavaScript no
mesmo Chromium e exige uma prova nova de transporte real. Uma segunda
ocorrência, estado parcial ou perda de qualquer guard continua fail-closed;
nunca promover `online` apenas por `hasSynced` ou pelo model state. Esperar o
timeout inteiro para só então repetir `Client.initialize()` também é regressão:
a recuperação exata deve ocorrer ainda na tentativa corrente.

O checkpoint final de uma revisão ativa coloca a rede offline depois de já ter
provado um transporte autenticado. Nesse ponto o model pode conservar
legitimamente `CONNECTED`. A opção interna `allowEstablished` admite esse único
estado estabelecido somente quando a rede está comprovadamente offline, o
document epoch coincide, `WAComms` e o listener oficial estão inicializados, a
sessão segue registrada e os guards estão selados/atestados. Ela não vale na
importação inicial. Após reabrir a rede, o fluxo ainda exige novamente socket,
backend, stream, `WAComms`, tráfego de entrada, `hasSynced`, identidade,
checkpoint, fence e ingress JetStream antes de READY/`online`.

Alguns campos de health/proto ainda preservam aliases `kafka_consumers_*` para compatibilidade binária com o control plane implantado. Os campos canônicos são `command_ingress_ready` e `command_ingress_authorized`; os aliases refletem exatamente o mesmo ingress JetStream e não iniciam consumer, producer ou fallback Kafka.

### Invariante de reconnect e rebind do runtime

A conexão TCP com o NATS voltar não é suficiente para considerar o ingress de
comandos recuperado. Uma desconexão pode encerrar a geração do `Fetch`/pull mesmo
quando o cliente base reconecta depois. Por isso, cada runtime Baileys, WWebJS e
WhatsMeow deve supervisionar a geração inteira do consumer:

- ao terminar o loop de pull, o runtime invalida a geração anterior e cria um novo
  pull sobre o mesmo durable e o mesmo filtro exato do worker;
- a recuperação acontece no próprio processo, sem recriar o worker, o container,
  a sessão do WhatsApp ou o durable;
- para um worker online e elegível, a recuperação do pull deve ser comprovada por
  atividade recente do consumer/contadores de requests, ou por uma entrega de
  teste sem efeito; observar `num_waiting=1` durante a amostragem é evidência
  adicional, não o critério único;
- `command_ingress_ready` só volta a `true` depois do pull estar ativo;
- `command_ingress_authorized` só volta a `true` depois de validar novamente a
  identidade runtime, o epoch, a lease e o reconhecimento central exigidos;
- enquanto os dois sinais não estiverem positivos, qualquer efeito no provider
  permanece fail-closed.

O `FetchBatch` usa `MaxWait=1s`, portanto `num_waiting` pode oscilar entre `0` e
`1` conforme o instante da consulta, a fronteira de retorno do batch e o nó/leader
consultado. `num_waiting=0`, mesmo sustentado em algumas amostras, não prova
sozinho uma falha. Ele só indica falha de rebind quando está correlacionado com
ausência de atividade/request de pull, consumer sem avanço e impossibilidade de
restabelecer os dois sinais de health. O aceite também exige ausência de backlog
ou redelivery inesperado.

O aceite deve exercitar os três tipos de runtime em dois cenários: troca/restart de
um nó NATS e indisponibilidade/restart completo dos endpoints NATS. Em ambos, o
mesmo runtime deve recuperar o pull e os dois sinais de health sem `recreate`.

### Invariante de lease durante outage PostgreSQL

Em Baileys, WWebJS e WhatsMeow, uma falha de renovação da lease PostgreSQL é uma
perda efetiva do writer fence, mesmo quando a indisponibilidade dura menos que o
grace geral de 30 segundos. A primeira renovação que falhar suspende
imediatamente command ingress e efeitos do provider; não aguarda o próximo
health check nem inicia reconnect autônomo.

O fechamento imediato e a entrada no guard são obrigatórios nos três providers,
com estas integrações específicas:

| Provider  | Tratamento da falha de renovação                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baileys   | O store reporta a perda de lease diretamente ao guard de disponibilidade, que revoga a autorização e suspende socket, consumers e efeitos do provider.                                                                                                                         |
| WWebJS    | O store reporta a perda de lease diretamente ao mesmo guard. O callback deve estar instalado antes de abrir o Chromium, e somente o código exato `whatsapp_session_lease_lost` representa esse evento.                                                                         |
| WhatsMeow | A perda fecha imediatamente a fronteira de efeito e o socket, entra no guard e deixa o erro de lease sticky. Durante a suspensão, um probe de reachability bruto do PostgreSQL pode apenas destravar a tentativa explícita de reacquire; ele não valida nem substitui a lease. |

O probe saudável é somente uma pré-condição de disponibilidade. A retomada de
segurança sempre respeita `runtime fence → session lease com novo fencing token
→ provider`: primeiro ativa o fence da mesma geração autorizada, depois adquire
uma nova lease e somente então reabre a sessão persistida e cria um único
socket/browser. A autorização do command ingress volta por último, depois da
prova online central. Esse fluxo recupera a sessão existente sem novo QR,
`recreate`, nova geração ou segundo executor.

Logout, `bad_session` e demais estados terminais apagam qualquer evidência
transitória de sessão recuperável. Uma nova perda durante `recovering` invalida a
geração de recuperação anterior, cancela timers locais e reaplica a suspensão
depois que qualquer resume obsoleto terminar; callback atrasado, provider aberto
parcialmente ou conclusão de `onResume` após `stop` nunca podem reautorizar a
geração.

## Ledger Redis e TTLs

Redis é uma barreira de efeito de curta duração, não uma fonte de comandos. O worker escreve `provider_invoked` **antes** de chamar o provedor. Timeout ou indisponibilidade do Redis antes da chamada falha de forma fechada. Os TTLs são constantes do contrato, não parâmetros de ambiente:

| Estado/chave                        | TTL máximo |
| ----------------------------------- | ---------: |
| `reserved`                          |     30 min |
| `provider_invoked`                  |        1 h |
| `succeeded`                         |       12 h |
| `failed` / `expired`                |        2 h |
| `ambiguous`                         |       24 h |
| lane de entidade                    |     15 min |
| identidade de admissão              |       24 h |
| evidência de deadline               |       24 h |
| recuperação/agendamento operacional |       24 h |

`provider_invoked` que perde confirmação não volta automaticamente ao provedor: passa a `ambiguous`. Um reenvio consciente do usuário cria novo `operation_id` e informa `retry_of`; não recicla a identidade anterior.

## Garantias e limites exatos

Esta arquitetura garante:

- aceite durável R3 após `PubAck` válido;
- deduplicação de publishes com o mesmo `command_id` durante cinco minutos;
- entrega pelo menos uma vez enquanto a mensagem existe no stream;
- isolamento de consumo por subject/worker;
- serialização por entidade e paralelismo entre entidades;
- fence contra container/epoch obsoleto;
- deduplicação do efeito enquanto o estado Redis correspondente sobrevive.

Ela **não** garante exatamente uma vez de ponta a ponta:

- Redis atual usa AOF `everysec` e replicação assíncrona; uma falha catastrófica pode perder aproximadamente um segundo de ledger, e não há Sentinel para failover automático;
- um crash após o efeito no provedor e antes da confirmação pode produzir estado ambíguo;
- `MaxAge=5m` remove inclusive mensagem ainda não confirmada quando ela envelhece; worker offline por mais de cinco minutos perde comandos pendentes daquele período;
- `DiscardNew` rejeita a nova mensagem ao saturar; o produtor deve propagar erro e alertar;
- a janela pública de retry de dois minutos termina antes da deduplicação do servidor, deliberadamente deixando margem para retries;
- `UC_WORKER_FAILURES_V1` também rejeita novos registros ao atingir 1 GiB; se registrar a falha falhar, o comando não deve ser confirmado como sucesso;
- `UC_WORKER_DEFERRED_V1` usa `DiscardOld` apenas porque o scheduler exige; sem limites de contagem/bytes no stream, o único descarte normal é o `MaxAge=5m`, e quota/disco cheios precisam rejeitar novos publishes;
- não há transação única entre Redis, JetStream, o provedor e Kafka global.

Após `succeeded`, um redelivery encontra o ledger, não chama o provedor e apenas confirma o comando. Após `provider_invoked` sem resultado comprovado, o efeito permanece ambíguo e exige ação explícita. Expiração no stream e expiração no ledger são eventos diferentes e precisam de métricas distintas.

## Readiness do command plane no Manager

O endpoint `GET /v1/health/check` do Manager publica um snapshot process-local
dos quatro componentes obrigatórios: relay diferido, reconciliador de mensagens
queued, reconciliador de deadline e drainer de recovery. Cada componente tem
eleição Redis independente; por isso uma instância pode aparecer como `mixed`,
líder de alguns componentes e standby de outros.

- líder só fica ready quando a eleição está saudável, o loop está running e,
  quando aplicável, a conexão e todos os contratos NATS exigidos foram
  validados;
- follower retorna 200 apenas depois de comprovar o estado `standby` e uma
  eleição saudável;
- `electing`, `stopped`, perda da eleição Redis, falha de startup, loop parado,
  NATS indisponível ou drift de stream/KV retornam 503;
- a barrier operacional é consultada no Redis e exposta com `state`,
  `generation` e `active_permits`; barrier pausada ou Redis indisponível
  também retorna 503;
- falhas são normalizadas sem mensagem, stack, DSN ou payload e permanecem no
  snapshot com contador por componente.

A consulta HTTP não abre conexão NATS. Um probe assíncrono reutiliza uma única
conexão administrativa e atualiza o snapshot a cada 15 segundos; `checked_at`
permite detectar evidência antiga. O relay também publica o estado de sua
execução real, de modo que uma falha do loop entre probes deixa o líder
imediatamente não ready e o supervisor tenta reiniciá-lo. O campo
`worker_command_telemetry` permanece observacional e não substitui esses gates.

## Segurança

No Compose local, as portas de cliente são expostas exclusivamente no IP
`10.0.2.12` para que Balance e workers alcancem os três nós; as portas de
monitoramento continuam somente em loopback. Há contas separadas de sistema e
aplicação, credenciais distintas para rota, bootstrap/admin e runtime, e
negação explícita das APIs destrutivas para runtime. As senhas padrão são
apenas locais e descartáveis, portanto o host deve restringir 4222–4224 à rede
confiável e nunca expô-las à Internet.

Produção deve, antes do rollout:

- usar TLS com verificação de nome e CA, sem `NATS_TLS=false`;
- entregar segredos fora do Git e rotacioná-los;
- usar `NATS_ADMIN_USER`/`NATS_ADMIN_PASSWORD` somente no plano de controle e
  `NATS_USER`/`NATS_PASSWORD` como a identidade estática dos runtimes. A senha
  nunca deve aparecer em logs, argumentos de processo ou arquivos versionados;
- injetar a identidade estática de runtime na criação de containers cold,
  recreated e warm. A promoção do warm preserva essa identidade enquanto
  troca somente a atribuição fenced do canal;
- não criar arquivos `.creds`, mounts por canal, JWT/NKey ou payloads de
  credencial na ativação gRPC. `NATS_TOKEN` e `NATS_CREDS_BASE64` são formatos
  legados recusados explicitamente em produção;
- aplicar na conta estática de runtime as permissões agregadas necessárias aos
  subjects `uc.worker.command.*`, falhas, deferred e KV. O isolamento entre
  canais continua sendo garantido pelo `worker_id`, epoch e runtime fence da
  aplicação, não por uma identidade NATS por canal;
- restringir as APIs `$JS.API` aos consumers/KV realmente necessários;
- autorizar no principal estático de runtime o direct-get wildcard
  `$JS.API.DIRECT.GET.KV_UC_WORKER_EPOCH_V1.$KV.UC_WORKER_EPOCH_V1.worker.*`;
  `KV.Get` dos SDKs atuais usa essa API e, sem ela, o provider pode conectar
  enquanto o command ingress permanece deliberadamente não ready;
- não expor a porta de monitoramento publicamente;
- permitir que os hosts remotos dos containers alcancem todos os endpoints NATS anunciados;
- testar reconnect e rebind nos runtimes Baileys, WWebJS e WhatsMeow após perda
  de um nó, perda de rota, leader election e outage completo dos endpoints NATS
  em ambiente de teste, sempre sem recriar o runtime;
- após cada cenário, exigir atividade de pull no mesmo durable, sem backlog ou
  redelivery inesperado, e que o health volte a `command_ingress_ready=true` e
  `command_ingress_authorized=true`; `num_waiting=1` observado é evidência
  auxiliar, nunca a prova isolada.

## O que esta entrega não fez

- não alterou `/home/maycon/underchat-argocd`;
- não instalou NATS no cluster de produção;
- não criou endpoint externo, load balancer, certificado, PVC, scrape ou alerta de produção;
- não removeu tópicos nem consumer groups Kafka;
- não apagou chaves Redis V2/V3;
- não habilitou fallback ou dupla execução de comandos.

A implantação e as remoções são operações separadas, guiadas pelos runbooks:

- [Infraestrutura e operação](../runbooks/worker-command-jetstream-infra.md)
- [Migração e limpeza de Kafka](../runbooks/worker-command-jetstream-migration.md)
- [Limpeza do ledger Redis legado](../runbooks/worker-command-ledger-cleanup.md)

## Referências

- [NATS JetStream streams](https://docs.nats.io/nats-concepts/jetstream/streams)
- [Headers do scheduler JetStream](https://docs.nats.io/nats-concepts/jetstream/headers)
- [ADR-51: mensagens agendadas no JetStream](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-51.md)
- [JetStream delivery e deduplicação](https://docs.nats.io/using-nats/developer/develop_jetstream/model_deep_dive)
- [NATS KV](https://docs.nats.io/nats-concepts/jetstream/key-value-store)
- [JetStream clustering](https://docs.nats.io/running-a-nats-service/configuration/clustering/jetstream_clustering)
- [Monitoramento JetStream](https://docs.nats.io/running-a-nats-service/nats_admin/monitoring/monitoring_jetstream)
