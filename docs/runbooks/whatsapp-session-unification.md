# Sessões WhatsApp unificadas

## Regras operacionais

- `session_id` é sempre o `worker_id`; JID, LID, telefone e provider não são
  identificadores de ownership.
- Troca de provider é aceita somente entre Baileys, WWebJS e WhatsMeow quando
  `worker.session_storage = 'postgres'`.
- Canal em `legacy_volume` nunca pode trocar de provider. Migre a sessão para
  PostgreSQL por um fluxo separado ou faça novo pareamento; não reutilize o
  volume como snapshot de handoff.
- Uma revisão candidata não substitui a ativa antes de validação e promoção.
  Falha ou perda da lease deve executar rollback e a compensação durável do
  manager para restaurar provider, container e fence de origem.
- No backend PostgreSQL, WWebJS acompanha a versão Web live/latest entregue
  pela própria biblioteca: o Underchat não informa `webVersion`, configura
  `webVersionCache: { type: 'none' }` e não declara integridade pinada. Antes
  de vincular `Debug.VERSION` ao store, a biblioteca deve aprovar o preflight
  do ABI privado e do codec canônico; incompatibilidade aborta a candidata,
  sem hidratar credenciais e sem QR durante handoff. Somente
  `legacy_volume` conserva `SupportedWebVersion`/cache empacotado da versão
  instalada para manter o comportamento legado.

## Acompanhar logs de implementação

O debug fica ativo em desenvolvimento/canário com
`WHATSAPP_SESSION_DEBUG_ENABLED=true`. Para acompanhar manager e todos os
workers Docker em uma única saída filtrada:

```bash
./scripts/follow-whatsapp-session-debug.sh
```

Por padrão o script mostra os últimos cinco minutos e continua seguindo. Para
alterar a janela ou incluir um manager com outro nome:

```bash
WHATSAPP_SESSION_LOG_SINCE=30m \
WHATSAPP_SESSION_LOG_CONTAINERS=under-manager-blue \
./scripts/follow-whatsapp-session-debug.sh
```

Cada linha recebe o nome do container e mantém o prefixo
`[whatsapp-session-debug]`. Os eventos não devem conter QR, chaves, cookies,
tokens, payloads, profiles ou URLs de banco; JIDs são hashados.

## Canário de handoff somente pela API

O canário prioriza `HANDOFF_CANARY_TOKEN` e não executa login quando a variável
está definida. Para obter um token separado sem invalidar a sessão web ativa,
abra uma sessão `mobile` pela API. Os comandos abaixo mantêm senha e token fora
da saída e do histórico do shell:

```bash
read -r -p 'Login do canário: ' HANDOFF_CANARY_LOGIN
read -r -s -p 'Senha do canário: ' HANDOFF_CANARY_PASSWORD
printf '\n'
export HANDOFF_CANARY_LOGIN HANDOFF_CANARY_PASSWORD

HANDOFF_CANARY_TOKEN="$(
  node -e 'process.stdout.write(JSON.stringify({login: process.env.HANDOFF_CANARY_LOGIN, password: process.env.HANDOFF_CANARY_PASSWORD}))' |
    curl --silent --show-error \
      --header 'Content-Type: application/json' \
      --header 'Accept-Language: pt' \
      --header 'X-Client-Platform: mobile' \
      --data-binary @- \
      "${E2E_API_URL:-http://localhost:3002/v1}/auth/login" |
    jq -er '.data.token'
)"
unset HANDOFF_CANARY_LOGIN HANDOFF_CANARY_PASSWORD
export HANDOFF_CANARY_TOKEN
```

O login `mobile` substitui somente outra sessão mobile do mesmo usuário. O
token continua válido enquanto não expirar e enquanto essa sessão permanecer
ativa no Redis. O preflight exige `HANDOFF_CANARY_TOKEN`, realiza somente GETs
na API e não abre uma nova sessão. Primeiro execute-o; ele não altera o canal:

```bash
node scripts/whatsapp-provider-handoff-live-canary.mjs \
  --worker-id=<uuid> \
  --dry-run
```

Depois do preflight e da janela de mudança, execute a matriz completa das seis
direções. O canário detecta a opção inicial, gira a sequência para começar
nela e termina no mesmo provider; por isso o mesmo comando pode validar canais
Baileys, WWebJS e WhatsMeow sem alterar seu estado final:

```bash
node scripts/whatsapp-provider-handoff-live-canary.mjs \
  --worker-id=<uuid> \
  --confirm-live
```

Antes de cada PATCH, o canário confirma uma assinatura Centrifugo no canal da
conta e captura o cursor corrente do outbox pelo GET sanitizado do manager. Um
QR, pairing code, passkey ou tentativa de novo login observada no realtime ou
na janela durável faz a etapa falhar, sem registrar a credencial. A prova do
outbox é limitada a 10.000 eventos e uma janela truncada nunca é aprovada.

Se uma etapa falhar, o erro original permanece como resultado do canário. A
compensação aguarda o rollback cercado e, quando a API comprova que a revisão
de origem foi preservada, pode solicitar apenas a ação não destrutiva
`return`. Depois restaura o provider inicial por um novo handoff igualmente
monitorado. Ela nunca escolhe `discard`, nunca solicita QR e registra seu
resultado separadamente no relatório.

Não grave o token em arquivo versionado, não use `set -x` e remova-o do shell
ao terminar com `unset HANDOFF_CANARY_TOKEN`.

