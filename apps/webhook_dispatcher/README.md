# Webhook Dispatcher

Worker responsável por entregar os eventos de webhooks de saída. O serviço usa
semântica **at-least-once**: uma entrega pode ser repetida depois de uma falha ou
expiração de lease, portanto o consumidor externo deve deduplicar sempre pelo
campo `id` do envelope (`X-Underchat-Event-Id`). O ID da entrega e o número da
tentativa servem apenas para auditoria; um reenvio manual cria uma nova entrega
para o mesmo evento.

Cada endpoint é vinculado obrigatoriamente a um único canal. O journal persiste o
escopo imutável do fato em `context.channel_ids` e cria entregas somente para
endpoints ativos cujo canal pertence a esse escopo. Vários endpoints podem usar o
mesmo canal. Em transferências entre canais, origem e destino recebem o mesmo ID de
evento; o consumidor continua responsável por deduplicá-lo.

O catálogo atual possui 36 eventos selecionáveis e o evento de controle
`webhook.test`. A família `message.delivery.*` é exclusiva de mensagens de saída e
inclui `queued`, `sent`, `delivered`, `read` e `failed`. Se um snapshot sanitizado
ultrapassar 1 MiB, o journal preserva o fato em um envelope compacto com
`data.payload_omitted = true` e `omission_reason = payload_too_large`; isso não deve
virar falha de transporte nem afetar a saúde do endpoint.

## Execução

Requer Node.js `24.12.0` e as dependências instaladas na raiz do monorepo.

```bash
pnpm dev:webhook-dispatcher
pnpm --filter webhook_dispatcher build
pnpm --filter webhook_dispatcher lint
pnpm --filter webhook_dispatcher typecheck
```

O processo escuta em `0.0.0.0:3007` por padrão. O container roda como usuário
não privilegiado (`node`) e recebe `SIGTERM` durante o rollout.

## Variáveis de ambiente

O deployment deve receber somente o conjunto mínimo abaixo. Não importe o
bundle global de variáveis da plataforma: além de ampliar desnecessariamente o
impacto de uma eventual exposição do pod, ele inclui credenciais de serviços que
o dispatcher não acessa.

### Conjunto mínimo compartilhado

Use `UNDERCHAT_ENV_SCOPE=private` no deployment interno. Nesse escopo, as
variáveis `DB_PRIVATE_*` e `DB_ELASTIC_PRIVATE_HOST` têm precedência sobre as
chaves legadas sem escopo. Um deployment realmente público deve trocar apenas
essas chaves pelas variantes `DB_PUBLIC_*` correspondentes e declarar
`UNDERCHAT_ENV_SCOPE=public` explicitamente.

| Origem     | Variáveis                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ConfigMap  | `APP_ENVIRONMENT`, `UNDERCHAT_ENV_SCOPE`, `DB_PRIVATE_HOST_RW`, `DB_PRIVATE_PORT_RW`, `DB_DATABASE`, `DB_SSLMODE`                   |
| ConfigMap  | `DB_ELASTIC_PRIVATE_HOST`, `OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP`                                                                  |
| Secret     | `DB_USER`, `DB_PASSWORD`, `DB_ELASTIC_USER`, `DB_ELASTIC_PASSWORD`, `CRYPTO_KEY_START`, `CRYPTO_KEY_END`                            |
| Chart/pod  | `NODE_ENV`, `TZ` e, quando o Elasticsearch usa CA privada, `NODE_EXTRA_CA_CERTS` com o volume da CA montado                         |
| Exclusivas | Todas as variáveis `WEBHOOK_DISPATCHER_*` da tabela seguinte; podem usar os padrões, mas devem ser declaradas no ambiente produtivo |

`CRYPTO_KEY_START` e `CRYPTO_KEY_END` precisam ser exatamente o mesmo par usado
pelos serviços que criptografam os segredos HMAC dos endpoints. Alterar apenas
o dispatcher impede a leitura dos segredos existentes.

