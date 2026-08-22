# Incidente de envio e recebimento WhatsApp — 2026-07-20

## Escopo

- Conta: `019e4a29-ac52-77d5-a9a7-34b334039dbc`
- Worker: `019f6ca3-63a3-74c4-8543-0133afdeab91`
- Provider: WWebJS
- Servidor: Servidor 1
- Número: `5521966475000`
- Conversa usada na correlação: `019f811a-7b10-7434-aec1-7575d7f809cb`

Todos os horários abaixo estão em UTC. Para o horário de Brasília em
2026-07-20, subtrair três horas.

## Resumo executivo

O incidente teve mais de uma causa. O runtime Chromium/WWebJS antigo ficou com
o processo vivo, porém sem responder, por mais de 69 minutos. Docker não tinha
`HEALTHCHECK`, e o self-monitor descartava a evidência de que havia uma sessão
ativa quando o próprio `getState` expirava. Por isso, o contador de falhas era
zerado e o runtime travado não era recuperado de forma determinística.

Durante desconexões e recriações, havia ainda três caminhos de perda:

1. consumidores Kafka operacionais eram posicionados no high watermark a cada
   assignment, descartando o backlog;
2. a limpeza de runtime excluía tópicos duráveis do worker, inclusive a fila
   direta de envio;
3. o spool de entrada no Redis era apagado no disconnect e considerava uma
   lease revogada como publicação bem-sucedida.

Uma chamada Puppeteer `sendMessage` também podia aguardar o timeout padrão de
300 segundos. Esse valor coincide com os relatos de aproximadamente cinco
minutos e com o watchdog Kafka de 300 segundos. Uma Promise do provider presa
mantinha a cadeia ordenada do chat ocupada e podia bloquear outros registros
da mesma partição.

## Evidências de produção

### Runtime WWebJS

- O runtime antigo (`172.18.0.36:50053`) retornou repetidamente
  `DEADLINE_EXCEEDED` em exatamente 10 segundos entre `15:48:17` e depois de
  `16:57`, uma janela superior a 69 minutos.
- Foram observadas 31 falhas de chamada no intervalo analisado: 30 deadlines e
  uma indisponibilidade.
- A recuperação apresentou concorrência entre lifecycle e warm pool:
  `RequestConnection` expirado, readiness expirado, `ECONNREFUSED` e duas
  rejeições `Warm activation lifecycle changed before finalization`.
- O runtime atual iniciou às `19:40:34`, ficou pronto às `19:41:03` e está na
  geração 11. O número de gerações em quatro dias confirma churn elevado.
- A inicialização saudável observada levou aproximadamente 20 segundos, maior
  que o deadline gRPC anterior de 10 segundos.

### Saúde do Servidor 1 durante a falha

- aproximadamente 70,5% de CPU ociosa;
- load de 3,55 para 12 CPUs;
- 9,9 GB de memória disponíveis;
- `iowait` de 0,01%;
- latência média de disco de 0,31 ms e utilização de 7,7%;
- sem OOM, hung task, erro de I/O, saturação de conntrack ou erro/drop de rede.

Isso exclui saturação geral do host como causa provável e isola o problema no
runtime WWebJS/Chromium e em sua recuperação.

### Kafka e correlação da conversa

O tópico `worker.<worker-id>.send.message` tinha uma partição e replication
factor 2. Seu primeiro offset disponível era `0`, criado às `19:40:24`, no
mesmo momento da última recriação. O worker já existia desde 16 de julho. Isso
é evidência de que a limpeza de runtime recriou/apagou o tópico e, com ele, o
backlog anterior.

Para as quatro mensagens da plataforma na conversa da captura:

| Mensagem     | Persistida pela aplicação | Registro no Kafka | Atualização após provider | Aplicação → Kafka | Kafka → atualização |
| ------------ | ------------------------- | ----------------- | ------------------------- | ----------------: | ------------------: |
| saudação     | 19:57:19.267              | 19:57:19.432      | 19:57:29.515              |            165 ms |            10,083 s |
| resposta 1   | 19:57:25.492              | 19:57:26.047      | 19:57:32.506              |            555 ms |             6,459 s |
| resposta 2   | 19:58:14.433              | 19:58:14.549      | 19:58:17.562              |            116 ms |             3,013 s |
| encerramento | 20:00:34.763              | 20:00:34.858      | 20:00:42.695              |             95 ms |             7,837 s |