## Gates de compatibilidade

- As seis direções entre Baileys, WhatsMeow e WWebJS usam revisão candidata,
  fingerprint v2 e validação da mesma identidade, mas cada direção permanece
  condicionada ao seu gate criptográfico. Nenhuma direção pode ser liberada
  apenas porque existe um profile ou um provider record.
- Baileys e WhatsMeow devem rejeitar uma projeção cuja chain Signal não possa
  ser convertida sem perda. O rollback da origem é obrigatório nesses casos.
- A origem e a `previous_revision` nunca são podadas. Um destino WWebJS pode
  reconstruir scopes ausentes pela API oficial antes de promover. Isso não
  torna seguro descartar PQXDH de uma origem WWebJS: a dependência libsignal
  atual do WhatsMeow não possui wire/key store ML-KEM e pode haver prekeys já
  publicadas ou mensagens em voo. WWebJS→WhatsMeow só passa depois que a bridge
  fecha e drena os sinks finais de upload PQ, recebe e valida o ACK do delete
  no servidor e persiste um marker vinculado à lease e ao handoff. O checkpoint
  autenticado precisa então provar `migrated=false`, contagens de prekey e
  last-resort iguais a zero e nenhuma sessão `scope='pq'`; o fence continua
  ativo até o Chromium terminar. Os feature flags live de upload/messaging
  podem continuar habilitados pelo rollout do WhatsApp e são apenas vinculados
  ao marker, nunca usados como prova de ausência de estado. Metadado ausente,
  proof legado sem fence ou qualquer estado PQ ativo falha antes de fechar o
  Chromium e também é rejeitado novamente pelo importador Go.
- Uma troca envolvendo WWebJS exige o ABI
  `wwebjs-canonical-session-v1`, codec version `1`, projeção `complete=true`,
  fingerprint `underchat-whatsapp-device-fingerprint-v2` e capabilities
  completas de export, checkpoint, consumo e importação. A ausência de
  qualquer item mantém a troca bloqueada antes do Chromium.
- `whatsapp_device.jid` preserva o WID completo do companion, inclusive o
  componente `:device`. O JID de usuário sem esse componente serve apenas para
  comparar se duas identidades pertencem à mesma conta; nunca pode substituir
  o WID do device na exportação ou hidratação. O WWebJS valida Noise, WID do
  device, registro Signal e identidade assinada antes e depois do único reload.
- O WhatsApp Web limpa o ADV secret ao concluir a primeira conexão registrada,
  portanto `adv_secret_available=false` é válido para uma sessão estabelecida
  e não bloqueia login ou handoff. Em pareamentos novos a bridge captura o
  segredo enquanto ele existe e só o persiste depois de READY/checkpoint. Um
  ADV criado por candidata `UNPAIRED`/QR nunca é incorporado à revisão.
- O probe da versão Web usada no canário deve registrar os scopes Signal
  encontrados. O schema preserva `default`, `status` e `pq`, mesmo quando a
  sessão observada usa apenas `default`.

## Migração e limpeza

A migração destrutiva de desenvolvimento base é
`atlas/prod/20260802144500.sql`; ela é histórica e não deve ser reescrita. A
revisão canônica v17 e as correções posteriores ficam na incremental
`atlas/prod/20260803120000.sql`. Os nomes seguem o padrão Atlas do projeto:
somente timestamp, sem sufixo descritivo. Toda nova mudança deve usar outro
timestamp e atualizar `atlas/prod/atlas.sum`.

O LID map do schema legado era global e não possui ownership recuperável. A
passagem v17 apaga esse cache derivável e cada sessão o reconstrói por sync;
copiá-lo para todos os canais violaria o isolamento. A mesma incremental
mantém uma linha permanente de lease por sessão e amostra
`clock_timestamp()` somente depois de obter o lock exclusivo da lease, para
que waits não renovem writers já expirados nem produzam TTL no passado.

Depois do rollout, confira que não existem o endpoint/porta 6433, variáveis de
lock de sessão ou a role `underchat_whatsmeow_lock`. Sessões usam somente a
lease com fencing do schema comum, sem `LockDB`, usuário, conexão, serviço,
HAProxy ou porta dedicada. `pg_advisory_xact_lock` transacional continua
permitido para a serialização curta da instalação/migração do schema WhatsApp,
usando a própria conexão e role normal da migração, e para operações de outros
domínios. A proibição cobre locks longos de ownership de sessão e qualquer
usuário, pool, proxy, serviço ou porta exclusiva para lock; o lock transacional
curto não pode ser promovido a um lock de sessão persistente.

Para validar isolamento, RLS, lease e fencing em um PostgreSQL descartável,
configure duas URLs para o mesmo banco de teste (admin e role runtime) e rode:

```bash
WHATSAPP_SESSION_TEST_ADMIN_DATABASE_URL=postgres://... \
WHATSAPP_SESSION_TEST_RUNTIME_DATABASE_URL=postgres://... \
pnpm test:whatsapp-session:postgres
```

O verificador recusa bancos cujo nome não contenha `codex` ou `test`. Além da
matriz de isolamento, ele cria e desfaz por rollback um fixture de 1.000
sessões em cardinalidade p95×2 e exige planos indexados com
`EXPLAIN (ANALYZE, BUFFERS, WAL)`, sem `Seq Scan` global nas tabelas
protocolares.