O worker usa somente PostgreSQL RW e cria um pool próprio. Ele não usa host RO,
URLs de conexão/Atlas, Redis, Kafka, Centrifugo, JWT, storage, SMTP, push,
pagamentos, Git/Harbor nem credenciais de workers. As variáveis globais
`DB_POOL_MIN`, `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT`,
`DB_POOL_ACQUIRE_TIMEOUT`, `DB_POOL_MAX_LIFETIME`,
`DB_POOL_CONNECTION_TIMEOUT`, `DB_STATEMENT_TIMEOUT` e `DB_QUERY_TIMEOUT`
também **não configuram o dispatcher**. Para pool e timeout, use exclusivamente
as variantes `WEBHOOK_DISPATCHER_DB_*`.

### Configurações exclusivas

Valores inválidos interrompem a inicialização; não existe fallback silencioso
para uma variável explicitamente definida.

| Variável                                        |                            Padrão | Restrição / finalidade                                                    |
| ----------------------------------------------- | --------------------------------: | ------------------------------------------------------------------------- |
| `WEBHOOK_DISPATCHER_PORT`                       |                            `3007` | Porta HTTP, entre 1 e 65535. `PORT` é o fallback secundário.              |
| `WEBHOOK_DISPATCHER_CONCURRENCY`                |                              `16` | Entregas simultâneas por réplica, entre 1 e 100.                          |
| `WEBHOOK_DISPATCHER_LEASE_DURATION_MS`          |                           `60000` | Lease entre 30 s e 10 min; deve superar o timeout HTTP em pelo menos 5 s. |
| `WEBHOOK_DISPATCHER_POLL_INTERVAL_MS`           |                            `1000` | Espera sem backlog, entre 50 ms e 60 s.                                   |
| `WEBHOOK_DISPATCHER_REQUEST_TIMEOUT_MS`         |                           `10000` | Timeout por chamada, entre 100 ms e 10 s.                                 |
| `WEBHOOK_DISPATCHER_DB_POOL_MIN`                |                               `1` | Conexões PostgreSQL ociosas mantidas por réplica.                         |
| `WEBHOOK_DISPATCHER_DB_POOL_MAX`                | concorrência + 4, limitado a `32` | Teto por réplica, entre 2 e 100.                                          |
| `WEBHOOK_DISPATCHER_DB_POOL_IDLE_TIMEOUT_MS`    |                           `30000` | Liberação de conexões ociosas.                                            |
| `WEBHOOK_DISPATCHER_DB_POOL_ACQUIRE_TIMEOUT_MS` |                            `5000` | Tempo máximo para obter conexão do pool.                                  |
| `WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS`        | menor entre `30000` e lease - 5 s | Timeout por query; no cliente e com `SET LOCAL` nas transações.           |
| `OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP`         |                           `false` | Só pode ser `true` em `LOCAL` ou `DEV`; nunca é aceito em HMG/PROD.       |

`APP_ENVIRONMENT` é obrigatório e aceita somente `LOCAL`, `DEV`, `HMG` ou
`PROD`.

`WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS` permanece como alias legado de
`WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS` para rollouts sem interrupção. Se as
duas forem informadas durante a transição, precisam possuir o mesmo valor. Em
configurações novas, declare somente a chave `...DB_QUERY_TIMEOUT_MS`; depois de
um rollout compatível, remova a chave legada em vez de manter ambas.

O pool PostgreSQL é compatível com PgBouncer em **transaction pooling**. GUCs
como `statement_timeout` e timezone não são enviados no startup packet, e o
dispatcher não usa prepared statements nomeados. O timeout do driver protege
queries avulsas; dentro das transações de claim, preflight e finalização o
servidor também recebe `SET LOCAL statement_timeout`, sem compartilhar estado
de sessão. Uma conexão e um `SELECT 1` são validados antes de iniciar os loops,
portanto incompatibilidade de protocolo ou credenciais inválidas falham cedo.

## Probes