O caminho aplicação → Kafka estava subsegundo. Depois que o runtime atual
ficou saudável, 409 envios tiveram p50 de 672 ms, p95 de 1,096 s, p99 de
1,499 s e máximo de 7,301 s dentro do provider, sem caso acima de 10 segundos.

### Redis, PostgreSQL e Elasticsearch

- Redis: sem rejeição, eviction ou erro de persistência; spool atual vazio.
- PostgreSQL: acessível e sem evidência de indisponibilidade no caso.
- Elasticsearch: cluster verde, cinco nós, sem shard não atribuído.
- No Elasticsearch, 183 de 992 mensagens da plataforma com chave física do
  provider no dia (`18,4%`) ainda estavam com `summary.is_sent=false`. A chave
  física só é obtida depois que `client.sendMessage` retorna. Isso comprova uma
  perda relevante de atualizações de status, coerente com assignments que
  pulavam backlog e com corridas de status/chave.

### Amostra cruzada: Baileys e WhatsMeow

A mesma classe de problema não estava limitada ao WWebJS:

- o banco tinha 130 canais Baileys e 110 WhatsMeow marcados `online`, enquanto
  os onze hosts possuíam somente 100 e 106 containers ativos,
  respectivamente; eram 34 registros `online` sem runtime correspondente;
- 30 Baileys e seis WhatsMeow estavam sem verificação/conexão recente por mais
  de um dia;
- na amostra de logs das últimas 24 horas, Baileys teve 20 desconexões e 21
  reinícios de consumer em sete canais; WhatsMeow teve 28 desconexões;
- cada retomada WhatsMeow registrada reposicionava o consumer no fim do
  tópico. Foram 196 assignments observados com essa política. Assim, qualquer
  evento acumulado durante a queda podia ser ignorado no reconnect.

O envio Baileys também chamava `sock.sendMessage`/`relayMessage` sem deadline
de aplicação. O timeout de confirmação de 20 segundos só começava **depois**
que a Promise do provider retornava; uma Promise presa podia, portanto, ocupar
a cadeia ordenada até o watchdog Kafka de cinco minutos.

### Incidente de recriação dos 155 canais

O arquivo fornecido contém exatamente 155 canais em erro:

| Provider  | Canais |
| --------- | -----: |
| Baileys   |    106 |
| WWebJS    |     27 |
| WhatsMeow |     22 |

Eles estavam distribuídos pelos Servidores 1 a 9; 117 receberam atualização
em 19/07 e 38 em 20/07. A investigação nos onze hosts confirmou:

- os 155 volumes referenciados existiam;
- 122 ainda tinham container em execução, mas nenhum tinha scope de conexão
  ativo;
- 27 de 28 volumes Baileys recentes não continham `creds.json` e eram sessões
  novas, aguardando QR;
- o WhatsMeow amostrado tinha `store.db`, porém `has_store_id=false`, ou seja,
  arquivo físico sem identidade autenticada;
- os mounts atuais coincidiam com `worker_runtime.session_volume_name`.

Nos seis recreates recentes correlacionados, o Service registrou
`Recreated worker connection state was not confirmed`. Entretanto, a saúde
gRPC de todos eles provava um runtime válido para QR:

```text
activated=true       runtime_state=active
ready=true           qr_stream_ready=true
has_session=false    authenticated=false
session_ready=false  kafka_consumers_ready=false
```

Nos cinco Baileys, `provider_state=missing_socket` e o resumo era
`expected=7, active=0, missing=7, unhealthy=0`. Esses consumers dependem da
sessão/socket e não devem existir antes da leitura do QR. A condição de
recriação exigia `kafka_consumers_ready=true` para declarar o canal
`disponible`: uma dependência circular que transformava um runtime saudável,
sem sessão, em erro.

