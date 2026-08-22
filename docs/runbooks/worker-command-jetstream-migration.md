# Runbook de migração dos comandos para JetStream

Objetivo: migrar todos os comandos destinados a containers de canal dos tópicos Kafka por worker para o contrato [JetStream compartilhado](../architecture/worker-command-jetstream.md), sem dois executores, sem dual-write e sem fallback automático.

Este runbook não autoriza mudanças no cluster atual. A infraestrutura de produção ainda precisa de uma mudança própria e revisada em `/home/maycon/underchat-argocd`. Nesta entrega, somente o cluster Compose local foi criado.

## Invariantes de segurança

- `WORKER_COMMAND_TRANSPORT=jetstream` é a única rota de comandos na versão nova.
- Um comando nunca é publicado simultaneamente em Kafka e JetStream.
- Um worker nunca mantém consumer de comandos Kafka e consumer JetStream executáveis ao mesmo tempo.
- NATS indisponível rejeita o comando; não há fallback para Kafka ou Core NATS.
- Um publish sem `PubAck` válido é UNKNOWN e só repete o mesmo `command_id` dentro de dois minutos.
- O Kafka continua disponível para eventos/resultados globais fora deste transporte.
- `validate.phone` não migra para o command stream: o caminho suportado permanece gRPC e seu tópico Kafka só pode ser removido depois de provar tráfego zero.
- A migração não apaga tópicos, groups ou ledger durante o cutover.
- Toda retomada de admissão exige epoch, consumer e métricas saudáveis.

Essas invariantes tornam a janela de manutenção curta, porém obrigatória. Evitar indisponibilidade por dual execution criaria risco maior de efeito duplicado no provedor.

## Papéis e aprovações

Definir nominalmente antes da janela:

- incident commander, que decide avançar ou abortar;
- operador NATS, operador Kafka, operador Redis e operador dos hosts de worker;
- observador de produto/suporte para operações ambíguas;
- aprovador independente dos manifests de deleção.

Registrar horário, versões, hashes de imagem/configuração, quantidade de contas/workers, dashboards e links para evidências. Nenhum operador deve executar limpeza destrutiva sozinho.

## Fase 0 — pré-requisitos de produção

Bloqueie a migração até todos os gates abaixo estarem verdes:

1. Infraestrutura do [runbook JetStream](worker-command-jetstream-infra.md) entregue em produção, incluindo R3, File, TLS, PVC, endpoint alcançável e monitoramento.
2. `infra/nats/init.sh` equivalente executado pelo bootstrap autorizado e contrato verificado.
3. Relay global `uc_worker_deferred_relay_v1` pronto e autorizado a consumir `uc.worker.deferred.ready.*` e publicar `uc.worker.command.*`.
4. Testes de perda de um nó, leader election, reconnect e bloqueio por perda de quorum aprovados.
5. Teste de conectividade/TLS realizado a partir de cada host remoto de containers.
6. Lista autoritativa de todos os workers ativos, conta, host, provider e epoch congelada. O último inventário observado tinha 1.070 workers ativos; usar o número atual.
7. `UC_WORKER_EPOCH_V1` preenchido com compare-and-set para todos os workers ativos, sem chave faltante, conta divergente ou epoch regressivo.
8. Capacidade abaixo de 25%, espaço livre acima de 30% e nenhum alerta NATS/Redis/Kafka aberto.
9. Barrier operacional testada: deve rejeitar novos comandos antes de alocar lane/publicar, pausar queued/deadline/recovery/deferred e expor geração e quantidade global de permits em voo.
10. Métricas de comandos admitidos, diferidos, inflight no handler, chamadas ao provedor e operações ambíguas disponíveis.
11. Imagens novas de produtores/workers prontas, mas ainda não executando consumers JetStream.
12. Imagem JetStream conhecida e procedimento de roll-forward disponíveis. A versão Kafka de comandos não é mecanismo de rollback.
13. Métricas e logs confirmam zero produce/consume em `worker.<id>.validate.phone` durante a janela de observação, e testes funcionais comprovam que validação de telefone continua pelo caminho gRPC. Qualquer tráfego Kafka nesse fluxo bloqueia sua remoção; ele não deve ser convertido em comando JetStream para contornar o gate.