| Endpoint            | Uso              | Comportamento                                                                                                                                                                          |
| ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/check` | liveness/startup | `200` enquanto o loop principal está saudável; `503` se o watchdog detectar sua parada.                                                                                                |
| `GET /ready/check`  | readiness        | `200` somente com PostgreSQL acessível e loop de entrega capaz de executar claims. Após 5 falhas consecutivas de claim retorna `503`; a primeira claim bem-sucedida restaura o estado. |

Também existem os aliases `/health` e `/ready`. As respostas possuem
`Cache-Control: no-store` e não incluem informações sensíveis.

## Concorrência e réplicas

A configuração recomendada é de **3 réplicas**. Com concorrência 16, o cluster
processa até 48 chamadas HTTP simultâneas. Cada réplica usa um pool PostgreSQL RW
com mínimo 1 e máximo 20 por padrão, totalizando mínimo 3 e teto 60 conexões. As
quatro conexões extras preservam capacidade para recovery, retenção e probes sob
carga máxima.

As entregas são reclamadas com `FOR UPDATE SKIP LOCKED` e lease, permitindo
escalonamento horizontal sem uma fila duplicada por réplica. O lease deve ser
maior que o timeout HTTP para impedir que outra réplica reclame uma entrega
ainda em andamento. Ao concluir o preflight, o worker renova o lease usando o
relógio do PostgreSQL e uma atualização fenced por status e token. Assim, o
tempo gasto no preflight não reduz a janela reservada ao HTTP e à persistência
do resultado. A transação é encerrada antes de serialização, DNS ou chamada de
rede; se a posse tiver sido perdida, nenhuma requisição é enviada.

O preflight captura status, canal, inscrições, URL, segredo e `config_version`
antes de abrir a conexão. Ele revalida que o canal continua disponível, pertence à
conta e está em `routing_channel_ids`; divergências são suprimidas como
`channel_unavailable` ou `channel_scope_mismatch`. Uma alteração de configuração
não recolhe uma requisição já em voo; ela pode terminar por até 10 segundos com a
versão anterior. O header
`X-Underchat-Webhook-Config-Version` torna essa versão observável, mas não é
coberto pelo HMAC e nunca deve ser tratado como autenticação pelo receptor.

## Tarefas operacionais

- **Retenção:** a cada minuto cada réplica remove eventos expirados em até 10
  lotes de 1.000, com `SKIP LOCKED` e orçamento de 5 s por ciclo. Se o orçamento
  for atingido, o log `Webhook retention cycle reached its work budget` indica
  que ainda pode existir backlog.
- **Recuperação do journal:** roda a cada 30 s. Um advisory lock transacional,
  mantido em uma conexão pinada até `COMMIT`/`ROLLBACK`, garante apenas um
  reconciliador ativo no cluster mesmo com PgBouncer transaction pooling. Chats
  e mensagens comprovam a
  mutação aplicada por markers persistidos no Elasticsearch. Contatos persistem o
  envelope final e `domain_applied_at` no PostgreSQL, na mesma transação da mutação
  de domínio (transactional outbox). Em ambos os fluxos, uma falha tardia de
  fan-out deixa o evento em `preparing` para conclusão assíncrona, sem perder o fato
  já aplicado. Intents antigas sem prova de aplicação são colocadas em quarentena.
- **Watchdog:** verifica o loop de entrega a cada 5 s. Uma parada inesperada
  torna a liveness inválida para que o orquestrador reinicie o pod.

As tarefas periódicas nunca se sobrepõem dentro da mesma réplica. No shutdown,
timers são cancelados e execuções em andamento são aguardadas antes de fechar
PostgreSQL e Elasticsearch.

## Política de entrega

Trocar o canal desativa o endpoint, incrementa `config_version` e exige novo teste
assinado. Entregas antigas não migram para o canal novo e o reenvio manual é
bloqueado quando o escopo congelado do evento não contém o canal atual. Excluir um
canal desativa seus endpoints e suprime pendências; uma chamada HTTP que já passou
pelo preflight mantém a semântica at-least-once.

Uma entrega possui no máximo **7 tentativas**. Falhas de rede, timeout, HTTP `408`,
`425`, `429` e `5xx` usam full jitter com tetos sucessivos de 1 min, 5 min, 30 min,
2 h, 8 h e 24 h; `Retry-After` pode elevar o atraso, limitado a 24 h. Outros `3xx`
e `4xx` são definitivos. HTTP `410` suspende imediatamente o endpoint. Cinco
entregas reais consecutivas em `dead` também suspendem; testes e reenvios manuais
não incrementam esse contador, e uma entrega real bem-sucedida o zera. A resposta
é limitada a 64 KiB e cada chamada a 10 s.

## Encerramento e rollout

No primeiro `SIGTERM`/`SIGINT`, o servidor para de aceitar conexões, interrompe
novos claims e aguarda entregas e tarefas em andamento. O prazo interno é 25 s;
configure `terminationGracePeriodSeconds` acima desse valor (30 s ou mais). Um
segundo sinal força a saída. Exceções não capturadas e promises rejeitadas também
iniciam o drain com código de saída diferente de zero.

## Observabilidade e runbook

Os logs são JSON estruturados. Segredos, assinaturas, cookies e authorization
headers são redigidos. Campos úteis incluem `delivery_id`, `webhook_id`,
`account_id`, `channel_id`, `suppression_reason`, `deleted_count`, `batches`, `duration_ms` e
`outbound_webhook_dispatcher`/`outbound_webhook_recovery`. O resumo do
dispatcher agrega claims, preflights, supressões, retries, outcomes e perdas de
lease sem registrar payloads. `claim_failures` e
`consecutive_claim_failures` distinguem uma query de liveness simples de uma
falha real na query de claim, por exemplo durante incompatibilidade de schema.

Em uma ocorrência:

1. Se `/health/check` retornar 503, procure
   `Outbound webhook dispatcher loop stopped unexpectedly`; o pod deve ser
   reiniciado pelo orquestrador.
2. Se `/ready/check` retornar 503 com `database: failed`, valide conectividade,
   saturação do pool e disponibilidade do PostgreSQL.
3. Se `database: ok` e `dispatcher: failed`, procure
   `Outbound webhook claim cycle failed` e
   `consecutive_claim_failures`. Depois de corrigir schema/query ou a falha
   transitória, uma claim bem-sucedida reabilita a readiness automaticamente.
4. Se houver backlog de retenção, acompanhe `deleted_count` por ciclo antes de
   aumentar réplicas ou reduzir temporariamente o volume retido.
5. Se `outbound_webhook_recovery.failed` crescer, valide os markers de chat e
   mensagem no Elasticsearch e os markers transacionais de contato no PostgreSQL;
   a entrega normal continua independente da recuperação.
6. Para backlog de entregas, acompanhe quantidade/idade de linhas `pending`,
   `retrying` e leases expirados antes de elevar a concorrência. Ajuste também o
   pool PostgreSQL para não trocar backlog HTTP por contenção no banco.

### Rotação após exposição de ambiente

Considere qualquer valor não mascarado em dump, log, ticket, anexo ou histórico
como comprometido, mesmo que o arquivo tenha sido removido depois:

1. Restrinja o acesso ao artefato, preserve apenas os metadados necessários para
   auditoria e abra um incidente sem copiar valores sensíveis para novos canais.
2. Revogue e recrie primeiro as credenciais que permitem acesso aos dados
   (`DB_*` e `DB_ELASTIC_*`). Atualize o cofre/Secret e reinicie os consumidores
   de forma controlada; não mantenha a credencial anterior durante uma janela
   indefinida.
3. Rotacione também todos os segredos do bundle exposto, mesmo os que o
   dispatcher não usa, diretamente no provedor de origem. Remover uma variável
   do pod não revoga token, senha, chave de storage ou service account.
4. Não altere `CRYPTO_KEY_START`/`CRYPTO_KEY_END` isoladamente. O par protege
   ciphertext compartilhado pela plataforma e não possui fallback automático
   para a chave antiga. Faça uma migração coordenada, com backup, recriptografia
   dos dados e rollout de todos os produtores/consumidores para o novo par.
5. Como o acesso simultâneo ao banco e ao par criptográfico permite recuperar
   segredos HMAC armazenados, rotacione os segredos dos endpoints de webhook e
   comunique os respectivos consumidores externos.
6. Remova o bundle global do app, injete apenas a allowlist desta seção e
   confirme que ConfigMaps, manifests, histórico do Git e logs não contêm os
   valores antigos.
7. Depois do rollout, valide `/health/check` e `/ready/check`, execute um
   `webhook.test`, confira a assinatura no receptor e monitore falhas de claim,
   retries e autenticação. Só então encerre o incidente.

Não registre payloads, tokens ou segredos durante troubleshooting. As chamadas
externas mantêm validação de URL/DNS contra SSRF, timeout, limite de resposta e
assinatura HMAC implementados na camada compartilhada de webhooks.