Havia uma segunda falha no retry. Na primeira exceção do recreate, o handler
marcava o worker como erro e limpava `lifecycle_operation_id`. A entrega Kafka
seguinte era então classificada como stale e confirmada. Na prática, a política
de três tentativas fazia somente uma tentativa útil.

### Monitor dos workers

Os três pods `schedule-production` executam o monitor a cada dez minutos com
lock distribuído. Nas 24 horas analisadas houve 15 passes abortados, divididos
em 5, 4 e 6 falhas por pod. O PostgreSQL registrava valores UUID inválidos como
`ue`, `019db6` e fragmentos semelhantes.

A origem não era dado inválido no banco: `SshService.runCommands` devolve
chunks arbitrários de stdout, mas o monitor inseria `\n` entre chunks. Quando
o SSH dividia um UUID no meio, o código fabricava duas linhas e passava o
fragmento a uma coluna `uuid`, abortando toda a varredura daquele servidor.
Isso explica parte dos canais `online` sem container e por que o recebimento
parecia parar sem o monitor recuperar o runtime.

### Service API e topologia Kafka

- 15/15 pods `service-production` estavam Ready, sem restart, distribuídos em
  dez nós;
- consumo de CPU observado entre aproximadamente 278 e 814 millicores e RAM
  entre 825 e 892 MiB, abaixo dos limites de 5 CPU/6 GiB;
- os tópicos globais de 30 partições eram divididos entre os 15 membros, com
  duas partições por pod e grupos independentes;
- `user.phone.jid.update`, porém, tinha somente uma partição. O grupo tinha 15
  membros, mas 14 não podiam executar trabalho desse tópico;
- não havia backlog sistêmico, partição indisponível ou under-replicated;
- o cluster continha aproximadamente 4.475 tópicos e 2.922 consumer groups.
  Essa quantidade, majoritariamente de workers antigos/DLQs, é dívida
  operacional de metadata;
- a produção ainda executava 13 consumers com a política antiga
  `latest-on-assignment`, pois as correções locais ainda não tinham rollout;
- o readiness podia continuar HTTP 200 com snapshot Kafka degradado e, no
  rollout normal, aceitava tráfego antes do término da inicialização dos
  consumers.

### Alteração controlada já executada em produção

Com autorização explícita e em janela sem pico, `user.phone.jid.update` foi
expandido de 1 para 30 partições. Antes da alteração, duas leituras separadas
por cinco segundos mostraram offset `81/81`, nenhuma mensagem nova e lag zero.

Após o alter/rebalance:

- tópico com 30 partições, RF2 e ISR completo;
- recurso declarativo `KafkaTopic` reconciliado pelo Strimzi em
  `kafka.strimzi.io/v1`, com a mesma topologia, para evitar regressão;
- grupo `group-underchat-user-phone-jid-update` em estado `Stable`;
- 15 membros, exatamente duas partições por membro;
- 30 partições atribuídas e lag total zero;
- nenhuma partição offline/under-replicated e nenhum erro de rebalance nos
  pods Service.

Uma nova ocorrência de `Recreated worker connection state was not confirmed`
foi observada no Service às `01:58:14 UTC`, depois da expansão. Ela não foi
causada pelo novo particionamento: reproduz exatamente o ciclo de QR/sessão
descrito acima e confirma que produção continua com o binário antigo até o
rollout das correções.

O RF foi mantido em 2 nessa intervenção. Elevar RF para 3 exige reassignment de
réplicas e deve ser uma mudança de infraestrutura separada.

### Risco de memória Kafka descoberto durante a verificação

Às `2026-07-21 01:39:18 UTC` (`22:39:18 BRT`), o broker 0 foi encerrado por
`OOMKilled` no limite de 8 GiB e reiniciou em aproximadamente um segundo. O
cluster se recompôs com ISR completo: depois do restart continuavam zero
partições offline, zero under-replicated, e o grupo alterado permanecia com 30
partições, 15 membros e lag zero.