Não criar consumer durável “de teste” que possa chamar o provedor. Testes sintéticos usam workers/contas isolados, subjects próprios do ambiente e provedor sandbox.

## Fase 1 — estabelecer a linha de base

Pelo menos 24 horas antes da janela:

- capture p50/p95/p99 e taxa de erro do envio atual;
- liste tópicos de worker, partições, bytes, oldest offset e latest offset;
- liste consumer groups, estado, membros e lag;
- conte ledger Redis por versão/estado sem `KEYS`;
- conte agendamentos e recuperações pendentes;
- exporte o roster autoritativo de worker IDs e gere SHA-256 do arquivo;
- registre apenas o inventário de recursos e o hash do roster; os comandos
  Kafka antigos foram declarados efêmeros e não exigem backup nem drenagem;
- abra um change record com todos os gates e o rollback.

O snapshot anterior encontrou 5.190 tópicos no total, 5.158 tópicos canônicos por worker, 2.294 groups no total e 2.267 groups canônicos de worker. Esses números são contexto, não critério: recalcule imediatamente antes da mudança.

## Barrier operacional: comandos reais

A barrier é global, fica em Redis e não possui TTL. A primeira leitura cria o
estado `active` com geração `1`. Cada admissão ou job protegido adquire antes
de iniciar um permit sem payload com lease hardcoded de 30 segundos; enquanto
o job ainda executa, o lease é renovado a cada 10 segundos. O `pause` é um CAS:
depois de confirmado, nenhum novo permit pode ser concedido. Os permits que já
existiam continuam visíveis para permitir drain verificável.

Os únicos controles mutáveis são métodos internos de
`WorkerCommandOperationalBarrierService` e o CLI administrativo deste
repositório. Não existe endpoint HTTP público para pause/resume. Redis
indisponível ou resposta corrompida falha fechado: a ação protegida não inicia.

Use no mesmo ambiente/secrets Redis da aplicação:

```bash
pnpm worker-command:barrier status
```

Registre a geração retornada e pause com identidade e motivo auditáveis:

```bash
pnpm worker-command:barrier pause \
  --expected-generation 1 \
  --actor change-INC1234-maycon \
  --reason 'cutover Kafka para JetStream'
```

O resultado contém `status.generation` novo e `resume_token`. O token aparece
uma única vez; Redis guarda apenas SHA-256. Grave o JSON em secret temporário
com permissão `0600`, nunca em ticket, log ou shell history. Depois do pause,
repita `status` até observar simultaneamente `state=paused` e
`active_permits=0`. O campo `oldest_permit_expires_at` limita a espera caso um
processo morra sem liberar seu permit.

Para retomar, forneça exatamente a geração pausada e o token por stdin para
que ele não apareça em argumentos de processo:

```bash
jq -r '.resume_token' /run/secrets/worker-command-barrier-pause.json | \
  pnpm worker-command:barrier resume \
    --generation 2 \
    --actor change-INC1234-maycon \
    --token-stdin
```

Uma geração antiga, token incorreto, segundo pause ou segundo resume retorna
conflito e não altera o estado. Após confirmar `state=active` na geração nova,
destrua o arquivo temporário usando o procedimento seguro da plataforma. Não
edite diretamente as chaves
`{worker-command-operational-barrier:v1}:state` e
`{worker-command-operational-barrier:v1}:permits`: isso contorna CAS e
auditoria.

## Fase 2 — cutover único, sem sobreposição

Execute em uma janela controlada e na ordem exata:

1. **Ative a barrier global de comandos.** Novos envios, marcações, configurações, notificações e agendamentos que gerariam comando devem falhar de forma explícita antes de Kafka/NATS. Pause recovery e schedulers.
2. **Espere produtores Kafka zerarem.** O contador de produce para todos os tópicos de comando deve ficar zero por pelo menos dois minutos.
3. **Esvazie somente efeitos em voo.** Confirme handlers e chamadas ao
   provedor em zero, então feche os consumers Kafka. Não drene o backlog:
   mensagens antigas foram declaradas descartáveis e jamais devem reaparecer
   depois do corte.
4. **Pare todos os consumers Kafka de comandos.** Confirme groups sem membro e nenhuma thread de handler antiga. Kafka global de resultados permanece.
5. **Revalide Redis.** Não pode haver `reserved`/`provider_invoked` antigo sem classificação; transforme evidência incerta em `ambiguous` pelo fluxo suportado, nunca apagando a chave.
6. **Revalide os epochs.** Leia o KV em quorum e confira todas as revisões/contas contra o roster congelado. Rotacione com CAS quando o novo container representar nova geração.
7. **Implante/inicie o relay diferido e depois os workers JetStream.** O relay singleton deve ligar seu durable global antes dos containers. Cada container cria somente seu pull consumer durável com `filter_subject=uc.worker.command.<worker_id>`. Espere o relay e os 1.070 workers, ou a contagem atual, reportarem ready.
8. **Valide ausência de dupla execução.** Consumer Kafka ativo deve ser zero; consumer JetStream pronto deve ser igual ao roster; nenhum subject pode ter dois executores autorizados.
9. **Implante/inicie todos os produtores JetStream.** A configuração é `WORKER_COMMAND_TRANSPORT=jetstream`; a versão não contém rota Kafka de comandos.
10. **Teste ainda sob barrier.** Use probes internas que validem conexão, KV, criação/lookup do consumer e permissões, mas não chamem o provedor.
11. **Libere a barrier.** Retome admissão e schedulers somente depois de todos os gates.
12. **Observe continuamente.** Não execute limpeza Kafka/Redis nesta fase.

Na remoção permanente de um worker, o código faz `active → draining → closed`
e remove o durable. Não execute purge do subject: o stream impede purge por
contrato e qualquer comando residual expira pelo `MaxAge=5m`. Essa espera
curta mantém a proteção operacional do stream sem conservar recurso exclusivo
do canal.

Gates de cinco minutos após abertura:

- `PubAck` aceito > 99,99%, sem fallback e sem reject de limite;
- p99 `PubAck <= 100 ms` e aceite→fetch `<= 150 ms`, ou baseline previamente aprovado;
- oldest pending < 15 s para workers online;
- backlog diferido volta a zero após rajadas, relay saudável e park→relay→command dentro do deadline;
- zero epoch ausente/divergente inesperado;
- zero comando executado por consumer Kafka;
- nenhuma duplicata de efeito confirmada;
- taxa de `ambiguous`, falha e redelivery dentro da linha de base;
- Redis p99, replicação e AOF saudáveis;
- três nós, metadata leader e todas as réplicas JetStream saudáveis.

## Critérios de abortar e recuperação

Ative a barrier imediatamente se ocorrer qualquer um:

- consumer Kafka reaparecer ou dupla chamada ao provedor;
- perda de quorum, réplica offline sustentada ou erro de storage;
- publish em stream inesperado, ausência de KV ou epoch regressivo;
- mensagem pendente por mais de 60 s com worker online;
- reject `DiscardNew`, failure publish rejeitado ou comando sumir sem terminal;
- aumento confirmado de operação ambígua/duplicada;
- Redis indisponível, AOF delayed fsync, replica lag crítico ou script de ledger falhando.

Recuperação segura depois que o primeiro comando JetStream foi admitido:

1. ative a barrier e pause schedulers/recovery;
2. pare os produtores JetStream;
3. aguarde handlers JetStream/provedor zerarem e classifique toda operação `provider_invoked` como terminal ou `ambiguous`;
4. pare todos os consumers JetStream;
5. mantenha streams, consumers e mensagens intactos para diagnóstico; não faça purge, delete ou republish;
6. corrija a causa e implante uma imagem conhecida que continue usando exclusivamente JetStream;
7. revalide quorum, KV, consumers, Redis e os comandos que ainda não expiraram;
8. reinicie consumers e produtores JetStream e libere a barrier somente depois dos gates.

Depois do primeiro aceite JetStream, o transporte não volta para Kafka. Não republique mensagens JetStream em Kafka. Um comando sem terminal claro permanece ambíguo e o usuário decide reenviar com novo `operation_id` e `retry_of`.

## Soak antes da limpeza

Mantenha os tópicos Kafka intactos, mas sem producer/consumer de comandos, por
**24 horas completas**. Esse período valida o novo caminho; não preserva o
backlog como fonte de recuperação. Durante ele:

- nenhum componente pode provisionar ou autoproduzir em `worker.<id>.*`;
- alertar sobre qualquer byte ou offset novo nesses tópicos;
- confirmar diariamente os gates NATS, Redis e provedor;
- testar restart e recriação de workers provando que o `epoch` lógico não
  muda, o backlog ainda dentro de cinco minutos é consumido pelo substituto e
  o `runtime_writer_epoch`/`runtime_generation` anterior fica revogado;
- acompanhar todas as operações ambíguas por pelo menos 24 horas;
- não consumir, copiar ou republicar offsets/payloads antigos.

Depois das 24 horas sem tráfego legado, gere o manifest de limpeza, congele seu
hash e faça nova coleta imediatamente antes da exclusão.

## Escopo exato dos recursos Kafka legados

Um tópico deletável precisa casar exatamente:

```text
worker.<worker_uuid>.send.message
worker.<worker_uuid>.schedule.send.message
worker.<worker_uuid>.validate.phone
worker.<worker_uuid>.notification.message
worker.<worker_uuid>.webhook.integration
worker.<worker_uuid>.webhook.integration.dlq
worker.<worker_uuid>.send.message.dlq
worker.<worker_uuid>.consumer.dlq
mark.message.read
worker.config.update
```

Nos oito padrões por worker, o `worker_uuid` precisa estar no roster aprovado e
o parser deve reconstruir o mesmo nome byte a byte. Os dois nomes globais são
exceções explícitas porque `mark-read` e configuração também migraram para o
ingress direcionado; só podem ser removidos após confirmar zero producer e
zero consumer antigo. Não usar glob, regex de deleção nem “começa com
`worker.`”. Não tocar `worker.warm`, `worker.lifecycle` nem qualquer outro
tópico Kafka de resultado/evento global.

`worker.<worker_uuid>.validate.phone` é somente resíduo legado: ele não possui
substituto no JetStream. Exclua esse tópico e seus groups apenas quando a coleta
de 24 horas comprovar zero bytes/offsets novos, zero membro e zero tentativa de
produção, e o teste ponta a ponta confirmar a rota gRPC. Se aparecer tráfego,
interrompa a exclusão desse pattern e corrija o caller; não faça dual-route.

Consumer groups deletáveis são os gerados por `workerKafkaConsumerGroupsForDeletion(workerId)`. Prefixos canônicos:

```text
group-underchat-send-
group-underchat-schedule-message-
group-underchat-validate-phone-
group-underchat-notification-send-
group-underchat-webhook-integration-
group-underchat-mark-read-
group-underchat-worker-config-update-
```

Prefixos legados:

```text
group-underchat-whatsmeow-send-
group-underchat-schedule-message-whatsmeow-
group-underchat-whatsmeow-validate-phone-
group-underchat-whatsmeow-notification-send-
group-underchat-webhook-integration-whatsmeow-
group-underchat-mark-read-whatsmeow-
group-underchat-worker-config-update-whatsmeow-
group-underchat-baileys-send-
group-underchat-wwebjs-send-
group-underchat-schedule-message-wwebjs-
group-underchat-baileys-validate-phone-
group-underchat-wwebjs-validate-phone-
group-underchat-baileys-notification-send-
group-underchat-wwebjs-notification-send-
group-underchat-webhook-integration-wwebjs-
group-underchat-mark-read-wwebjs-
group-underchat-worker-config-update-wwebjs-
```