Esse evento não prova que a expansão causou o OOM. As 29 partições adicionadas
representam cerca de 0,54% das 5.394 partições do cluster e ficaram balanceadas
entre os cinco brokers. Há, porém, correlação temporal: fetches das novas
partições aparecem no mesmo segundo do OOM. A interpretação mais conservadora
é que o churn de metadata/replica pode ter sido o gatilho que expôs uma margem
já esgotada, não que 29 partições expliquem sozinhas o consumo. A evidência
estrutural é:

- heap JVM de 4 GiB e limite de container de 8 GiB;
- Java RSS próximo de 5 GiB nos brokers antigos;
- consumo de cgroup observado entre 6,9 e 7,8 GiB nos demais brokers, com um
  deles já tendo atingido praticamente todo o limite;
- 4.475 tópicos/5.394 partições, milhares de descritores e page cache dentro do
  mesmo cgroup;
- armazenamento dos brokers em volumes efêmeros do pod.

Na verificação final, às `02:54:19 UTC`, os cinco brokers estavam Ready, o
broker 0 continuava com somente aquele restart (mais de 75 minutos sem
recorrência), o working set observado estava entre aproximadamente 4,9 e 6,0
GiB, e o cluster permanecia com zero partição offline/under-replicated. O
Service estava 15/15 Ready, sem restart; o grupo alterado seguia `Stable`, com
15 membros, duas partições por membro e lag zero.

Por isso, não foi iniciado um rollout de memória às cegas: trocar o
`KafkaNodePool` recria pods e, com storage efêmero, obriga a reconstrução de
milhares de réplicas. A correção segura é uma mudança controlada, verificando
ISR entre cada broker, combinada com limpeza auditada de tópicos mortos,
storage persistente e alertas de RSS + cache/limite e OOM.

## Causas raiz

### 1. Runtime vivo, porém Chromium travado

O processo Node permanecia vivo, portanto Docker não reiniciava o container.
Quando `getState` expirava, o health result passava a informar
`authenticated=false`. O self-monitor exigia evidência atual de sessão e
zerava `consecutiveFailures`, exatamente quando deveria escalar a recuperação.

### 2. Política Kafka destrutiva

A mudança publicada em 17 de julho (`6ea72e962`/`5bf44c7b4`) passou a aplicar
`latest-on-assignment` aos tópicos operacionais. Em qualquer reconnect ou
rebalance, o consumidor buscava o high watermark e o confirmava, descartando
tudo que ainda não havia sido processado. Isso afetava tanto o send topic do
worker quanto upserts e status centrais.

### 3. Exclusão do send topic em recriações

O cleanup normal usava uma operação que incluía
`worker.<id>.send.message`. Recriar um runtime, portanto, removia a própria fila
que deveria sobreviver à indisponibilidade do provider.

### 4. Spool de recebimento não sobrevivia ao cutover

O spool persistia antes de publicar, mas `stopPublisher` executava `UNLINK` nos
streams, retries e parking. Além disso, `{ executed: false }` retornado pela
lease era ignorado; o loop fazia `XACK`/`XDEL` como se o Kafka tivesse recebido
o evento.

### 5. Reconciliação filtrava o intervalo da queda

A reconciliação estava desabilitada em produção. Mesmo habilitada, usava
`connection_date`/`activated_at` como limite mínimo e rejeitava mensagens
anteriores à conexão atual — precisamente o intervalo que deveria recuperar.

### 6. Budgets de cinco minutos e simulação de digitação sem limite global

O Puppeteer tinha `protocolTimeout=300000`, `sendMessage` não possuía deadline
de aplicação e o watchdog Kafka também usava 300000 ms. A simulação de
digitação era executada antes do provider e não tinha deadline global; texto
longo ou uma chamada de presence travada podia segurar a cadeia do chat.

### 7. Realtime confirmava falhas silenciosamente

O backend do Centrifugo engolia erros de publish e devolvia sucesso, permitindo
o commit Kafka sem entrega ao navegador. No frontend, unsubscribe/error não
reinicializava a conexão, e o cursor podia ser sobrescrito antes de concluir a
recuperação.

### 8. Recriação confundia "pronto para QR" com "sessão online"

Os consumers de envio/recebimento só podem subir após existir sessão. Exigi-los
para aceitar o estado sem sessão tornava impossível concluir a recriação como
`disponible`. A falha precoce ainda removia o fence da operação, neutralizando
as tentativas Kafka seguintes.

### 9. Monitor corrompia stdout fragmentado do SSH

Chunks de stream eram tratados como linhas. Um UUID dividido pelo transporte
derrubava o passe inteiro do monitor em vez de isolar um worker/servidor.

### 10. WhatsMeow confirmava falhas de handler

O loop Go concluía o coordinator de commit mesmo quando o handler falhava ou
expirava. Além disso, mark-read engolia falhas de Redis/provider. Isso permitia
perda silenciosa, não somente atraso.

### 11. Lease de efeito revogada podia confirmar offset

Quando a aquisição da lease retornava sem proprietário, o runner podia tratar
o handler como concluído. A geração antiga, já sem autorização para produzir
efeito, confirmava o registro que deveria ser relido pela geração atual.

### 12. Topologia desejada não era reconciliada

`ensureKafkaTopic` criava o tópico, mas considerava `already exists` como
topologia correta. Com `auto.create.topics.enable=true` e default de uma
partição no broker, uma corrida podia deixar um tópico global permanentemente
subdimensionado.

### 13. Coordenadores de commit assumiam offsets consecutivos

Os runners Node e Go avançavam commit somente quando o próximo número era
exatamente `offset + 1`. Tópicos compactados podem entregar, por exemplo, 10 e
12 sem entregar 11. Ambos eram processados, mas o segundo permanecia sem
commit indefinidamente, gerando redelivery/lag aparente e possível duplicação.

### 14. Retry Redis podia ficar parcial ou órfão

O payload e o agendamento do retry eram gravados em comandos separados. Uma
falha entre `HSET` e `ZADD` deixava estado parcial. Na retomada, somente as
primeiras 500 chaves do índice eram examinadas; scopes posteriores nunca eram
adotados por uma nova geração.

### 15. Respostas realtime antigas podiam atravessar contas

Subscriptions e requests iniciados na conta A podiam terminar depois da troca
para B. Algumas actions Pinia já haviam mutado o store antes do fence no
composable, e o chat interno guardava apenas uma flag global de inicialização.
Isso permitia contaminar a visão/notificação da conta B com resposta ou evento
tardio da conta A.

## Correções implementadas no worktree

- todos os consumers WhatsApp usam offsets committed; pedidos legados de
  `latest-on-assignment` são normalizados para committed;
- cutover para high watermark exige opt-in explícito de bootstrap;
- WhatsMeow respeita o offset entregue pelo consumer group;
- nenhum tópico é excluído em reconnect/recreate; todos só são excluídos após
  a remoção permanente do worker ter sido concluída;
- o self-monitor retém evidência de sessão ativa em falhas inconclusivas de
  probe e escala após falhas consecutivas;
- `sendMessage` WWebJS tem deadline de aplicação de 45 s e timeout CDP de 60 s;
- o auto-reply direto recebeu o mesmo deadline e trata rejeições tardias;
- simulação de digitação/presence é best effort e limitada a 15 s;
- disconnect apenas pausa o spool; a nova geração assume os scopes persistidos
  com posse explícita, sem que um teardown tardio da geração antiga consiga
  parar os novos loops;
- uma lease revogada gera retry e nunca ACK de sucesso;
- itens pendentes não são apagados durante teardown;
- replay de spool antigo é re-fenced para a geração ativa e marcado como
  histórico para evitar efeitos automatizados antigos;
- reconciliação foi habilitada, usa uma janela configurável de seis horas e
  não corta mais pelo instante da reconexão; o rollout amplia o teto para
  1.000 mensagens, separando-o dos limites de chats e mensagens por chat para
  não multiplicar carga no Chromium;