O UUID completo vem depois do prefixo. Todo group deve estar `EMPTY` e sem
membros. Lag e offsets pendentes não bloqueiam a exclusão porque os dados
legados foram declarados efêmeros; a condição de segurança é não haver executor
nem nova escrita.

## Bloquear recriação antes de deletar

Antes da primeira exclusão:

1. prove por telemetria que nenhum producer/consumer de comandos Kafka existe na versão implantada;
2. remova/desative o provisionamento de tópicos por worker;
3. use ACL para negar `CREATE`/`WRITE` nesses nomes aos principals de aplicação;
4. preferencialmente altere o broker para `auto.create.topics.enable=false` depois de provisionar explicitamente todos os tópicos globais necessários;
5. alerte para qualquer tentativa de metadata/produce de tópico de worker.

Essas mudanças são trabalho de produção futuro; não foram aplicadas em `underchat-argocd` nesta entrega.

## Gerar e aprovar o manifest

O manifest é um arquivo imutável com:

- cluster ID e fingerprints dos brokers;
- timestamp e hash do roster;
- nome exato, tipo, worker, conta, estado do worker;
- partições, bytes, offsets e último timestamp;
- estado/membros/lag do group;
- motivo `worker_command_jetstream_migrated`;
- SHA-256 do documento.

Faça dry-run em snapshot e depois diretamente no cluster. Diferença entre as duas coletas invalida a aprovação. O script existente `scripts/kafka-clean-dead-resources.ts` é seguro para descoberta de workers permanentemente deletados, mas sua execução deliberadamente não autoriza workers ativos migrados. Não contorne essa proteção: uma ferramenta de migração específica deve consumir o manifest assinado e exigir token/cluster/hash exatos.

## Exclusão controlada

Com a barrier administrativa de cleanup ativa e aprovação independente:

1. revalide cluster ID, roster hash e manifest hash;
2. revalide zero produce por 24 horas, group `EMPTY` e membros zero; registre o
   lag apenas como inventário do dado descartado;
3. delete primeiro os groups listados explicitamente;
4. confirme que cada group desapareceu;
5. delete tópicos explicitamente, em lotes de no máximo 50;
6. aguarde pelo menos 30 segundos entre lotes e pare se controller/metadata p99, URP ou erro subir;
7. liste novamente após cada lote e registre sucesso/erro individual;
8. nunca considere `unknown topic` de um nome não aprovado como sucesso coletivo;
9. ao terminar, faça duas listagens completas separadas por cinco minutos.

Pare imediatamente se houver:

- qualquer membro ou novo produce/offset depois da barreira;
- tópico não previsto no manifest;
- under-replicated partition, controller election ou erro de metadata;
- latência de metadata p99 acima de 500 ms por dois minutos;
- aumento de erro nos tópicos globais;
- tentativa de recriação de recurso removido.

Deleção Kafka é irreversível e deliberadamente descarta o backlog antigo. Um
rollback operacional continua exclusivamente no JetStream com epoch novo;
reprovisionar tópico Kafka vazio não é rota de comandos.

## Critério de conclusão

A migração só está concluída quando:

- comandos usam exclusivamente JetStream por 24 horas;
- todos os workers ativos têm epoch correto e consumer saudável;
- não houve dupla execução nem fallback;
- métricas de latência/erro atendem o SLO;
- tópicos e groups per-worker aprovados foram removidos e não reapareceram;
- tópicos Kafka globais seguem saudáveis;
- inventário, manifests, hashes e relatórios de operação foram arquivados;
- a limpeza Redis separada, se aprovada, seguiu [seu próprio runbook](worker-command-ledger-cleanup.md).