- publish Centrifugo com fence Kafka passa a falhar de forma observável e com
  retry limitado; callers HTTP best-effort registram a falha sem alterar o
  contrato transacional já existente;
- falha no canal realtime de mensagens deixa de ser ignorada por um
  `Promise.allSettled`, impedindo commit Kafka sem publicação confirmada;
- frontend preserva o último cursor aplicado, reinicializa após unsubscribe e
  recupera lacunas antes de avançar o offset; subscriptions reaproveitadas
  recebem novamente seus handlers após cleanup/relogin;
- respostas HTTP e batches realtime são cercados por conta e geração antes de
  qualquer mutação Pinia; unread, pinned, Kanban, mensagens e todas as listas
  usadas por `reloadAllChatLists` descartam respostas antigas. O chat interno
  também faz teardown/resubscribe serializado em A → B e invalida handlers da
  conta anterior;
- retries de publicação fenced no Centrifugo reutilizam uma chave de
  idempotência estável também em redeliveries Kafka tardias, não apenas dentro
  da janela local de dois segundos;
- recreate sem sessão aceita runtime ativado, QR/control prontos e ausência
  explícita de sessão como `disponible`; consumers dependentes do provider não
  são exigidos nessa fase, mas `qr_stream_ready` não é confundido com provider
  iniciado: `RequestConnection` continua obrigatório antes do estado final;
- todas as operações/validações de volume terminam antes de remover o
  container. O mount do container ativo prevalece sobre uma linha
  `worker_runtime` divergente e corrige essa linha; se o volume realmente não
  existe, um volume novo é criado. A reconciliação final sem sessão limpa
  `number`/`connection_date` mesmo depois de retry e termina pronta para QR;
- falha transitória de lifecycle mantém `lifecycle_operation_id`; somente a
  compensação terminal, depois das tentativas Kafka, marca erro e libera o
  fence;
- stdout de SSH é recomposto sem inventar separadores, nomes de worker passam
  por validação UUID e falhas são isoladas por servidor e por worker; o mesmo
  reparo foi aplicado ao reconciliador de warm pool;
- Baileys aplica deadline duro de 45 s a `sendMessage`, `relayMessage` de
  áudio view-once e auto-resposta de chamada, observando também resoluções e
  rejeições tardias para não criar `unhandled rejection` ou retry duplicado;
- WhatsMeow usa tentativas limitadas, backoff e ordenação por entidade. Um
  handler que ignora cancelamento deixa de renovar a lease e mantém a chave em
  quarentena até realmente encerrar; falha/timeout reinicia a geração sem
  commit. Claims `provider_invoked` ficam duravelmente ambíguos em vez de serem
  reenviados às cegas, e schedule ocupado força redelivery sem sobreposição;
- os coordenadores Node e Go confirmam o prefixo dos offsets efetivamente
  entregues, não uma sequência numérica presumida, cobrindo gaps de compactação;
- retry/parking do spool grava payload e índice atomicamente via Lua. A adoção
  de scopes antigos pagina em lotes limitados, preserva cursor, verifica o
  fence entre páginas e progride até EOF; streams e retries de generations
  WhatsMeow antigas/legacy são re-fenced para a geração ativa;
- lease de efeito indisponível por falha de infraestrutura reinicia a geração
  sem commit; eventos comprovadamente stale/malformados são tratados como
  terminais para não bloquear uma partição para sempre;
- readiness normal fica 503 até Kafka estar pronto; consumidores críticos
  inativos/sem assignment retiram o pod dos endpoints. A exceção durante
  bootstrap exige opt-in destrutivo explícito;
- `ensureKafkaTopic` passa a elevar um tópico existente ao mínimo configurado,
  sem reduzir partições nem alterar RF automaticamente; pisos de uma partição
  não emitem `createPartitions` redundante nos milhares de tópicos por worker;
- regras Prometheus alertam RSS+cache dos brokers acima de 80%/90% do limite e
  qualquer `OOMKilled`, sem depender do exporter JMX do Kafka;
- a reconciliação histórica WhatsMeow agora usa a janela de seis horas também
  no último filtro do spool, em vez de voltar a cortar tudo no instante da
  conexão.

## Defaults embutidos no código

As variáveis novas não são pré-requisito de produção. Com todas elas ausentes
(estado confirmado no ConfigMap atual), os binários usam:

| Comportamento                          | Default no código |
| -------------------------------------- | ----------------: |
| reconciliação histórica                |        habilitada |
| janela de histórico                    |           6 horas |
| limite global de mensagens             |             1.000 |
| chats examinados / limite por chat     |         100 / 250 |
| deadline WWebJS/Baileys                |       45 segundos |
| timeout CDP WWebJS                     |       60 segundos |
| teto de simulação de digitação         |       15 segundos |
| deadline gRPC RequestConnection        |       30 segundos |
| cutover para high watermark            |      desabilitado |
| health geral falha com Kafka unhealthy |        habilitado |

Valores válidos fornecidos por env continuam funcionando como override;
ausência, zero ou valor inválido cai no default seguro quando aplicável.

## Validação local concluída

- 39 suítes Jest afetadas: 38 aprovadas e uma suíte de integração ignorada por
  ausência de `TEST_KAFKA_BROKER`; 740 testes aprovados e seis ignorados;
- `go test -race ./... -count=1` aprovado no Worker WhatsMeow com um Redis 7
  descartável local, incluindo os testes de integração de fence, claims e
  migração stream/retry A → B; `go vet ./...` aprovado;
- typecheck raiz e Web, ESLint/Prettier de todos os arquivos
  TypeScript/JavaScript/Vue alterados, `gofmt`, validação de localizações e
  `git diff --check` aprovados;
- builds de Service API, Worker WWebJS, Worker Baileys e Web aprovados.

O teste Kafka que exige broker real precisa ser executado no ambiente de
staging/canário durante o rollout; ele não foi simulado como aprovado.

## Rollout e verificação

1. Publicar as imagens de Service API, Worker WWebJS, Worker Baileys,
   Worker WhatsMeow e Web a partir do mesmo commit.
2. Não é necessário aplicar as novas variáveis: os valores seguros estão nos
   binários. O arquivo `env.md` permanece apenas como referência/override.
3. Fazer rollout gradual dos consumers centrais e verificar que o lag parte
   dos offsets committed, sem seek para high watermark.
4. Recriar um worker canário e publicar mensagens enquanto ele está offline;
   após reconectar, confirmar consumo de todo o backlog em ordem.
5. Forçar falha do Centrifugo e confirmar que o Kafka não é confirmado até o
   retry terminar ou a falha ser exposta.
6. Forçar timeout de `getState` após uma sessão saudável e confirmar pedido de
   self-healing no terceiro probe.
7. Monitorar por worker: idade do registro mais antigo no send topic, lag,
   tempo API → Kafka, Kafka → provider, provider → ACK, idade do spool, retries
   e quantidade de mensagens com chave física e `is_sent=false`.
8. Aplicar a configuração de probe do Service: três falhas a cada dez segundos
   (remoção em aproximadamente 30 s), PDB mínimo de 12/15 pods e as novas
   regras de memória/OOM do Kafka.
9. Versionar/publicar no repositório ArgoCD o `KafkaTopic` de 30 partições. O
   recurso já está `Ready` no cluster, mas o manifesto local ainda precisa
   entrar no Git para que a topologia fique permanentemente declarativa.
10. Planejar separadamente: reassignment RF3/minISR2 dos tópicos centrais,
    armazenamento persistente dos brokers, ampliação controlada da margem de
    memória (sem aumentar o heap automaticamente), limpeza auditada dos milhares
    de tópicos/groups legados e HPA orientado por CPU/lag. O OOM do broker 0
    torna essa etapa prioritária, mas cada broker deve avançar somente com ISR
    completo e zero partição offline.

As alterações deste documento são de código/configuração no worktree. Elas só
passam a valer em produção depois do pipeline de build e do rollout controlado.
