# Memória da rodada de recriação e continuidade do canário WhatsApp — 2026-08-08

## Finalidade deste documento

Este arquivo é o ponto de retomada para uma nova conversa. Ele registra o
contexto técnico, a execução concorrente das recriações, as evidências, as
causas encontradas, as correções feitas e a ordem obrigatória da próxima rodada
de handoff entre providers.

Horários sem indicação explícita estão em UTC. Em 2026-08-08, o horário de
Brasília é UTC-3.

## Atualização autoritativa mais recente — `Recriar` WWebJS preso e importação seletiva — 2026-08-14

O worker real `019ffb52-7e9e-71cc-a611-a1e1725ae68c` ficou visualmente preso em
`recreating/connecting`, geração `11`, lifecycle
`01a0007e-6b45-731d-bc1a-a87aedd0e9a0`. O container estava healthy, a revisão
ativa `3096` e o perfil PostgreSQL permaneciam íntegros. O runtime tinha sessão,
não publicou QR e recusou corretamente uma tentativa sem o conjunto completo de
provas de segurança. Ele se recuperou sozinho depois de aproximadamente oito
minutos e terminou `online`, autenticado, sessão válida, ACK central e ingress
JetStream pronto/autorizado; portanto, não apagar nem recriar a sessão para
resolver esse sintoma.

A causa exata foi uma janela após a recuperação única de stall nativo. O modelo
já informava `Socket=CONNECTED`, mas o stream privado ainda apresentava uma
amostra `DISCONNECTED`. A barreira de restore tratava essa primeira amostra como
erro terminal, reiniciava o client e caía no retry normal de 60 segundos. A
versão `1.34.112` mantém todas as provas fail-closed e o limite de uma única
recuperação, mas permite até cinco segundos, dentro do deadline global, para o
stream reconciliar. Uma transição breve prossegue somente depois de obter nova
amostra conectada e a prova idle completa; uma desconexão persistente continua
falhando em `wwebjs_canonical_app_state_restore_barrier_not_connected`.

Na mesma investigação, o canário Baileys → WWebJS mostrou que dispositivo,
identity keys, `2.523` prekeys clássicas, PQ e app-state eram byte a byte
equivalentes ao perfil WWebJS reutilizável; somente `signal_sessions` e
`sender_keys` divergiam legitimamente. O importador anterior era tudo-ou-nada e
gastou cerca de `42,7 s` derivando novamente as mesmas prekeys antes de substituir
todas as tabelas Signal. A correção agora calcula equivalência por componente
sob o perfil offline e a autoridade de app-state:

- `device` e autoridade de app-state precisam corresponder; se não, nenhuma
  preservação seletiva é aceita;
- `identity_keys`, `pre_keys`, PQ (`pq_pre_keys` + estado atômico),
  `signal_sessions` e `sender_keys` são decididos independentemente;
- base/meta/signed prekey e o tuple crítico continuam sempre resealed e lidos de
  volta;
- prekeys idênticas são decodificadas e têm limites validados, mas não passam
  novamente pela curva nem são reescritas;
- componentes divergentes são limpos e importados normalmente; no caso real,
  somente sessions e sender keys;
- plano desconhecido, parcial na forma, sem autoridade ou com device divergente
  falha antes da primeira escrita;
- a telemetria terminal registra apenas listas de componentes em
  `selective_component_replace`, nunca bytes, JIDs ou hashes de chaves.

Essa seleção é neutra à origem. Não há branch Baileys versus WhatsMeow: ambos
passam pelo mesmo checksum semântico e pelo mesmo contrato. Assim, corrigir uma
origem não pode fazer a outra reutilizar material não equivalente.

Proveniência e gates antes do rollout:

- fork: correção `f3ef65a3`, release `1dedcccc`, tag `v1.34.112`;
- pacote `@wwebjs/whatsapp-web.js@1.34.112`, shasum
  `15ac923b1090bad96ed75ddbc7e29745625af0ac`, integridade
  `sha512-2mBbVvkJiX+OzzSfWAygN8FQnfufe6M1hX0HD/R5wzGo6cvAl5xpM1L9uMbNfN3yezf9I3g/4PPwYqhpoLuD4A==`;
- fork: `462` testes relevantes aprovados e uma pendência declarada, ESLint,
  Prettier, web-cache e auditoria dos `158` arquivos do pacote aprovados;
- Underchat: contrato real da dependência `13/13`, ESLint/Prettier focados e
  build TypeScript do worker WWebJS aprovados;
- o `npm test` indiscriminado do upstream exige
  `WWEBJS_TEST_REMOTE_ID` para testes externos; não registrar isso como falha da
  alteração nem inventar credencial. As suítes unitárias/contratuais locais
  completas de `session` e `authStrategies` são os `462` testes acima.

### Rollout e três recriações reais com `1.34.112`

O build WWebJS `v20260814141041273`, job
`01a0009c-57f9-714e-8086-0e9f43fcdb19`, terminou com sucesso e publicou
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814141041273`.
No Server 1, a imagem materializada foi conferida pelo content ID
`sha256:e0d9dac68ca2be079b10dc2b30377e656cb4a4842f5aa0a5f2eae61eea1ce62c`
e pelo pacote `@wwebjs/whatsapp-web.js@1.34.112`. Pela interface visual de
**Canais aquecidos**, filtrada exclusivamente por `Opção 2 (Navegador)`, os
quatro pools WWebJS foram recriados: dois no Server 1 e dois no Server 2, todos
em `Pronto`. Nenhum pool Baileys ou WhatsMeow foi recriado nessa ação.

Depois do rollout, o mesmo worker originalmente preso foi recriado três vezes
pela interface real, sem remover a sessão:

| Execução |   Geração | Revisão | Resultado  | Tempo aproximado | Observação                                                            |
| -------: | --------: | ------: | ---------- | ---------------: | --------------------------------------------------------------------- |
|        1 | `11 → 12` |  `3096` | online/ACK |           `94 s` | um `TargetCloseError` transitório; retry imediato protegido concluiu  |
|        2 | `12 → 13` |  `3096` | online/ACK |          `110 s` | um client, sem retry; espera final do ingress JetStream               |
|        3 | `13 → 14` |  `3096` | online/ACK |          `190 s` | dois `TargetCloseError`; redelivery adotou o runtime frio e finalizou |

Nas três execuções, a revisão `3096`, o fingerprint
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`
e a sessão canônica permaneceram inalterados. O estado terminal comprovado foi
`online`, `connected/authenticated/sessionValid=true`, QR ausente, ACK central,
ingress JetStream pronto/autorizado e zero handoff, recovery ou resolution
ativo. Assim, o estado indefinido `recreating/connecting` da geração `11` não
se tornou permanente, mas a terceira execução reproduziu a corrida que ainda
alongava o caminho de recuperação.

Na primeira execução, a primeira inicialização chegou a promover o transporte,
mas o Chromium fechou durante `Page.addScriptToEvaluateOnNewDocument`. Como o
runtime estava dentro da restauração ativa e a sessão continuava protegida, o
worker iniciou o segundo client sem herdar o retry operacional de 60 s e
concluiu.

Na segunda execução, o provider ficou nativamente `online` às
`2026-08-14T14:34:03.851Z`, mas o consumer de comandos ainda tinha
`expected=1, active=0, missing=1`. O gate publicou apenas `connecting` e não
aceitou uso parcial. Às `14:34:34.682Z`, o único consumer JetStream ficou
registrado, atribuído e autorizado; às `14:34:35.339Z`, o serviço publicou o
estado terminal. Esse intervalo de aproximadamente 30 s não foi nova
autenticação nem falha de sessão: foi readiness do transporte de comandos.
Não remover `kafka_consumers_ready/authorized` do predicado de sucesso para
ganhar velocidade aparente. Medir as próximas recriações para distinguir custo
recorrente de cold start JetStream de um outlier antes de alterar a
orquestração.

O aviso `worker_runtime_status_rejected:invalid` observado às `14:34:04Z`
correspondeu à tentativa intermediária do provider de persistir `connecting`
enquanto o lifecycle ainda era dono de `recreating`; ele não descartou sessão,
não mudou revisão e não impediu a reconciliação autoritativa do serviço. O
estado terminal exato foi persistido depois que os gates ficaram verdadeiros.

### Corrida assíncrona confirmada na terceira recriação e correção `1.34.113`

A terceira execução confirmou que o `TargetCloseError` não era ruído do
Chromium. O `Client.inject()` expunha o callback assíncrono de
`AppStateHasSynced` e, na avaliação final da página, o chamava sem aguardar
quando `Socket.hasSynced` já estava verdadeiro. Assim, `inject()` e
`initialize()` podiam resolver enquanto esse callback ainda autenticava,
instalava listeners, materializava o checkpoint durável, promovia o perfil e
produzia a prova `online`. O serviço então podia aposentar ou reconfigurar o
browser que aparentava estar inicializado, interrompendo
`Page.addScriptToEvaluateOnNewDocument` com `Target closed`.

Na execução `13 → 14`, isso aconteceu em dois clients consecutivos, às
`14:42:41.074Z` e `14:43:19.936Z`. A redelivery do comando adotou o runtime frio
às `14:44:05Z` e o lifecycle terminou às `14:45:05.979Z`, após aproximadamente
`190 s` desde o recebimento inicial. Revisão, fingerprint e sessão continuaram
protegidos, mas o atraso confirmou que o contrato de inicialização precisava
ser serializado.

O fork `1.34.113` agora separa o handler Node de `AppStateHasSynced` do binding
exposto ao browser. A avaliação final apenas devolve a observação inicial e o
Node aguarda diretamente o handler quando o perfil restaurado já está synced.
Transições futuras continuam event-driven. Essa serialização é limitada ao
caminho inicial já sincronizado e não relaxa deadline, equivalência
criptográfica, checkpoint, ACK, readiness JetStream, QR ou qualquer barreira
fail-closed.

Um teste comportamental bloqueia deliberadamente `afterAuthReady`, prova que
`inject()` permanece pendente enquanto a restauração não terminou e só então
libera e verifica o estado ready. Os gates do fork terminaram com `463` testes
relevantes aprovados, uma pendência declarada, ESLint, Prettier, web-cache e
auditoria dos `158` arquivos do pacote aprovados. O build TypeScript do worker e
o contrato real da dependência Underchat `13/13` também passaram.

Proveniência da correção:

- fork: correção `2c2fa510`, release `46ed4ca1`, tag `v1.34.113`;
- pacote `@wwebjs/whatsapp-web.js@1.34.113`, shasum
  `923dedd7900638e24788fe497b7a7d5beb535584`, integridade
  `sha512-d69fftZyPcDA0AVATj/qWFcTwzJxlqdNmucvy/vxaa417OWsJK0kSZwaauL3skgOBSIS+rpACGsdR/fV8Bs0MQ==`;
- não contabilizar as três recriações acima na campanha oficial de cinquenta
  sucessos: elas são diagnóstico da versão anterior.

### Rollout `1.34.113` e primeiras provas reais

O commit Underchat `ec980a245` integrou a dependência e foi enviado à `main`. O
build seletivo WWebJS `v20260814145859390`, job
`01a000c8-90be-77a6-9aac-7008684dbfa1`, terminou com sucesso em `5 min 33 s` e
publicou
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814145859390`,
content ID
`sha256:b52d2aad2acfcfb7514111b287efb3cf96db3eed2b988e8cb292e3bfe0bbb338`.

A primeira tentativa de recriar os quatro pools expôs contenção operacional:
os dois servidores iniciavam pulls efêmeros concorrentes, que falhavam em
`worker_image_pull_failed`, e o reconciliador criava novas tentativas a cada
aproximadamente 35 segundos. Isso não afetou sessão ou runtime ativo. Os pulls
do novo tag foram cancelados de forma seletiva e a imagem foi pré-carregada uma
vez por servidor, em série. Depois disso, o mesmo reconciliador criou dois
pools `ready` no Server 1 e dois no Server 2. Os quatro containers foram
inspecionados: todos usam exatamente o content ID acima e o pacote interno
`@wwebjs/whatsapp-web.js@1.34.113`. Nenhum pool Socket foi recriado.

O canal originalmente preso foi então recriado três vezes pela interface
visual real:

| Execução |   Geração | Revisão | Resultado  | Tempo até nativo online | Clients | Falha/retry                                      |
| -------: | --------: | ------: | ---------- | ----------------------: | ------: | ------------------------------------------------ |
|        1 | `14 → 15` |  `3096` | online/ACK |                 `~61 s` |       1 | nenhum                                           |
|        2 | `15 → 16` |  `3096` | online/ACK |               `~60,5 s` |       1 | nenhum                                           |
|        3 | `16 → 17` |  `3096` | online/ACK |              `~117,4 s` |       2 | `wwebjs_companion_identity_web_version_mismatch` |

As três execuções terminaram com
`connected/authenticated/sessionValid=true`, QR ausente, ACK central, sessão
`ready`, zero handoff/recovery/resolution ativo, revisão `3096` e fingerprint
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`
inalterados. Nenhuma das três contém `TargetCloseError` ou `Target closed`; as
duas primeiras também não contêm `initialization_failed` ou
`client.failure_primary` e construíram apenas o client `attempt=1`. A terceira
preservou a sessão, recuperou automaticamente e terminou online, mas não deve
ser classificada como canário de performance porque precisou do `attempt=2`.

Na segunda prova, houve cerca de `18,5 s` entre o clique e a construção do
client, referentes a alocação e ativação do runtime, e `42 s` entre
`client_constructing` (`15:18:10.131Z`) e a prova nativa online
(`15:18:52.135Z`). Isso é o caminho protegido normal de restore, sem retry
artificial de 60 segundos. A mensagem histórica ainda diz `Kafka provider
ready`, mas o gate efetivo e a arquitetura atual são JetStream; não interpretar
esse texto legado como uso de Kafka.

### Rebind seguro da revisão live após recuperação nativa — `1.34.114`

A terceira prova isolou um segundo atraso, independente da corrida assíncrona
eliminada na `1.34.113`. O primeiro client foi construído às
`15:20:51.296Z`, fez toda a importação e chegou ao transporte autenticado, mas
uma recuperação única de stall substituiu controladamente o realm às
`15:21:48Z`. O endpoint live do WhatsApp serviu revisões adjacentes durante a
mesma inicialização:

- ABI inicial: `2.3000.1045209719`;
- reload canônico: `2.3000.1045213319`;
- realm recuperado: `2.3000.1045209719`.

O bridge revalidou a ABI privada, a identidade, o fingerprint, a guarda de
credenciais, o watchdog de pareamento e o novo document epoch, mas o gate final
comparava a identidade do documento atual com a revisão live que havia sido
gravada antes da recuperação. A diferença legítima produziu o falso negativo
`wwebjs_companion_identity_web_version_mismatch` às `15:21:53.127Z`; o retry
seguro conectou às `15:22:39.675Z`, explicando os aproximadamente `117,4 s`.

A `1.34.114` mantém dois contratos separados:

- store com integridade/versionamento explicitamente fixado continua
  fail-closed e nunca faz rebind;
- store live/latest não fixado aceita a revisão somente da identidade
  confiável extraída do mesmo documento, depois de validar a ABI privada e o
  fingerprint; chama o `bindRuntimeWebVersion` nativo, verifica o readback e
  registra `runtime.identity_web_version_rebound` sem dados secretos.

Não existe exceção por origem nem branch Baileys/WhatsMeow. A mudança atua
somente na revisão live do WWebJS após navegação controlada; equivalência
criptográfica, app-state, Signal/PQ, sessão, QR, checkpoint, ACK e todos os
gates de promoção permanecem inalterados. Dois testes novos provam o rebind
live e a recusa pinned. Um teste antigo de duração foi tornado determinístico:
a janela real precisa ser inteira, não negativa e menor que o timeout, em vez
de exigir exatamente `0 ms`.

Gates e proveniência:

- fork: correção `d67342eb`, release `e9057c80`, tag `v1.34.114`;
- pacote `@wwebjs/whatsapp-web.js@1.34.114`, shasum
  `11e6a3e1320409487a69f035efe04865c340480e`, integridade
  `sha512-UaL914FR58A9Q3qAHhEDrFGXnAipfXO11IUjdpCVmKSqNWuvOj6BSMS2MmKqYVwhCs714a6oEs/rMvDD8CrGTA==`;
- fork: `465` testes relevantes aprovados, uma pendência declarada, zero
  falhas; ESLint, Prettier, web-cache e os `158` arquivos do pacote aprovados;
- Underchat local: dependência física `1.34.114`, contrato `13/13` e build
  TypeScript seletivo `worker_wwebjs` aprovados.

Estado desta entrada: a sessão que originou a investigação está online e
íntegra; a `1.34.114` ainda precisa de rollout e novas recriações reais antes de
retomar os canários de migração e a campanha oficial de cinquenta sucessos.

### Rollout `1.34.114`, corrida residual do alvo CDP e correção `1.34.115`

O estado acima foi superado ainda em 2026-08-14. O build seletivo WWebJS
`v20260814153446605`, job `01a000e9-544d-704d-8772-6d01dee73377`, publicou a
imagem com content ID
`sha256:d1dfdb94e8f5f08b56e72d4042f6828537bdd3e2f4ef12ca2ab34f9369c94997`.
Depois do pré-pull serial nos dois servidores, a interface visual de **Canais
aquecidos**, filtrada somente por `Opção 2 (Navegador)`, substituiu os quatro
pools WWebJS. Todos ficaram `Pronto`, dois no Server 1 e dois no Server 2, com o
digest exato acima e o pacote físico `1.34.114`. Os pools Socket não foram
alterados.

O canal `019ffb52-7e9e-71cc-a611-a1e1725ae68c` foi recriado três vezes nessa
imagem:

| Execução |   Geração | Revisão | Resultado  | Tempo aproximado | Clients | Observação                                                        |
| -------: | --------: | ------: | ---------- | ---------------: | ------: | ----------------------------------------------------------------- |
|        1 | `17 → 18` |  `3096` | online/ACK |        `57,96 s` |       1 | sem erro/retry                                                    |
|        2 | `18 → 19` |  `3096` | online/ACK |        `64,28 s` |       1 | sem erro/retry                                                    |
|        3 | `19 → 20` |  `3096` | online/ACK |        `95,43 s` |       2 | `TargetCloseError` após o primeiro reconnect; retry seguro passou |

As três preservaram o fingerprint
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`,
revisão ativa, sessão `ready`, QR ausente e zero handoff, recovery ou resolution
ativo no final. A terceira não conta como sucesso de estabilidade: o primeiro
client chegou a `Socket=CONNECTED`, stream privado `CONNECTED`,
`hasSynced=true`, identidade e registro canônicos aprovados às
`15:56:56.831Z`; `beforeClientInjected()` terminou às `15:56:57.114Z`; apenas
`666 ms` depois, às `15:56:57.780Z`, a inicialização falhou em
`Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed`. O
segundo client conectou e completou a recriação.

A investigação descartou pressão de recursos: o container tinha limite de
`3 GiB`, utilizava aproximadamente `1,048 GiB`, tinha `148` PIDs de um limite
de `512`, `restart_count=0`, `OOMKilled=false` e todos os contadores
`memory.events` (`max`, `oom`, `oom_kill` e `oom_group_kill`) iguais a zero. O
erro também não ocorreu durante import, app-state, Signal/PQ, promoção ou
prova online. Ele era uma segunda corrida, diferente da resolvida na
`1.34.113`: depois do reconnect canônico, `Client.inject()` e
`attachEventListeners()` ainda registravam bindings Puppeteer. Cada
`page.exposeFunction()` chama internamente
`Page.addScriptToEvaluateOnNewDocument`; portanto, um alvo que acabara de
atravessar reload/reconnect podia fechar ou se desprender exatamente nessa
mutação tardia.

A `1.34.115` elimina essa fronteira, sem retry cego e sem aceitar alvo
incompleto:

- os 26 bindings conhecidos do `Client` são criados uma única vez no alvo
  `about:blank`, depois do bridge de autenticação e antes da primeira navegação;
- cada binding possui um roteador local estável; `inject()` e reinjeções apenas
  substituem o handler em memória, sem uma nova chamada CDP de
  `Page.addScriptToEvaluateOnNewDocument`;
- bindings externos/desconhecidos não são apropriados nem substituídos; a
  antiga verificação estrita de duplicidade continua sendo o fallback;
- callbacks não são antecipados: os listeners WA, QR, autenticação, checkpoint
  e READY continuam instalados nos mesmos estágios, depois que seus handlers
  atuais foram roteados;
- a telemetria não secreta `client.page_bindings_prepared` comprova a preparação
  `pre_navigation`, e `client.runtime_unavailable` registra motivo, epoch e
  booleans de browser/página sem poder interromper a invalidação de segurança;
- um teste determinístico faz qualquer `exposeFunction` posterior a `goto`
  lançar o mesmo `Target closed` observado em produção e prova que o lifecycle
  correto não executa mutação tardia; testes do roteador provam atualização de
  handler sem novo CDP e recusa de binding externo.

Proveniência e gates da `1.34.115`:

- fork: correção `192a0c79`, release `e124ee42`, tag `v1.34.115`;
- pacote `@wwebjs/whatsapp-web.js@1.34.115`, shasum
  `ecfb6ceecb9e69f07112491a65418036a9751e50`, integridade
  `sha512-ot33JmDmXqebXRustGUekbKxaMvMpoXdoP97/Q2UPRHnrUWHsrZPwzGZcBaO4Egseb59W2O2umaeP1mLfVYP6Q==`;
- fork: `500` testes relevantes aprovados, uma pendência declarada, zero
  falhas; ESLint, Prettier, web-cache e auditoria dos `158` arquivos do pacote
  aprovados;
- Underchat: commit `54b285d40`, dependência física `1.34.115`, contrato real
  `13/13` e build TypeScript seletivo `worker_wwebjs` aprovados;
- rollout visual seletivo iniciado no build `v20260814161627437`, job
  `01a0010f-7d2d-7318-bb91-8e8c88911592`. Registrar digest, pools e recriações
  abaixo somente depois de provas reais; não classificar a correção como
  concluída apenas pelos testes locais.

### Recriação presa com transporte sincronizado e correção `1.34.116`

A repetição real seguinte, geração `21 → 22`, operação
`01a0011e-3568-74df-abb5-717baee568d4`, revelou uma segunda corrida independente
do `TargetCloseError`. O primeiro client chegou a `Socket.state=CONNECTED`,
`Socket.stream=CONNECTED` e `hasSynced=true` às `16:33:27Z`, com documento,
registro, identidade, guard, proteção destrutiva e watchdog de pairing válidos.
Mesmo assim, a projeção privada `WAComms` permaneceu por mais de 90 segundos em
`comms_initialized=false`, `socket_connected=false` e
`inbound_rx_bucket=unavailable`. Como o gate corretamente não aceita apenas o
estado Backbone do socket, a tentativa expirou em
`wwebjs_canonical_connected_timeout`; o retry protegido começou imediatamente e
concluiu. O canal ficou online/ACK às `16:36:46.582Z`, mas a recriação levou
aproximadamente `254,5 s`, reproduzindo a percepção de processo preso.

A causa não era rede, perda de sessão nem erro no roteador dos bindings. Era uma
projeção nativa internamente contraditória: o stream já dizia `CONNECTED`, mas o
`WAComms` não reconhecia o transporte e não apresentava recepção. A recuperação
existente detectava apenas a variante em que `Socket.stream` permanecia
`DISCONNECTED`; por isso aguardava o deadline completo nesta variante.

A `1.34.116` amplia a detecção sem enfraquecer a admissão online:

- a assinatura nova exige simultaneamente documento atual, navegador online,
  socket e backend `CONNECTED`, stream `CONNECTED`, `hasSynced=true`,
  `WAComms` não inicializado, socket privado desconectado, inbound indisponível,
  listener oficial de reconnect presente e todos os latches de segurança
  válidos;
- a contradição precisa permanecer estável por `15 s`; ela nunca é promovida
  como sucesso;
- após os `15 s`, ocorre no máximo uma substituição protegida do realm, com
  reload, revalidação de ABI/transporte/identidade, renovação do guard,
  acknowledgement da proteção e rearme do watchdog;
- se a assinatura reaparecer depois da recuperação única, o fluxo falha fechado
  com `wwebjs_canonical_connected_native_stall_recovery_exhausted`;
- a telemetria diferencia `connected_stream_without_comms` de
  `disconnected_stream_without_comms`, evitando confundir este incidente com
  lentidão genérica.

Proveniência e gates locais:

- fork: correção `24da6279`, release `6a6086f8`, tag `v1.34.116`;
- pacote `@wwebjs/whatsapp-web.js@1.34.116`, shasum
  `cacd1ade39206957a6f540c618cba6e8881e106b`, integridade
  `sha512-Mn+TipM79H8+gKcN0jgc88z33SLqLE4+lIfd6Bot7Z0bDrff424WM/5D9CquHfI9HagwBZKXC9S7Y23JO7wMsQ==`;
- fork: `497` testes relevantes aprovados, uma pendência declarada, zero
  falhas; suíte integral do bridge `194/194`; ESLint, Prettier, web-cache e
  auditoria dos `158` arquivos do pacote aprovados;
- Underchat: commit `645c3e49e`, dependência física `1.34.116`, contrato real
  `13/13`, build TypeScript seletivo aprovado e regressão de recriação/WWebJS/UI
  `322/322` em dez suítes;
- rollout visual seletivo iniciado no build `v20260814164455675`, job
  `01a00129-8dfb-711d-a10b-bf159eb284e3`. Completar abaixo somente com digest,
  pools e canários reais; a rodada lenta acima é reprodução anterior à correção
  e não conta como canário da `1.34.116`.

Rollout e canários reais concluídos em `2026-08-14`:

- o build terminou em `2026-08-14T16:50:38.148Z`; a imagem publicada foi
  `harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814164455675`,
  digest imutável
  `sha256:ad6164bb33ce23fed0af68a6dbb2c2d264842e4b64f84d3a1f61badf2e9bedc8`;
- a imagem foi pré-carregada nos dois servidores antes da troca. Os quatro pools
  novos ficaram `ready`, todos no digest acima e com pacote físico `1.34.116`:
  Server 1 `01a00132-9524-771a-ae4f-3c69f8d4a7fa` e
  `01a00132-950e-76d6-a99f-88c72ec1f626`; Server 2
  `01a00132-94f5-71fd-9acc-74b5058522b1` e
  `01a00132-94d4-716c-afeb-ae56b3ef4328`;
- o canário foi o canal WWebJS
  `019ffb52-7e9e-71cc-a611-a1e1725ae68c`. A sessão permaneceu na revisão ativa
  `3096`, fingerprint
  `6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`,
  sem QR e sem handoff/recovery/resolution residual durante toda a série;
- a validação foi executada pela UI real em navegador visual, respeitando o
  cooldown do botão. Cada conclusão exigiu simultaneamente provider `online`,
  `connected/authenticated/session_valid=true`, sessão PostgreSQL `ready`, ACK
  central, geração do writer igual à geração ativa e lifecycle encerrado.

| Canário | Operação                               | Geração |    Duração | Clients | Recuperação nativa | Resultado |
| ------: | -------------------------------------- | ------- | ---------: | ------: | ------------------ | --------- |
|       1 | `01a00134-af0d-7529-a848-cec123b3cf68` | `22→23` | `71,918 s` |       1 | não acionada       | funcional |
|       2 | `01a00136-ab2e-748c-be51-df849a6334dd` | `23→24` | `63,345 s` |       1 | não acionada       | funcional |
|       3 | `01a00138-836b-769d-b137-bc57ad6c9bb2` | `24→25` | `55,181 s` |       1 | não acionada       | funcional |
|       4 | `01a0013a-5c2f-71fe-8718-ccd26bd222a5` | `25→26` | `63,731 s` |       1 | não acionada       | funcional |
|       5 | `01a0013c-34fd-767f-be24-83d9eb3a45e3` | `26→27` | `64,137 s` |       1 | não acionada       | funcional |

A série fechou `5/5`, média `63,662 s`, mínimo `55,181 s` e máximo `71,918 s`.
Nenhuma rodada atingiu o antigo deadline de `120 s`, iniciou client 2, exibiu
QR, alterou revisão/fingerprint ou produziu `TargetCloseError`,
`client.initialization_failed` ou `client.failure_primary`. Em cada runtime houve
`client.page_bindings_prepared` com `binding_count=26` e
`target_phase=pre_navigation`, seguido de `connection.online_readiness_proven`
com duas amostras canônicas. O runtime final, geração `27`, container
`8d6b060d9d95485aede62649e50780fcab7f621cff0265f839f761cb553b211f`,
está no mesmo digest e pacote `1.34.116`, online e com ACK central. A recuperação
nova não precisou ser acionada nos cinco canários; isso é esperado e preserva o
caminho rápido. Sua cobertura determinística permanece obrigatória para a
assinatura rara `connected_stream_without_comms`.

Regra antirregressão: não ampliar essa assinatura para aceitar estado Backbone
isolado como sucesso e não remover a persistência de `15 s`, a recuperação única
ou a revalidação completa pós-reload. Uma recriação só termina após as provas
canônicas e o ACK central; `Socket.state=CONNECTED` ou status visual isolado não
são critérios suficientes.

### Corrida do relançamento registrado diferido e correção `1.34.117`

A bateria adicional de recriação WWebJS iniciada em `2026-08-14` encontrou uma
corrida distinta das corrigidas nas versões `1.34.115` e `1.34.116`. As três
primeiras operações reais terminaram no primeiro client, mantendo a revisão
`3096` e o fingerprint
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`:

| Operação                               | Geração |    Duração | Client | Recuperação nativa                  |
| -------------------------------------- | ------- | ---------: | -----: | ----------------------------------- |
| `01a0016a-de56-71ee-ad16-ca3bc63648af` | `28→29` | `76,131 s` |      1 | `disconnected_stream_without_comms` |
| `01a0016c-b8b3-722c-9de6-72c9db3985b2` | `29→30` | `65,611 s` |      1 | `disconnected_stream_without_comms` |
| `01a0016e-8fa6-76bd-a850-b86d5625e24f` | `30→31` | `57,451 s` |      1 | não acionada                        |

Na quarta operação, `01a00170-68d1-77bb-9612-83780541dda1`, geração
`31→32`, o primeiro client falhou às `2026-08-14T18:02:55.902Z` com
`wwebjs_canonical_reconnect_stability_invalid`; o segundo client começou às
`18:02:56.070Z` e terminou online/ACK às `18:03:39.061Z`. Não houve QR, perda
da revisão, troca de fingerprint nem operação residual, porém essa rodada não
conta como canário limpo porque exigiu retry.

A causa era a combinação legítima de um restart WWebJS sobre a revisão já ativa:

- o launch registrado permanecia intencionalmente diferido enquanto WSS e rede
  estavam cercados;
- o socket continuava corretamente `UNLAUNCHED` durante esse intervalo;
- a ausência do launch state na página é normalizada por
  `summarizeCanonicalRegistrationState()` para a string literal `none`;
- o estado interno protegido já tinha
  `canonicalDeferredOnlineRegisteredLaunch=true`;
- `assertCanonicalReconnectSafetyState()` pretendia admitir exclusivamente
  essa combinação, mas testava `!canonical_runtime_launch_state`. A string
  `none` é truthy e, por isso, a admissão dependia da corrida do socket avançar
  para `OPENING` antes da amostra estável.

A correção é deliberadamente estreita: `UNLAUNCHED` só é admitido quando o flag
interno de launch registrado diferido é exatamente `true` **e** o estado público
normalizado é exatamente `none`. `starting`, `failed` e qualquer `UNLAUNCHED`
sem esse flag continuam falhando fechados. O teste determinístico mantém o socket
em `UNLAUNCHED/none` até a liberação da rede e prova a sequência de relançamento
real; um teste negativo separado prova que remover o flag, usar `starting` ou
usar `failed` continua produzindo `wwebjs_canonical_reconnect_stability_invalid`.

Proveniência e gates locais:

- fork: correção `a1203f5e`, release `e56e10cd`, tag `v1.34.117`;
- pacote `@wwebjs/whatsapp-web.js@1.34.117`, shasum
  `bfad1132d6472e35ed4da264017a39fe3c13fca5`, integridade
  `sha512-bj3O/UKHt0pcCv7ihlwclJjCXx/dgxm1b8HBZ+ZxUWIwnxIIx/XhTOdH4+EfjZbYCIye4jFsmYwWwr9aqLmmfA==`;
- fork: suíte `RemoteAuth` `111/111`, bridge `194/194`, ESLint, Prettier,
  `npm run check`, web-cache e pacote de `158` arquivos aprovados; o `npm test`
  integral continua bloqueado antes das suítes somente pela variável externa
  ausente `WWEBJS_TEST_REMOTE_ID`, sem falha atribuível à alteração;
- Underchat: commit `02c8e2de4`, dependência física `1.34.117`, build TypeScript
  seletivo aprovado e regressão WWebJS/recriação/segurança `232/232` em oito
  suítes;
- rollout visual seletivo iniciado no build `v20260814181426952`, job
  `01a0017b-8388-76c5-ba17-39f58b45e3dd`. Registrar digest, pools e a nova
  série `5/5` somente depois das provas reais. As quatro operações acima são a
  bateria de descoberta anterior ao rollout e não substituem os canários
  pós-correção.

Regra antirregressão: não substituir a comparação exata com `none` por um teste
genérico de falsy e não admitir `UNLAUNCHED` apenas por estado de socket. O flag
interno protegido e o estado normalizado precisam concordar; todos os demais
estados continuam sujeitos aos mesmos gates de identidade, sessão, transporte,
guard, estabilidade e ACK.

#### Rollout e série limpa pós-`1.34.117`

O build `v20260814181426952`, job
`01a0017b-8388-76c5-ba17-39f58b45e3dd`, terminou com sucesso e publicou o
content ID imutável
`sha256:1504d2441cfc9c4315a35a27bce75402263aff5572ebc8bb3a9c565c99326737`.
Depois do pré-pull serial nos dois servidores, os quatro pools WWebJS foram
substituídos de forma seletiva e ficaram `ready`, todos nesse digest e com o
pacote físico `1.34.117`: Server 1
`01a00184-e36d-...`/container `27bea79...` e
`01a00184-e34c-...`/container `436842c...`; Server 2
`01a00184-e32f-...`/container `50cb329...` e
`01a00184-e2fe-...`/container `9b5b7c...`. Pools Socket não foram alterados.

O mesmo canal WWebJS foi recriado cinco vezes pela interface visual real:

| Operação            | Geração |    Duração | Recuperação nativa                  | Resultado |
| ------------------- | ------- | ---------: | ----------------------------------- | --------- |
| `01a00186-07fe-...` | `32→33` | `58,013 s` | não acionada                        | funcional |
| `01a00187-ded3-...` | `33→34` | `51,273 s` | não acionada                        | funcional |
| `01a00189-b72d-...` | `34→35` | `71,728 s` | `disconnected_stream_without_comms` | funcional |
| `01a0018b-8e7a-...` | `35→36` | `51,392 s` | não acionada                        | funcional |
| `01a0018d-684b-...` | `36→37` | `64,804 s` | não acionada                        | funcional |

A série fechou `5/5`, média `59,442 s`, mínimo `51,273 s` e máximo
`71,728 s`. Todas terminaram no primeiro client, com revisão `3096`,
fingerprint
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`,
sessão `ready`, native online, autenticação válida, QR ausente, ACK central e
zero operação residual. A quarta repetição reproduziu exatamente a posição da
corrida anterior e passou limpa, provando a correção do launch diferido.

### Falha WWebJS → Baileys por signed pre-key sem one-time pre-key — correção em validação

Ao iniciar a nova matriz exclusiva do WWebJS, duas tentativas reais de
WWebJS → Baileys falharam com rollback automático antes da primeira escrita no
alvo:

| Handoff                                | Revisão alvo |   Duração | Ponto de não retorno | Recovery  |
| -------------------------------------- | -----------: | --------: | -------------------: | --------- |
| `bd4290b2-e049-440c-bb89-47aeba656dfb` |       `3174` | `5,226 s` |              ausente | completed |
| `79362c9c-6fdb-4a0f-8429-130b2c50da05` |       `3175` | `6,970 s` |              ausente | completed |

Nas duas, a candidata ficou `failed`, com zero registro canônico, sem
`persisted_at`, `validated_at` ou promoção. A origem foi restaurada na revisão
`3096`, mesmo fingerprint e novo runtime WWebJS online/ACK. Portanto, não
relaxar lifecycle, fencing ou rollback para contornar essa falha.

Um coletor acoplado ao container Baileys candidato confirmou que a exceção
ocorria em `postgres_auth_state_preload`, imediatamente depois de `store.open`.
Uma reprodução local somente leitura, usando a revisão real e o mesmo conversor
do fork, isolou o token estável
`CODEC_INCOMPATIBLE/codec_missing_pending_pre_key_id`.

O wrapper do worker também foi endurecido para preservar, sem mensagem, stack
ou material de sessão, a allowlist fechada de códigos nativos
`CODEC_INCOMPATIBLE`, `PROJECTION_INVALID`, `SESSION_ISOLATION_VIOLATION`,
`REVISION_INVALID`, `LEASE_LOST` e `FENCING_TOKEN_STALE`. Antes, o padrão
genérico descartava esses tokens e registrava `unclassified_error`, ocultando a
classe da falha. Qualquer código fora da lista continua colapsando para
`unclassified_error`; não ampliar para strings arbitrárias nem serializar a
exceção, pois mensagens e metadata podem conter DSN, capability, QR ou sessão.

A causa é um invariável incorreto no fork Baileys. O `libsignal` cria
legitimamente `pendingPreKey` apenas com `signedKeyId` e `baseKey` quando o
servidor não entrega uma one-time pre-key; nesse caso `preKeyId` é opcional. O
encoder Baileys e a conversão canônica de saída já preservavam essa ausência,
mas o validador de entrada exigia o campo antes da conversão. A correção local
passa a validar faixa/tipo de `preKeyId` somente quando ele existe. Base key,
signed pre-key id, versão da sessão, chains, material Kyber de v4 e todos os
limites continuam obrigatórios/fail-closed.

Cobertura antirregressão adicionada no fork:

- origens `wwebjs` e `whatsmeow` usam o mesmo caso parametrizado, impedindo que
  uma correção para WWebJS quebre WhatsMeow;
- o payload contém `pendingPreKey` com base key e signed key, sem o campo
  opcional `preKeyId`;
- a hidratação precisa restaurar uma sessão utilizável, continuar sem
  `preKeyId` e persistir novamente exatamente o mesmo protobuf canônico;
- os testes existentes que recusam material incompleto, Kyber parcial,
  duplicidade, tamanho e versão continuam obrigatórios.

Proveniência já publicada:

- fork Baileys: commit
  `ae5efea85d` (`fix(postgres): accept signed-only pending prekeys`), enviado a
  `origin/main`;
- pacote `@whiskeysockets/baileys@1.0.27`;
- shasum `40cd935938956962ca52702b2c3ccac0b66dee9d` e integridade
  `sha512-tqDhhBOzNWv7FkrH1Og/qgxuNwi3UcYqBe0beT4lbb+ItfY2TLB46wngCwUDAMCblaMrAe9p45W4qPq+tTgnFg==`;
- suíte integral do fork `38/38` suítes e `576/576` testes, build e prepack
  aprovados;
- o lint global continua com dívida anterior em arquivos não alterados. As
  linhas novas estão formatadas e sem apontamentos próprios; não misturar essa
  dívida ampla com o hotfix de sessão.

Integração Underchat concluída localmente com a URL imutável do tarball
`1.0.27`, integridade acima, pacote físico conferido em `node_modules` e
`allowBuilds` atualizado de forma estrita para a nova versão. O contrato de
dependência e os contratos de store passaram junto com a telemetria
(`46/46`); conexão e health check passaram `92/92`; e o build TypeScript
seletivo de `worker_baileys` foi aprovado. A allowlist de diagnóstico também
tem cobertura individual para os seis códigos e recusa códigos arbitrários.

Estado desta entrada: publicação e integração local concluídas. Rollout e
canário real ainda não devem ser marcados como concluídos até a imagem, os
pools e a migração visual passarem.

O rollout seletivo foi solicitado pela interface visual no build
`v20260814190957689`, job
`01a001ae-5639-7019-90a0-bd98a724e526`, contendo somente `worker_baileys`.
Durante a execução, não trocar o default nem reciclar pools; registrar o digest
e o pacote físico apenas depois do build concluído e do pré-pull serial em ambos
os servidores.

#### Rollout real do Baileys `1.0.27`

O commit Underchat `9ffb3687b` foi enviado a `main`. O build acima terminou com
sucesso em `5 min 15 s`, sem erro no job ou no item, e publicou
`harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814190957689`.
Os dois servidores materializaram o mesmo content ID imutável
`sha256:6182f76b8fa1145501aedb46ff81185ea3530a86d37ef06afe133c2909b98b4a`;
uma execução efêmera da própria imagem em cada host confirmou o pacote físico
`@whiskeysockets/baileys@1.0.27` antes do canário.

No primeiro pré-pull do Server 1, o containerd ficou sem espaço ao extrair uma
layer: o filesystem estava `100%`, com `19,49 GB` de imagens não utilizadas.
Nenhuma imagem parcial foi promovida. `docker image prune -a -f` foi executado
somente nesse host, preservando os 16 containers ativos e recuperando
`19,49 GB` (`17 GB` livres, uso de `63%`). Os aliases atuais de WWebJS
`v20260814181426952` e WhatsMeow `v20260814171207882` foram restaurados antes
do retry. Uma segunda tentativa encontrou e descartou um snapshot parcial
deixado pelo `ENOSPC`; a terceira materializou o digest correto. No Server 2, o
pull serial terminou diretamente. Regra operacional: não iniciar pulls
concorrentes quando o host estiver próximo da capacidade e nunca classificar
erro de extração como erro de sessão.

A nova versão tornou-se default e a sincronização dos servidores criou oito
pools Baileys `ready`, quatro por servidor, todos no digest acima e no pacote
`1.0.27`, sem `last_error`. A mesma sincronização recompôs dois pools WWebJS e
dois WhatsMeow por servidor nos digests/defaults já aprovados; isso não alterou
sessões de canais ativos. O canário WWebJS → Baileys ainda permanece obrigatório
antes de considerar a correção funcional em produção.

O canário visual eliminou a falha original e também validou o retorno:

| Direção          | Handoff                                | Revisão       | Duração do lifecycle | Resultado |
| ---------------- | -------------------------------------- | ------------- | -------------------: | --------- |
| WWebJS → Baileys | `3e2d8133-b136-4a91-abd0-8acc26971101` | `3096 → 3176` |           `17,089 s` | funcional |
| Baileys → WWebJS | `710c4ef0-41c4-4f1a-8b59-ffc19e83a3f9` | `3176 → 3177` |           `39,305 s` | funcional |

As duas operações terminaram no primeiro attempt, sem erro, rollback ou
recovery, com modal `Conexão bem-sucedida!`, fingerprint WWebJS invariável,
provider nativo online, sessão válida, ACK central, revisão monotônica e zero
operação residual. A saída WWebJS produziu checkpoint
`full_profile_plus_fresh_canonical_v1` de `85.058.645` bytes em `4.661 ms`. No
retorno, device, identity, prekeys clássicas, PQ, sessions e sender keys eram
semanticamente equivalentes; o WWebJS preservou todos os componentes e o
app-state nativo, sem `clear_signal_tables`. Esse resultado prova o hotfix real,
mas não substitui as cinco repetições exigidas por direção.

#### Publicação terminal perdida atrás da leitura inicial — correção web

Na quinta saída funcional WWebJS → Baileys, handoff
`b26f9d91-5d2b-4784-b578-ec05ae348f05`, o backend terminou em `12,273 s`, no
primeiro attempt, revisão `3183 → 3184`, Baileys online/ACK e zero operação
residual. A tela, porém, permaneceu em `Migrando canal` até o timeout seguro de
cinco minutos; só então a leitura autoritativa reconheceu o handoff concluído e
mostrou `Conexão bem-sucedida!`. A sessão nunca esteve presa: o atraso era
exclusivamente de reconciliação do navegador.

A causa estava no coalescimento de `useWhatsappProviderHandoffRecovery`. Se a
publicação terminal do lifecycle chegasse enquanto a leitura inicial de
`provider-handoff/latest` ainda estava em voo, `observeSnapshot()` descartava o
refresh porque o chamador não definia `replayIfInFlight`. Sem outra publicação,
o único fallback restante era o timeout de cinco minutos. As páginas **Canais**
e **Configurações/Canais** agora marcam qualquer status terminal relevante para
enfileirar exatamente um replay atrás da leitura corrente. O composable já
possui deduplicação por versão e faz no máximo esse replay; nenhum timer, loop
HTTP ou polling foi adicionado. Target provider, status online, ACK nativo,
identidade do lifecycle e leitura durável continuam obrigatórios.

Regra antirregressão: não remover
`replayIfInFlight: reachedTerminalState` das duas superfícies e não substituí-lo
por polling. O contrato web verifica a presença do replay terminal, enquanto a
suíte comportamental do composable prova que duas leituras concorrentes são
coalescidas em apenas uma repetição.

O reparo web foi integrado e enviado no commit `25c6b201b`. Os gates aprovaram
`50/50` testes comportamentais/contratuais, `vue-tsc`, Prettier, diff-check e o
build web de produção. O lint raiz atual não processa `.vue` e o script legado
do app referencia um `.eslintrc.cjs` inexistente; não registrar esse problema de
configuração anterior como falha do ajuste. Typecheck e compilação dos dois SFCs
passaram.

A corrida curta foi repetida no navegador já atualizado por HMR:

| Direção          | Handoff                                | Revisão       |    Duração | Resultado |
| ---------------- | -------------------------------------- | ------------- | ---------: | --------- |
| WWebJS → Baileys | `ec85e487-7ebf-4f88-a31d-c5e483f6c0be` | `3185 → 3186` | `17,682 s` | funcional |
| Baileys → WWebJS | `a22d1762-9773-4788-87c5-1f00c88ef73f` | `3186 → 3187` | `40,800 s` | funcional |

Ambos exibiram sucesso sem esperar o timeout, no primeiro attempt, sem recovery
e com todos os gates. O retorno preservou todos os componentes Signal e o
app-state nativo, sem limpeza destrutiva. A série limpa acumulada fechou pelo
menos `5/5` em WWebJS → Baileys (média `18,020 s`, mínimo `17,089 s`, máximo
`19,091 s`) e `5/5` em Baileys → WWebJS (média `41,261 s`, mínimo `39,144 s`,
máximo `47,772 s`); o par pós-correção acima é uma prova adicional. O handoff
`b26f...` permanece classificado como descoberta de regressão visual e não entra
na estatística limpa.

#### Série limpa WWebJS ↔ WhatsMeow depois das correções cruzadas

A mesma sessão canônica do canal WWebJS
`019ffb52-7e9e-71cc-a611-a1e1725ae68c` foi alternada cinco vezes completas
entre WWebJS e WhatsMeow pela interface visual real. Esta série foi executada
depois do fork WWebJS `1.34.117`, do Baileys `1.0.27` e do replay terminal web;
portanto, também verifica que os reparos feitos para WWebJS ↔ Baileys não
especializaram nem quebraram a origem WhatsMeow.

| Par | Direção            | Handoff                                | Revisão       |  Lifecycle | UI funcional |
| --: | ------------------ | -------------------------------------- | ------------- | ---------: | -----------: |
|   1 | WWebJS → WhatsMeow | `1affd543-6332-475f-b579-b183425c72dc` | `3187 → 3188` |  `4,400 s` |    `7,653 s` |
|   1 | WhatsMeow → WWebJS | `afbea6a6-e0fe-43ce-972f-46c46a09e871` | `3188 → 3189` | `40,177 s` |   `45,508 s` |
|   2 | WWebJS → WhatsMeow | `11df2198-c4c5-4ffc-8641-add060b193db` | `3189 → 3190` |  `3,856 s` |    `8,492 s` |
|   2 | WhatsMeow → WWebJS | `a89f020b-304f-452d-ad01-c4ed36c57baa` | `3190 → 3191` | `39,101 s` |   `45,178 s` |
|   3 | WWebJS → WhatsMeow | `05aa0653-1b29-42ac-8648-7e2af361f43b` | `3191 → 3192` |  `3,890 s` |    `7,780 s` |
|   3 | WhatsMeow → WWebJS | `e1eed219-8b47-44fb-b005-e254bc8e0c2f` | `3192 → 3193` | `39,629 s` |   `45,518 s` |
|   4 | WWebJS → WhatsMeow | `f16a33dd-cd1c-4edd-a895-ceaf75367157` | `3193 → 3194` |  `4,830 s` |    `8,418 s` |
|   4 | WhatsMeow → WWebJS | `b3512452-6d83-4ddd-8c94-91df7e60fa92` | `3194 → 3195` | `40,370 s` |   `51,141 s` |
|   5 | WWebJS → WhatsMeow | `1600ce95-8ed6-4e82-962a-78af0ae7abc3` | `3195 → 3196` |  `4,111 s` |    `7,902 s` |
|   5 | WhatsMeow → WWebJS | `6e35291e-c28f-432c-89ab-81c85f2ebcd5` | `3196 → 3197` | `41,127 s` |   `47,019 s` |

WWebJS → WhatsMeow fechou `5/5`, média de lifecycle `4,217 s` (mínimo
`3,856 s`, máximo `4,830 s`) e média até a tela funcional `8,049 s`.
WhatsMeow → WWebJS fechou `5/5`, média de lifecycle `40,081 s` (mínimo
`39,101 s`, máximo `41,127 s`) e média até a tela funcional `46,873 s`.
As dez operações terminaram na primeira tentativa, sem erro, retry, rollback ou
recovery, com provider nativo online, sessão `ready`, autenticação válida, ACK
central, revisão monotônica e zero lifecycle residual. O navegador exibiu
`Conexão bem-sucedida!` sem aguardar o fallback de cinco minutos, confirmando o
replay terminal também nessa origem.

Na saída para WhatsMeow, os cinco checkpoints foram
`full_profile_plus_fresh_canonical_v1`, reutilizaram a maior parte do perfil
WWebJS e não solicitaram nova autenticação. Nos cinco retornos, device,
identity, prekeys clássicas e PQ foram semanticamente equivalentes e sempre
preservados. Signal sessions foram substituídas seletivamente porque seus
checksums efetivamente divergiam. Sender keys divergiram apenas no primeiro
retorno e foram substituídas nessa rodada; nos quatro retornos seguintes eram
equivalentes e foram preservadas. Em todos os casos o app-state nativo foi
preservado e `destructiveClear=false`.

Essa variação é uma prova importante da neutralidade por origem: a decisão de
preservar/substituir é feita por componente e por equivalência semântica, não
por um ramo `baileys` ou `whatsmeow`. Regra antirregressão: nunca tornar a
entrada WWebJS dependente do nome do provider de origem, nunca preservar
sessions/sender keys divergentes e nunca apagar tabelas Signal equivalentes.
Toda alteração futura em qualquer fork nessa fronteira deve ser documentada
nesta memória na mesma rodada e repetir tanto Baileys → WWebJS quanto
WhatsMeow → WWebJS antes de ser aprovada.

#### Regressão final da recriação depois da matriz WWebJS

Depois das dez migrações WWebJS ↔ WhatsMeow e da série WWebJS ↔ Baileys, o
mesmo canal WWebJS foi recriado mais uma vez pela interface visual. A operação
`01a001da-1087-777d-9285-d44dd8e03c4f`, geração `63 → 64`, terminou em
`60,846 s`, no primeiro client e sem recuperação nativa. A revisão ativa
permaneceu `3197` e o fingerprint permaneceu
`6012094b582fa719294ce61989a91f679bb11bb696fbdd9ca7d22ff417c8e6ea`.
Os logs provaram `client.page_bindings_prepared` antes da navegação e
`connection.online_readiness_proven`; a sessão terminou `ready`, online,
autenticada, sem QR, com ACK central e zero operação residual. Assim, as
correções de migração desta rodada não regrediram o fluxo principal de recriar.

No snapshot final da rodada, os três canais reais estavam funcionais ao mesmo
tempo:

| Canal     | Provider    | Geração | Revisão | Native | Sessão | ACK | Operações residuais |
| --------- | ----------- | ------: | ------: | ------ | ------ | --- | ------------------: |
| Baileys   | `baileys`   |      87 |    3173 | online | ready  | sim |                   0 |
| WhatsMeow | `whatsmeow` |       9 |    3095 | online | ready  | sim |                   0 |
| WWebJS    | `wwebjs`    |      64 |    3197 | online | ready  | sim |                   0 |

Nos três, `connected/authenticated/sessionValid=true`, QR ausente, geração do
writer igual à geração da sessão e lifecycle nulo. Regra antirregressão: uma
alteração de compatibilidade de handoff não está encerrada apenas com a migração
bem-sucedida; deve haver ao menos uma recriação WWebJS posterior e um snapshot
conjunto dos três providers, sem resíduos.

## Campanha autoritativa em andamento — matriz repetida Socket ↔ WWebJS — 2026-08-13/14

Esta campanha foi solicitada depois das correções e provas anteriores. Seu
objetivo não é apenas repetir a matriz 6/6 uma vez: cada direção que cruza a
fronteira Socket ↔ navegador será concluída funcionalmente pelo menos cinquenta
vezes, sempre pela interface real e sobre a mesma sessão canônica. A entrada no
WWebJS continua obrigatoriamente neutra à origem; uma correção observada com
Baileys só pode ser aceita depois de repetir WhatsMeow → WWebJS, e vice-versa.

O canário desta campanha é o worker
`019ffb4e-1456-747b-8197-f19abb1eafe1`, nome público `Baileys`, com fingerprint
canônico
`cabb522a5dbcb0c2c28aef43cd9403dcb0c246cab82c5f72a165e451ebab9700`.
Cada linha funcional precisa comprovar conjuntamente: tela final
`Conexão bem-sucedida!`, provider nativo correto, sessão `ready`, status
`online`, `connected/authenticated/sessionValid=true`, QR ausente, ACK central,
fingerprint invariável, revisão nova e zero handoff/recovery/resolution ativo.
Status visual isolado não conta como sucesso.

### Diário incremental da campanha

| Rodada | Direção          | Handoff                                | Revisão       |   Duração | Tentativas | Resultado        |
| -----: | ---------------- | -------------------------------------- | ------------- | --------: | ---------: | ---------------- |
|      1 | WWebJS → Baileys | `2297efa5-c391-462b-ada3-335c30ca32db` | `3109 → 3121` |  33,772 s |          0 | funcional        |
|      2 | Baileys → WWebJS | `a60054fb-a936-4034-8c4f-812fd76ba278` | `3121 → 3122` | 198,434 s |  2 clients | funcional, lenta |

Na rodada 1, iniciada pela UI às `2026-08-14T01:52:44.073Z` e concluída às
`01:53:17.846Z`, o modal evoluiu de `Migrando canal` para
`Conexão bem-sucedida!`. O alvo terminou no Baileys, geração de runtime/sessão
`25`, revisão ativa `3121`, online, autenticado, sessão válida, sem QR, com ACK
central e fingerprint preservado. Não houve retry do handoff nem operação de
recuperação ativa. Esta rodada também prova que o novo caminho de seleção de
perfil WWebJS não interfere na saída WWebJS → Socket.

Na rodada 2, a primeira inicialização WWebJS importou `2.282` registros e sete
sync keys, autenticou o transporte, completou a barreira nativa e então falhou
fechada em `wwebjs_canonical_app_state_sync_key_verification_failed`. O
checkpoint protegido foi preservado; não houve QR nem rollback destrutivo. O
mesmo runtime iniciou o segundo client depois do retry genérico de 60 s. Nessa
tentativa, as sete chaves foram verificadas exatamente, cinco collections
foram sincronizadas em `14.734 ms` e a conexão ficou pronta. A revisão `3122`,
geração `26`, terminou online, com sessão válida, ACK central, fingerprint
preservado e zero operação ativa.

O diagnóstico é uma janela transitória de visibilidade/race do IndexedDB na
segunda materialização, não credencial inválida. O primeiro client permitia
somente oito leituras exatas espaçadas em 100 ms; o segundo encontrou o mesmo
material íntegro. A correção candidata deve ampliar apenas essa janela
limitada, continuar exigindo igualdade byte a byte de key id/data, timestamp e
fingerprint em todas as amostras e registrar a forma da divergência. Não
tolerar mismatch persistente, não remover o clear conjunto e não aplicar o
tratamento à recriação WWebJS normal, que não executa a restauração canônica
cross-provider.

### Correção derivada das rodadas 1–2

O fork WWebJS passou a manter a verificação exata offline por uma janela máxima
de cinco segundos, limitada também pelo deadline externo. A aceitação continua
exigindo igualdade de key id, key data, timestamp e fingerprint para todas as
sync keys e continua exigindo as tabelas derivadas vazias antes do full sync.
Não existe aceitação parcial, majority vote nem fallback para o material
anterior. Se a divergência persistir, o perfil é marcado poisoned e a execução
continua fail-closed.

Quando há falha, a telemetria registra somente contagens: esperado, observado,
ids correspondentes, linhas exatas, versions, mutation MACs, leituras e duração
da janela. Nenhuma chave, MAC, fingerprint ou identificador criptográfico é
logado. O fork tem testes para convergência depois da antiga oitava leitura e
para mismatch persistente. As suítes `BrowserSessionBridge + RemoteAuth`
terminaram com `290/290` testes aprovados; lint, Prettier, web cache e auditoria
do pacote também passaram.

Mesmo com a janela maior, uma incompatibilidade real ainda pode exigir um novo
client. Para não herdar 60 s artificiais, o worker Underchat agora usa retry de
2 s somente quando PostgreSQL confirma `hasPendingHandoff()=true`. O valor pode
ser configurado por `WWEBJS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS`, limitado a
`250..15000 ms`. Recriação WWebJS, reconexão operacional, conexão direta e QR
continuam com o delay genérico de 60 s. A telemetria
`wwebjs.provider.reconnect_scheduled` expõe `provider_handoff`, `delay_ms` e o
estado, permitindo auditar o isolamento.

Proveniência desta correção:

- fork `187868fa` — janela exata e diagnóstico agregado;
- fork `2890c1f7` — release `@wwebjs/whatsapp-web.js@1.34.94`;
- shasum `3368c1944fdfcf16a8902275bebbf867be8d3ee7`;
- integridade
  `sha512-TsH8juvUFiihi+B8EGnvjyF4zz6cRnHa7HwSwz8VjsbAywMchkCmBbm0Oi8B10ZdlenH726eZnBDLyXLnoM+cg==`;
- Underchat: 127 contratos do serviço de conexão e 142 contratos focados de
  serviço/dependência/runtime aprovados; build TypeScript do worker WWebJS e
  ESLint focado aprovados.

### Publicação e rollout da correção da rodada 2

O build WWebJS `v20260814022048641`, job
`019ffe12-6e82-77da-a750-0b6bfa7e0e2a`, foi iniciado em
`2026-08-14T02:20:49.060Z` e concluído com sucesso em
`02:26:58.795Z` (`6 min 09,735 s`). A imagem publicada e definida como default
é
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814022048641`,
digest
`sha256:5caae3fd9baf04526d22e0a4174aaf2655c78116b8c2f0779e57b55493ce183f`.

O pull foi deliberadamente sequencial: primeiro Server 1, com digest verificado,
e somente depois Server 2. Em seguida, a interface real de **Canais aquecidos**
foi filtrada para `Opção 2 (Navegador)` e a ação **Recriar Todos** substituiu os
quatro pools WWebJS sem reiniciar pools Socket ou o runtime ativo. O rollout
terminou com dois pools `Pronto` por servidor, todos no digest acima e com
`@wwebjs/whatsapp-web.js@1.34.94`. Não iniciar a matriz repetida se algum pool
WWebJS elegível estiver em pacote ou digest diferente.

### Falha sustentada encontrada depois da rodada 2

Antes da rodada seguinte, a validação do estado sustentado recusou o sucesso
apenas visual da rodada 2: a revisão `3122` continuava `ready`, íntegra e sem QR,
mas o runtime antigo `1.34.93` estava `offline/handoff`, sem ACK central. Às
`02:20:11.597Z` ele voltou a publicar nativamente `online` depois de uma
navegação interna. Quatro segundos depois, o health-check observou o socket
`CONNECTED`, mas `Store.WWebJS` ainda não estava novamente visível. Essa única
amostra transitória foi publicada como `connecting` e o mismatch destruiu o
cliente às `02:20:16.111Z`. A recuperação então alcançou transporte e sync
novamente, porém perdeu uma corrida ao expor o binding Puppeteer já instalado:
`window['onLogoutEvent'] already exists`. O runtime ficou indefinidamente em
`canonical_activation_checkpoint`.

Esse caso estabelece duas regras de regressão:

1. a tela `Conexão bem-sucedida!` não conta sem uma segunda prova sustentada do
   runtime e do ACK central;
2. uma única perda transitória de client info, event bridge, `Store.WWebJS` ou
   self-probe, depois de já estar conectado, não prova queda. A segunda amostra
   consecutiva continua obrigatoriamente acionando a recuperação.

Na Underchat, o health-check passou a tolerar exatamente uma dessas amostras
conhecidas; estado local ausente, erro terminal, process replacement e qualquer
segunda amostra continuam fail-closed. No fork, `exposeFunctionIfAbsent` só
tolera a corrida de binding quando a mensagem é exatamente a duplicidade do
nome solicitado **e** uma leitura posterior da página comprova que a função
existe. Outros erros e uma duplicidade não comprovada continuam propagados.

Proveniência e gates:

- fork `a4b2339f` — corrida de binding comprovada e quatro testes de unidade;
- fork `90edb860` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.95`;
- shasum `b7d8e29127263d77906809098f3dc730c5bdc66b`;
- integridade
  `sha512-WKFTNTRB5ZQ3WJS1s1ws2YvOnueJDbImqYBekoXg5DrucJW1XT4KBNqUCNYexb2tBUqSND7QQ2dxb3MmOcJIoQ==`;
- fork: `294/294` testes de BrowserSessionBridge, RemoteAuth e utilitário,
  lint, Prettier, web cache, auditoria e prepack aprovados;
- Underchat: `33/33` suítes e `453/453` contratos WWebJS, ESLint focado e build
  TypeScript do worker WWebJS aprovados.

O comportamento é deliberadamente isolado do fluxo normal: recriação, conexão
direta e QR não recebem um retry mais curto nem pulam gates; o health-check
apenas deixa de destruir um cliente já conectado por uma leitura transitória e
continua derrubando-o quando a degradação persiste.

### Rollout da correção sustentada `1.34.95`

O build WWebJS `v20260814024646593`, job
`019ffe2a-3442-71ff-8d13-89dcdaa5aa91`, foi iniciado em
`2026-08-14T02:46:46.616Z` e concluído em `02:52:29.915Z`
(`5 min 43,299 s`), sem erro de pipeline ou item. A imagem publicada e definida
como default é
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814024646593`,
digest
`sha256:9a51ab14658754fdfcdf7fb374d7c986da1bb082065fcd63a22da5dc28e66c12`.

O pull foi novamente sequencial e conferido: Server 1 primeiro e Server 2
depois, ambos com `latest` e release no mesmo digest. Pela interface visual de
**Canais aquecidos**, filtrada exclusivamente por `Opção 2 (Navegador)`, a ação
**Recriar Todos** substituiu os quatro pools WWebJS. O estado final tem dois
pools `Pronto` por servidor, todos no digest acima e com
`@wwebjs/whatsapp-web.js@1.34.95`. Os pools Socket e os runtimes ativos não
foram recriados por esse rollout.

Antes de voltar a contar migrações, o canário que ficou preso na revisão
`3122` deve passar por uma recriação WWebJS normal usando esse pool. Essa prova
é obrigatória para confirmar simultaneamente recuperação da sessão, ACK
central sustentado e ausência de regressão do fluxo principal de recriação.

### Prova de recriação e primeiras medições pós-`1.34.95`

A recriação WWebJS normal do canário foi solicitada pela UI e iniciou o comando
no runtime geração `27` às `2026-08-14T02:58:34.701Z`. O mesmo runtime, já no
digest `9a51ab…66c12`, publicou conexão pronta às `03:00:28.504Z`, cerca de
`113,803 s` depois. A UI terminou em `Conectado`; uma prova posterior a mais de
um ciclo de health-check confirmou `Session ready`, transporte `CONNECTED`,
sessão pronta, envio/recepção autorizados, ACK central, ingresso JetStream
ativo, fingerprint canônico e zero operação de recuperação. Não houve erro de
binding. Essa é a prova explícita de que as correções de handoff não quebraram
a recriação WWebJS normal.

Depois dela, a primeira ida pós-correção WWebJS → Baileys concluiu em
`13,290 s`, handoff `dadc089e-3f5f-46d0-a40c-4eac494aab32`, revisão
`3122 → 3123`, sem retry. O retorno Baileys → WWebJS concluiu em `139,092 s`,
handoff `d91e48af-0ec8-463c-8bee-8c72053ec74a`, revisão `3123 → 3124`, também
sem retry. Ambas preservaram fingerprint, ficaram online sem QR, obtiveram ACK
central e terminaram sem operação ativa. O retorno WWebJS permaneceu saudável
por vários ciclos depois da tela de sucesso, portanto conta como funcional.

O perfil dessa segunda duração revelou desperdício determinístico, não lentidão
de rede: `pq_capability_resolution` consumiu aproximadamente `45 s` antes e
`46 s` depois do único reload, embora a projeção tivesse zero prekeys PQ, zero
last-resort key, nenhuma tabela Kyber física e upload PQ do runtime desativado.
O único await nesse estágio era `isPQMigrated()`, que nesses builds sem tabela
aguarda o deadline interno para concluir o mesmo estado já provado pelos demais
gates.

O fork `1.34.96` elimina somente esse probe redundante quando **todas** as provas
concordam: fonte sem estado ou material PQ, capabilities com contagens zero e
storage `rollout_without_tables`, server-count em `reset`, os dois getters
físicos retornando `NoSuchTableError` e upload PQ do runtime desativado. Se
qualquer tabela existir, qualquer contagem/estado divergir ou o upload estiver
ativo, o probe oficial continua obrigatório. O caminho ainda limpa e reseta a
store candidata antes da hidratação e continua fail-closed para PQ migrado.

Proveniência e gates da otimização:

- fork `75a79a37` — atalho comprovado do rollout PQ vazio;
- fork `6cc5d905` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.96`;
- shasum `6c297d6e6656c416b7e4f20e44a84d55c51383d7`;
- integridade
  `sha512-Md1lPbqETfzXUv/V1hhe0QsYZckASJENPwLvDQ4I+x4CFDYPAL5jNWY0n91Dr4mY6V1iD1YyjLvOg8Qt++LG3g==`;
- fork: `301/301` contratos focados, lint completo, Prettier, cache web,
  auditoria de 158 arquivos e prepack aprovados;
- Underchat: `36/36` suítes e `524/524` contratos WWebJS/sessão, instalação
  frozen-lockfile e build TypeScript do worker WWebJS aprovados.

A suíte integral do fork contém testes de integração externa e não iniciou sem
`WWEBJS_TEST_REMOTE_ID`; isso não substitui nem invalida as 301 provas locais
selecionadas. A próxima ação obrigatória é publicar uma imagem Underchat com
`1.34.96`, recriar somente os pools WWebJS e repetir Baileys → WWebJS para medir
se os dois platôs de ~45 s desapareceram sem alterar os gates restantes.

### Rollout da otimização PQ vazia `1.34.96`

O build WWebJS `v20260814031842183`, job
`019ffe47-6f08-7185-8149-905ac0aae062`, foi iniciado em
`2026-08-14T03:18:42.454Z` e concluído em `03:24:56.383Z`
(`6 min 13,929 s`), sem erro. A imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814031842183`
tem digest
`sha256:b96b66f3d2afbc6a1e1eb85201813b7b0e55124df7660d7538aabc9c3dd0c09e`.

O pull foi sequencial, primeiro no Server 1 e depois no Server 2. Em ambos,
`under-worker-wwebjs:latest` e a tag versionada resolveram para o mesmo digest.
Pela interface visual de **Canais aquecidos**, filtrada por
`Opção 2 (Navegador)`, **Recriar Todos** substituiu somente os quatro pools
WWebJS. O estado final ficou `Pronto`, com dois pools por servidor, todos em
`@wwebjs/whatsapp-web.js@1.34.96` e no digest acima:

- Server 1: containers `b685e4787ae1…24d1` e `445f66b22e24…f575`;
- Server 2: containers `f309e2d8868c…cd9e` e `b3f3628cbc4e…bf8c`.

Nenhum pool Baileys/WhatsMeow nem runtime ativo foi recriado nessa operação.
O próximo gate é a ida WWebJS → Baileys seguida do retorno Baileys → WWebJS,
para que a entrada WWebJS consuma comprovadamente um pool `1.34.96` e seja
medida depois de pelo menos um ciclo de health-check.

### Medição `1.34.96` e segunda espera redundante isolada

O gate visual WWebJS → Baileys concluiu no handoff
`c78fa42e-a99b-4be3-b622-c5dc88264574`, revisão `3124 → 3125`, em
`20,329 s`, sem retry. O retorno Baileys → WWebJS, já consumindo o pool
`1.34.96`, concluiu no handoff `0a7270b8-f37c-49d7-aa2d-f10fa48ad463`,
revisão `3125 → 3126`, em `138,024 s`, também sem retry. Ambos ficaram
online, autenticados, sem QR, com ACK central, fingerprint inalterado e zero
operação ativa. A entrada WWebJS foi novamente comprovada depois de um ciclo
de health-check: HTTP 200, `Session ready`, socket `CONNECTED`, envio e
recepção habilitados e ingresso JetStream autorizado.

A correção `1.34.96` funcionou no limite pretendido: o estágio
`pq_capability_resolution` deixou de consumir aproximadamente 45 segundos.
Contudo, a telemetria mostrou outra espera de 44–45 segundos antes de
`clear_signal_tables`, repetida depois do reload. O renderer permanecia preso
em `WAWebSignalStorage.initialize()` mesmo quando o bootstrap oficial já tinha
registration info íntegro e as sete tabelas Signal clássicas acessíveis. Essa
chamada é necessária quando o perfil ainda não está inicializado, mas é
redundante e bloqueante quando essas duas provas independentes já existem.

O fork `1.34.97` adiciona um gate estrito e somente de leitura antes dessa
chamada. Ele pula `initialize()` apenas quando o registration id é positivo e
seguro, as duas metades da identity key têm exatamente 32 bytes e as sete
tabelas clássicas existem com APIs de leitura e limpeza. Qualquer getter, forma
ou credencial ausente usa o `initialize()` oficial anterior; nenhuma tabela é
alterada durante o probe. O resultado registra
`signal_storage_initialization_mode` para distinguir os dois caminhos. PQ,
app-state, critical seal, identidade, fingerprint, WebSocket gate e ACK não
foram relaxados.

Proveniência e gates:

- fork `17529600` — prova de bootstrap já inicializado e bypass limitado;
- fork `124724a3` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.97`;
- shasum `a98af78872a2f66c39abe53292c0aa3cce7d2fb9`;
- integridade
  `sha512-W7BLTjrH3XNjDDv6FkCyFVDvemgobmlKJTFOuyz1cLH5zAiQWLw7qwISCHN7XajWjYCarZn+tNSrEVucjFvpWA==`;
- fork: `301/301` contratos selecionados, lint, Prettier, cache web, auditoria
  de 158 arquivos, prepack e dry-pack aprovados;
- Underchat: instalação frozen-lockfile, dependência real `1.34.97`,
  `26/26` suítes e `417/417` contratos WWebJS, além da seleção ampliada de
  `36/36` suítes e `534/534` testes, ESLint focado, Prettier focado e build
  TypeScript do worker WWebJS aprovados.

### Rollout operacional do WWebJS `1.34.97`

A imagem `v20260814034726948` foi gerada pelo job
`019ffe61-c065-7478-964b-43628ee5a7dc`, iniciado em
`2026-08-14T03:47:26.980Z` e concluído às `03:53:51.360Z` em `6m24,380s`.
Imagem e digest efetivos:

- `harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814034726948`;
- `sha256:2931a023c5199c53e9c17bba6d2f005e10ebc50d78a7b29c14e0e3e0bd0a5cd5`.

O pull foi feito sequencialmente no Server 1 e no Server 2 para não disputar
banda nem capacidade de extração. Depois de **Recriar todos** apenas para
`Opção 2 (Navegador)`, quatro pools ficaram `ready`, dois por servidor, todos
com pacote `1.34.97` e o mesmo digest. IDs:

- Server 1: `019ffe6a-20bf-70b3-9858-837aaecdd8da` e
  `019ffe6a-2099-706c-b1df-ea724d4f2513`;
- Server 2: `019ffe6a-2083-7302-8b7f-2e8249c25cd7` e
  `019ffe6a-205e-760e-afa8-c2c734836030`.

O gate seguinte é repetir WWebJS → Baileys → WWebJS pela interface visual. A
volta deve consumir um pool `1.34.97`; a melhoria só será aceita se os dois
platôs desaparecerem nos logs e o target continuar saudável depois do ciclo
de health-check sustentado.

### Resultado do canário `1.34.97` e correção `1.34.98`

A ida visual WWebJS → Baileys concluiu no handoff
`3cc50f8e-46c9-47c1-b79b-4fcdea9edec9`, revisão `3126 → 3127`, em
`39,211 s`. A volta Baileys → WWebJS consumiu a imagem `1.34.97` e concluiu no
handoff `4e595a6c-e1de-4f51-812c-c5552607f415`, revisão `3127 → 3128`, em
`133,305 s`. Ambas preservaram o fingerprint, terminaram online,
autenticadas, sem QR, com sessão pronta, ACK central e zero operação residual.
Logo, o canário foi funcional, mas **reprovado para performance**.

Os logs provaram por que o primeiro bypass não surtiu efeito. O probe
`getRegistrationInfo()` usado para decidir se `initialize()` era dispensável
ficou bloqueado por `43,601 s` antes da primeira hidratação e `43,735 s` depois
do reload. A própria prova executava a inicialização privada lenta que ela
pretendia evitar; o tempo não estava nas escritas, no PQ nem no app-state.

O fork `1.34.98` não faz essa leitura bloqueante quando há simultaneamente:
perfil WWebJS reutilizável autorizado por `preserveExistingAppState`, sete
tabelas Signal clássicas com APIs de leitura e limpeza, registration id
canônico positivo, identity key canônica de 32 bytes e fingerprint canônico
válido. Esse conjunto só existe depois da restauração de perfil cuja autoridade
e checksum já foram validados pelo `PostgresSessionStore`. Conexão direta,
pareamento/QR, perfil novo, tabela ausente ou projeção malformada continuam no
`initialize()` oficial. O critical seal posterior ainda relê e verifica
registration info, identidade, signed pre-key, ADV, Noise, routing info e flag
de registro; nenhum gate de aceitação foi removido. O log de importação agora
expõe `signal_storage_initialization_mode`.

Proveniência e gates locais:

- fork `dfe44e1d` — evita somente o probe bloqueante do perfil reutilizável;
- fork `3204af2b` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.98`;
- shasum `13b39438c6863f94f6e06115f80bb1d3b35d28db`;
- integridade
  `sha512-X62wiICG8hugpWEEWFlRhjCKlKF3OZ8wUoDaw46Xuf4GiMqDHwqyLvQkEIrwa9FK2mRJiVjzIUfkP4CEITsqfw==`;
- fork: `345` testes locais aprovados e uma integração PostgreSQL
  explicitamente pendente, lint, Prettier, cache web, auditoria de 158 arquivos
  e dry-pack aprovados;
- Underchat: instalação frozen-lockfile com pacote real `1.34.98`,
  `33/33` suítes e `453/453` contratos WWebJS, ESLint e Prettier focados e
  build TypeScript do worker WWebJS aprovados.

A imagem `1.34.98` foi publicada como `v20260814041329166` pelo job
`019ffe79-96ce-760a-8b6d-e2a701e1a691`, concluído em `6m16,011s`, com digest
imutável
`sha256:8a45b6acddbd08317917e7cffbe809de2477f97e27a4a6a4e1bf1904b3d87948`.
O pull sequencial no Server 1 e Server 2 e a recriação apenas dos pools WWebJS
produziram quatro pools `ready`, todos com pacote `1.34.98` e o digest exato:

- Server 1: `019ffe82-15eb-77e6-93c4-debb83f495f3` e
  `019ffe82-15b4-7638-8d65-867093dae6cc`;
- Server 2: `019ffe82-1607-73ee-ba37-ac1bb0a430b5` e
  `019ffe82-1574-71d1-b046-eb78a7b1cfed`.

O canário visual seguinte foi funcional, mas novamente reprovado para
performance. WWebJS → Baileys concluiu no handoff
`3995109f-5f98-4750-8ede-4bef875f0ee5`, revisão `3128 → 3129`, em `15,062s`
no backend e `20,820s` na interface. Baileys → WWebJS concluiu no handoff
`b3003891-e1c6-4e1a-aa1f-25042c56918b`, revisão `3129 → 3130`, em `135,183s`
no backend e `143,631s` na interface. Após mais `35s` sustentados, o health
continuava HTTP 200, `Session ready`, `CONNECTED`, dono JetStream exato,
fingerprint preservado, sem QR, tentativa zero e nenhuma operação residual.

A telemetria `1.34.98` encerrou a hipótese anterior: as duas importações
efetivamente escolheram
`signal_storage_initialization_mode=preinitialized_bootstrap_proof`, mas o
primeiro `table.clear()` de cada documento ficou bloqueado por `44,122s` e
`45,205s`. Portanto, qualquer primeiro acesso à base Signal naquele documento
dispara a inicialização privada tardia; o custo não estava no probe removido,
nas escritas, no PQ ou no app-state. O reload controlado continuou necessário
para selecionar o bootstrap registrado oficial, mas a segunda importação
integral e suas leituras Signal offline eram redundantes quando todas as provas
de continuidade estavam presentes.

### Correção `1.34.99`: continuidade selada após o reload

O fork `1.34.99` mantém a primeira importação criptográfica completa e o reload
oficial, mas permite reaproveitar a prova selada anterior no novo documento
somente quando **todos** os seguintes gates são verdadeiros:

- revisão nova de handoff, sem replay ativo e sem recuperação pós-PONR;
- perfil WWebJS reutilizável com app-state nativo coerente e zero sync key
  pendente;
- importação `preinitialized_bootstrap_proof` concluída e critical seal válido;
- reload exato uma vez, `registered=true`, sem reparo de registro e sem
  bootstrap adicional do runtime;
- epoch do documento mudou, guard de navegação/credenciais permaneceu ativo,
  nenhum apagamento foi observado e o monitor contou zero handshake WebSocket;
- watchdog de pareamento ativo, nenhuma referência de QR e socket ainda
  offline em estado permitido.

Nesse caso, a segunda importação Signal é omitida e o checkpoint offline usa a
projeção criptográfica já selada com o snapshot do perfil persistido. Todos os
gates offline repetidos revalidam epoch, registro, guard, watchdog, QR e socket
sem reabrir a base Signal. Antes de promoção pública/READY, depois da conexão
autenticada, uma leitura Signal **nova e completa** continua obrigatória e a
prova transitória é descartada. Se qualquer condição faltar, o fluxo volta
automaticamente ao reseal conservador anterior. Conexão direta, QR, recriar,
replay, recovery e perfil novo não entram nesse fast path.

Proveniência e gates locais da `1.34.99`:

- fork `e5d357b8` — implementação e testes da continuidade selada;
- fork `e19e42aa` — release `@wwebjs/whatsapp-web.js@1.34.99`;
- shasum `0160b787bdaf94198a784856144694e0dd3456d8`;
- integridade
  `sha512-gmHz6DvXuBnG5jzLh5aBWD8Hvx4XXx7Ah9omJl24TIBEakYGrF/5iOgdyhUVdJa/mB/l9aBbm/Cq90QuR3hvHw==`;
- fork: `301/301` testes das três suítes críticas, lint, Prettier, cache web,
  auditoria de 158 arquivos e dry-pack aprovados;
- Underchat `3b079da76`: frozen-lockfile com pacote real `1.34.99`,
  `30/30` suítes e `439/439` contratos WWebJS selecionados e build TypeScript
  do worker WWebJS aprovados.

O build visual `v20260814044626483`, job
`019ffe97-c2b3-7354-8baf-e1061e6d01c8`, foi concluído somente para WWebJS em
`2026-08-14T04:52:33.179Z`, com duração de `6m06,653s`. A imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814044626483`
tem digest
`sha256:9bacaf9a4cae9918db7029e6aba01bb00cfd962292cd2a9723834ab76921b0e3`.
O pull sequencial e a recriação visual exclusiva dos pools WWebJS produziram
quatro pools `ready`, todos no pacote `1.34.99` e nesse digest:

- Server 1: `019ffea0-eea1-7238-93ed-1a930e8ce576` e
  `019ffea0-ee6e-725e-ab04-9871df4d4921`;
- Server 2: `019ffea0-ee8a-73eb-a384-aa3c6e8e6bfe` e
  `019ffea0-ee48-709c-8544-77868aef7cd0`.

### Canário real `1.34.99` e correção estrita `1.34.100`

O primeiro canário real mostrou que a hipótese estava correta, mas a seleção
do caminho rápido estava incompleta. WWebJS → Baileys terminou no handoff
`87288c9a-cb79-4598-89a5-380e6be9c756`, revisão `3130 → 3131`, em
`17,530s` no backend e `23,441s` na interface, sem tentativa, recuperação ou
QR. A volta Baileys → WWebJS consumiu um pool `1.34.99`, handoff
`03c13253-e3f8-4b76-98e1-33614f9535c8`, revisão `3131 → 3132`, mas só
terminou em `241,257s`. A interface excedeu o timeout de `240s` por cerca de um
segundo, embora tenha evoluído logo depois para `Conexão bem-sucedida!`.

A proteção funcionou: fingerprint permaneceu
`cabb522a5dbcb0c2c28aef43cd9403dcb0c246cab82c5f72a165e451ebab9700`,
não houve QR, a revisão terminou `active/ready`, runtime online, ACK central e
zero operação residual. Mesmo assim, essa execução é reprovada para a campanha
de performance e não conta entre os cinquenta sucessos.

Os logs localizaram o motivo sem inferência por duração. Depois da primeira
importação completa (`clear_signal_tables=44,234s`), o reload protegido voltou
registrado, sem reparo, com zero handshake, mas em `UNLAUNCHED`: estado esperado
enquanto o WebSocket permanece cercado. A seleção `1.34.99` exigia
`runtimeBootstrapRequired=false`, por isso recusou a continuidade e repetiu a
importação Signal (`clear_signal_tables=44,814s`). Em seguida, o primeiro
bootstrap conectado foi recusado por
`wwebjs_canonical_connected_safety_invalid`; a tentativa protegida seguinte
reabriu o mesmo target e só então terminou. Não confundir essa falha com
credencial incompatível nem remover os gates finais.

A `1.34.100` admite a continuidade selada também quando
`runtimeBootstrapRequired=true` **somente** se o estado comprovado do reload é
exatamente `UNLAUNCHED`. O fluxo então executa o launch oficial offline já
existente, sem reabrir Signal. `OPENING` com bootstrap ausente, registro que
precisa de reparo, reload diferente de um, handshake, perfil novo, app-state
incoerente, replay, recovery, conexão direta, QR e recriação continuam no
caminho conservador. A leitura Signal completa após conexão continua
obrigatória.

Também foi adicionada a telemetria
`browser_bridge.canonical_connected_safety_rejected`, somente com booleanos
allowlisted para epoch, guards, fase live, ACK destrutivo, violação, bootstrap,
watchdog, pairing/ref e estado do socket. Ela existe para diagnosticar qual
gate rejeitou uma futura execução; não é autorização para tolerar uma falha.

Proveniência e gates da `1.34.100`:

- fork `c66325dc` — seleção `UNLAUNCHED` cercada e telemetria de rejeição;
- fork `c4f47b1b` — release `@wwebjs/whatsapp-web.js@1.34.100`;
- shasum `7b0553f3dcf47624123406d36bf0751458d503a9`;
- integridade
  `sha512-wTygfLqaTz/af7gSb0Xgr51k+YlmFbbrmvnnKkffoIBrvgiKlGyiS+5qGf1+ZRyfTY9eHbVTDRvrfrmCdGKfnw==`;
- fork: `302/302` testes das três suítes críticas, lint, Prettier, cache web,
  auditoria de 158 arquivos, prepack e dry-pack aprovados;
- Underchat `9e0d3a4ee`: dependência real `1.34.100`, frozen-lockfile,
  `26/26` suítes e `417/417` contratos WWebJS e build TypeScript do worker
  aprovados.

O build visual somente WWebJS `v20260814051026308`, job
`019ffead-bb04-7512-b321-ed9c3e9f0256`, iniciou em
`2026-08-14T05:10:26.814Z` e terminou em `05:16:40.991Z`, duração
`6m14,177s`, sem erro. A imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814051026308`
tem digest
`sha256:ab15c7565c81bdb45bdbea44ccf2a4b1941346dd6d7dfc6f8752777caa32e12e`.
O pull sequencial confirmou `latest=release` nos dois servidores. A recriação
visual filtrou exclusivamente `Opção 2 (Navegador)` e gerou quatro pools
`ready` com pacote `1.34.100` e digest exato:

- Server 1: `019ffeb6-d53e-7762-9367-68eee17b65e0` e
  `019ffeb6-d4f7-778f-9fc9-a788227fb361`;
- Server 2: `019ffeb6-d528-75da-a684-3221721d10c8` e
  `019ffeb6-d4a9-7443-b028-e5e7e15645b8`.

Baileys, WhatsMeow e runtimes ativos não foram recriados nesse rollout. A
campanha 50× permanece bloqueada até um novo canário confirmar: evento
`handoff.reseal_skipped_by_reload_continuity`, uma única inicialização Signal,
zero retry/QR/operação residual e health JetStream sustentado.

### Canário real `1.34.100`: conteúdo igual com ordem relacional diferente

O canário visual seguinte usou o worker
`019ffb4e-1456-747b-8197-f19abb1eafe1`. WWebJS → Baileys concluiu no handoff
`19859b37-feae-4109-9355-7204f2c01865`, revisão `3132 → 3133`, em
`29,220s` no backend e `35,297s` até a interface sustentada. A volta
Baileys → WWebJS concluiu no handoff
`70ed72fb-cb7a-4b4d-a17b-0499d7082fbb`, revisão `3133 → 3134`, em
`153,613s` no backend e `196,736s` até a interface sustentada. Ambos ficaram
em `attempt_count=0`, `recovery_state=none`, sem QR e com o fingerprint
`cabb522a5dbcb0c2c28aef43cd9403dcb0c246cab82c5f72a165e451ebab9700`
preservado. O retorno terminou `CONNECTED`, health `Session ready`, ACK central
e zero operação residual, mas está reprovado para a campanha de performance e
não conta entre os cinquenta sucessos.

A `1.34.100` comprovou corretamente reload único, registro presente, nenhum
reparo, zero handshake e socket `UNLAUNCHED`. O bloqueio anterior foi removido,
mas a reutilização do perfil ainda foi recusada antes desse gate:

- o perfil WWebJS reutilizável foi restaurado e seu fingerprint foi
  reassociado à revisão `3134`;
- `preserve_existing_app_state=false` fez a primeira importação entrar em
  `deferred_authenticated_full_sync`;
- ocorreram duas limpezas Signal, `43,766s` e `45,548s`;
- só depois o launch oficial offline e a conexão protegida terminaram.

A causa é a prova secundária de app-state: o checksum durável legado respeita
a ordem dos arrays, embora as linhas venham de tabelas PostgreSQL sem ordem
intrínseca. O resolver encontrou corretamente um anchor cujo conteúdo de
app-state era igual, mas uma segunda leitura das mesmas linhas em ordem
diferente produziu outro checksum e invalidou a reutilização. Isso não é drift
de sessão nem incompatibilidade Baileys/WWebJS.

A correção em validação mantém o checksum legado intacto para continuar
validando anchors existentes e acrescenta uma equivalência semântica
determinística, ordenada pelo conteúdo canônico de cada linha, somente para a
segunda prova de reutilização. A telemetria
`handoff.reusable_profile_app_state_equivalence_evaluated` registra apenas os
booleanos `authority_present`,
`legacy_order_sensitive_checksum_matched`, `semantic_checksum_matched` e
`preserved`. Conteúdo diferente continua reprovado. A regressão permuta linhas
idênticas e exige aceite; em seguida altera um byte da chave e exige rejeição.
As três suítes críticas passaram `379/379`, além de lint, Prettier, web-cache,
auditoria de 158 arquivos e dry-pack. A suíte global opcional exige a variável
externa `WWEBJS_TEST_REMOTE_ID`; sua ausência não substitui nem invalida as
suítes autônomas executadas.

Proveniência da correção `1.34.101`:

- fork `fa9a2be6` — equivalência semântica de app-state e regressões positiva e
  negativa;
- fork `e8b54099` e tag `v1.34.101` — release
  `@wwebjs/whatsapp-web.js@1.34.101`;
- shasum `0c6011f7ce322161cf5dc6bbac69b16712902e66`;
- integridade
  `sha512-zzNANZhSLelpjRt9YkA53HsQxI8Si+DCNiSl2Hh8oNowWRIuWyueTU8pYdglPoNQ9JRgNaBEIUyDrNDSXPwnmA==`;
- Underchat `a2163410f`: pacote real `1.34.101`, frozen-lockfile, `26/26`
  suítes e `417/417` contratos WWebJS e build TypeScript do worker aprovados.

O build visual somente WWebJS `v20260814053722429`, job
`019ffec6-63fd-732f-9873-9079f3a7db85`, iniciou em
`2026-08-14T05:37:22.624Z` e terminou em `05:43:14.098Z`, duração
`5m51,474s`. A imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814053722429`
tem digest
`sha256:f84b84f2dbf09636f96697c05d62f9484c327924ef470acd17884fd99f32007c`.
O pull sequencial confirmou `latest=release` nos dois servidores. A recriação
visual filtrou exclusivamente `Opção 2 (Navegador)` e gerou quatro pools
`ready`, todos no pacote `1.34.101` e no digest exato:

- Server 1: `019ffed1-4534-735a-bb6e-84092776653a` e
  `019ffed1-4512-7319-92dc-32b1ca6f0100`;
- Server 2: `019ffed1-44f9-70d9-9ec0-2c4bf52f478c` e
  `019ffed1-44b8-759b-8bbc-5ec758759402`.

Baileys, WhatsMeow, Balance API e runtimes ativos não foram recriados nesse
rollout.

### Canário real `1.34.101`: app-state preservado, bulk Signal ainda apagado

O canário visual seguinte também não conta entre os cinquenta sucessos. A ida
WWebJS → Baileys concluiu no handoff
`479716ed-ac5c-46eb-9dee-2d9af9a0967d`, revisão `3134 → 3135`, em
`17,841s` no backend e `33,897s` até a interface sustentada. A volta
Baileys → WWebJS concluiu no handoff
`c9c0cdc4-295d-4f94-9015-8fcd38282d09`, lifecycle
`019ffed3-80a3-729f-a02f-21a06071ef74`, revisão `3135 → 3136`, em
`87,088s` no backend, `95,109s` até o primeiro estado funcional e `130,117s`
até a janela sustentada. Ambos ficaram em `attempt_count=0`, sem recovery ou
QR, com fingerprint preservado, ACK central, health `Session ready`, ingress
JetStream e zero operação residual.

A telemetria do trace `f9dc823d-f542-4a65-8688-2fb46c3dc118` provou que a
correção anterior entrou no caminho esperado:

- autoridade reutilizável presente;
- checksum legado diferente somente pela ordem;
- checksum semântico igual e `preserved=true`;
- `app_state_import_mode=preserved_native_profile`;
- reload único, zero handshake e
  `handoff.reseal_skipped_by_reload_continuity`.

Mesmo assim, a primeira importação ainda gastou `43,973s` em
`clear_signal_tables`. Uma comparação independente entre a projeção do perfil
preservado (`3134`) e a projeção final (`3136`) mostrou igualdade semântica em
todas as tabelas relevantes: dispositivo, `334` identidades, `2.523` prekeys,
PQ vazio, `7` sessões Signal, sender keys vazias, `7` sync keys, `5` versões e
`1.030` mutation MACs. O código apagava e regravava esse conteúdo idêntico por
conservadorismo; o bulk não era a causa, pois a escrita das prekeys levou menos
de um segundo depois da limpeza.

### Correção estrita `1.34.102`: preservar bulk Signal somente após readback

A otimização não confia apenas no anchor nem no checksum PostgreSQL. Depois de
restaurar o perfil WWebJS autorizado, o browser exporta uma projeção canônica
**nativa e completa**. O fork compara semanticamente dispositivo, identidades,
prekeys clássicas/PQ, estado PQ, sessões Signal e sender keys com a projeção de
entrada. Só com igualdade exata preserva as quatro tabelas volumosas
identity/prekey/session/sender e qualquer tabela PQ equivalente. Registro,
base key, meta e signed prekey continuam sendo limpos, regravados, lidos de
volta e selados antes do reconnect.

Qualquer ausência de autoridade, erro no readback ou diferença de um byte
mantém o `full_replace` anterior. Conexão direta, QR, recriar, replay, recovery,
perfil novo e app-state não autorizado não entram nesse caminho. A telemetria
`handoff.reusable_profile_signal_table_equivalence_evaluated` contém somente
booleanos; falha de leitura usa o código fixo
`wwebjs_reusable_profile_signal_projection_unavailable`, sem texto bruto,
checksum ou segredo.

Proveniência e gates:

- fork `8bcd4357` — readback semântico e preservação seletiva;
- fork `e2e2bbdd` e tag `v1.34.102` — release
  `@wwebjs/whatsapp-web.js@1.34.102`;
- shasum `75ad6b8c878fd249362490d9df081f734e7b60d6`;
- integridade
  `sha512-aJTkbQuFKXJAfV0diA9NIbMhMVGncPvVF2cMmH7/M4KbQlySbUu3qnxAgWY6ypRAeRdRrJoMZIOWXQi9xpXoPg==`;
- fork: `387/387` testes das quatro suítes críticas, lint, Prettier, web-cache,
  auditoria de 158 arquivos, prepack e dry-pack aprovados;
- Underchat `de1bbdc57`: pacote real `1.34.102`, frozen-lockfile, `33/33`
  suítes e `453/453` contratos WWebJS selecionados e build TypeScript do worker
  aprovados.

O build visual somente WWebJS `v20260814061843251`, job
`019ffeec-3eb3-772e-9fa4-78eb0f300a7e`, iniciou em
`2026-08-14T06:18:43.272Z` e concluiu em `06:24:48.804Z`, duração
`6 min 05,532 s`. A imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814061843251`
tem digest imutável
`sha256:3eca6160ea1b7789279caf2e1138c28772f967984d1271f1bc4e83f153e2b7f3`.
O pull foi comprovado sequencialmente nos dois servidores. O Server 1 estava
com o filesystem em `100%`; a remoção restrita a imagens sem nenhum contêiner
associado recuperou `15,67 GB` e deixou o filesystem em `69%`, sem remover ou
reiniciar os 16 contêineres ativos. Depois do pareamento visual e da recriação
filtrada somente para `Opção 2 (Navegador)`, os quatro pools `1.34.102` ficaram
`ready` no digest exato:

- Server 1: `019ffefe-7fa8-714e-a172-bd390c803dd8` e
  `019ffefe-7f90-72af-8a59-afa2a99eaec0`;
- Server 2: `019ffefe-7f78-756f-a167-cf0df775454d` e
  `019ffefe-7f58-767a-875b-b7f007d4fbd2`.

### Canário `1.34.102` reprovado e correção fail-closed `1.34.103`

O canário visual WWebJS → Baileys → WWebJS foi funcional e seguro, porém não
foi contabilizado por performance. WWebJS → Baileys usou o handoff
`107cc61d-305c-4639-85bc-6a903c524ea3`, revisão `3136 → 3137`, tentativa zero,
sem recovery/QR e preservando fingerprint, mas concluiu em `77,240 s` no
backend (`83,253 s` até a tela funcional). Baileys → WWebJS usou
`2f405c99-696e-4d9c-9d31-9b8d9b4dec53`, revisão `3137 → 3138`, também com
tentativa zero, sem recovery/QR, ACK central e health JetStream sustentado,
mas levou `90,335 s` no backend (`99,723 s` até a tela funcional).

A telemetria da volta, trace
`ff8ed6e5-c6c2-41c7-a065-8baf5de1dc8b`, provou que a otimização não havia sido
admitida. A equivalência de app-state já estava autorizada e preservada, mas o
readback canônico completo do perfil reutilizável encontrou somente o blocker
transitório `app_state_sync_keys.read_failed`. Como a primeira implementação
exigia também app-state legível durante a segunda prova, ela fez fallback
seguro para `signal_table_import_mode=full_replace`; o estágio
`clear_signal_tables` consumiu `44,045 s` dos `45,140 s` da importação.

A `1.34.103` separa corretamente as provas: a equivalência de app-state
continua sendo validada primeiro contra a autoridade do anchor, enquanto o
readback usado para preservar tabelas Signal aceita **somente** blockers da
overlay de app-state já autorizada. Qualquer blocker ou diferença em device,
identity, prekeys clássicas/PQ, estado PQ, sessões Signal ou sender keys ainda
falha fechado e mantém o `full_replace`. Assim, a correção serve igualmente às
origens Baileys e WhatsMeow sem flexibilizar material criptográfico e sem
alterar conexão direta, QR, recriação, replay, recovery ou perfil novo.

Proveniência e gates desta rodada:

- fork `93e48ca7` — isolamento do readback Signal;
- fork `9d6f05a8`, tag `v1.34.103` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.103`;
- shasum `8c77c3042d00a1728eaa6fd4a2ade2a386899fc9`;
- integridade
  `sha512-XMW/Yt3HuKkrLGPOYjPwf5f3g0ILotBWv7ujxHJGBm2AYszcAu6fLWTmaiBQ+XR6UDHYowNuqhr61o9V8iX5Mg==`;
- fork: `387/387` testes das quatro suítes críticas, lint, web-cache,
  auditoria de 158 arquivos, prepack e dry-pack aprovados;
- Underchat `6d2416837`: pacote real `1.34.103`, frozen-lockfile,
  `32/32` suítes e `473/473` contratos WWebJS selecionados, ESLint focado e
  build TypeScript do worker WWebJS aprovados.

A imagem somente WWebJS `v20260814065424263`, job
`019fff0c-ea07-742a-8f7b-4e69e89b5b1a`, foi construída pela interface entre
`2026-08-14T06:54:24.281Z` e `07:00:34.694Z` (`6 min 10,413 s`). O digest
imutável é
`sha256:8671fe02c0e46b8cc1a1db5671660b7c194a1256fcd18a188519ac88ca202939`.
O pull foi comprovado nos dois hosts. No Server 2, a primeira transferência
ficou sem progresso por mais de cinco minutos; somente o processo daquele pull
foi encerrado, sem reiniciar contêiner algum, e a repetição concluiu de imediato
reutilizando as camadas válidas.

Depois do pareamento visual e da recriação filtrada para exatamente os quatro
pools `Opção 2 (Navegador)`, a interface voltou a mostrar 16 pools prontos e a
inspeção dentro dos novos contêineres comprovou pacote `1.34.103` e o digest
acima:

- Server 1: `019fff1c-d296-7607-8e87-e9761a3c0979` e
  `019fff1c-d27f-7238-b668-c951c13ebfdf`;
- Server 2: `019fff1c-d267-70dd-ab2e-ccdad9da6cca` e
  `019fff1c-d248-73cf-a95b-ffd5c81c7666`.

A campanha 50× continua bloqueada somente até um novo canário comprovar
`semantic_checksum_matched=true`,
`signal_table_import_mode=preserved_equivalent_bulk_tables`, ausência do
estágio lento `clear_signal_tables`, tentativa zero, nenhuma recuperação/QR e
health JetStream sustentado. Nenhuma execução reprovada acima entra na
contagem oficial.

### Canário `1.34.103` reprovado: alias de domínio no JID do dispositivo

O primeiro canário após o rollout também não entra na contagem. A ida
WWebJS → Baileys, handoff `1e0c2520-8821-4514-beec-457e7254dab1`, revisão
`3138 → 3139`, concluiu funcional em `24,336 s` no backend e `30,618 s` na
interface, tentativa zero e sem recovery/QR. A volta Baileys → WWebJS,
handoff `06be1e57-79ce-4542-b482-9b866cd4f2d7`, revisão `3139 → 3140`,
atingiu o limite visual de cinco minutos e permaneceu em ativação protegida;
nenhuma ação destrutiva foi executada.

A `1.34.103` removeu corretamente o blocker redundante de app-state, mas a
prova Signal ainda retornou `semantic_checksum_matched=false`. A comparação
por tabela e coluna demonstrou que device, 334 identities, 2.523 prekeys, sete
sessões Signal, app-state e todos os bytes criptográficos eram iguais. A única
diferença era o mesmo JID completo serializado como `@c.us` pelo WWebJS e
`@s.whatsapp.net` pelo canônico socket. O fallback seguro não reutilizou as
tabelas e a ativação posterior terminou repetindo
`wwebjs_canonical_noise_metadata_unavailable`.

A release `1.34.104` corrige somente essa falsa diferença: normaliza os aliases
de domínio `c.us`/`s.whatsapp.net` durante a prova, mas conserva o número, o
sufixo do companion device e todos os campos criptográficos. Um sufixo de
dispositivo diferente e qualquer alteração de chave continuam falhando
fechado. A telemetria agora inclui somente booleanos por componente e a lista
de componentes divergentes, nunca valores nem checksums secretos.

Proveniência e gates:

- fork `4dcf528a` — normalização restrita e telemetria por componente;
- fork `1d20816b`, tag `v1.34.104` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.104`;
- shasum `114c35929a080eed60aec0606737351238291f48`;
- integridade
  `sha512-b80FVVedv1ANL4O5b9mXDvv+YgiXbniEh+y2ON8/CXlA0O5dBinZbRFNe28eFXi2LiSs+XGyHBG+xY/+GBbeew==`;
- fork: quatro suítes críticas `387/387`, teste positivo dos aliases, testes
  negativos de sufixo/chave, lint, Prettier, web-cache, 158 arquivos, prepack
  e dry-pack aprovados;
- Underchat `bdb0d8c1e`: pacote real `1.34.104`, frozen-lockfile, `32/32`
  suítes selecionadas (`482/482` testes), ESLint focado e build TypeScript do
  worker WWebJS aprovados.

Não iniciar a campanha 50× antes de distribuir a `1.34.104`, redirigir com
segurança a ativação acima e aprovar novo canário estrito.

### Segundo blocker pós-PONR e correção WWebJS `1.34.105`

Ao redirecionar a ativação real
`06be1e57-79ce-4542-b482-9b866cd4f2d7` para a imagem `1.34.104`, a prova
criptográfica passou integralmente: os sete componentes Signal ficaram
equivalentes, o app-state foi preservado e não ocorreu `clear_signal_tables`.
O runtime, porém, permaneceu em `activating`. Depois do point-of-no-return a
revisão de destino já estava `active`; em uma retomada por crash/reprovisão,
`requiresNoiseMetadataBootstrap()` aceitava somente revisões
`staging`/`validating`. Assim, a política registrava
`requested=true/effective=false`, repetia
`wwebjs_canonical_noise_metadata_unavailable` dez vezes e entrava no atraso de
reconexão de trinta minutos. Não era lentidão de importação nem divergência de
Baileys/WhatsMeow, mas uma lacuna de retomada durável pós-promoção.

A `1.34.105` habilita o bootstrap de Noise nessa retomada somente quando o
marcador durável de ativação prova, na mesma transação lógica, todos os itens:

- sessão WWebJS `preparing`, revisão de destino ativa e originada por handoff;
- handoff exato em `activating`, depois do PONR, com lifecycle, revisões e
  provedores de origem/destino coincidentes;
- origem estritamente Baileys ou WhatsMeow;
- artefato canônico pronto/checksum válido e projeção sem `provider_state`.

Conexão direta, recriação do mesmo provider, restart ativo ordinário, marcador
ausente, origem não socket e projeção que já possua `provider_state` continuam
falhando fechado. Quando existe marcador pós-PONR, o `RemoteAuth` não consulta
nem combina a política antiga de staging: usa exclusivamente a decisão
assinada pelo marcador. A telemetria acrescenta apenas o booleano
`active_activation_resume`, sem material secreto.

Proveniência e gates antes do rollout:

- fork `0b5799b1` — correção e testes da retomada pós-PONR;
- fork `1e5089fd`, tag `v1.34.105` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.105`;
- shasum `b58788abf5e45866811115aefbb0ae1d0df75e13`;
- integridade
  `sha512-R5OvT7WrpLCzDTJgtOLoG8HDm/UJgrSNs+QQ9XiYs8NkiH7zXaTNSuHOpmvdMq1PyPR89tAAlfrAKisirf7AMA==`;
- fork: quatro suítes críticas `388/388`, casos positivo/negativo do marcador,
  ESLint, Prettier, web-cache, 158 arquivos, prepack e dry-pack aprovados;
- Underchat `c487628be`: tarball real `1.34.105`, frozen-lockfile, `32/32`
  suítes WWebJS selecionadas (`488/488` testes), ESLint do contrato,
  `git diff --check` e build TypeScript do worker aprovados. O lint do diretório
  WWebJS completo ainda encontra somente uma formatação preexistente em
  `buildForwardExtraOptions.ts`, fora deste patch; ela não foi alterada nesta
  rodada.

Ainda não contabilizar esta correção como sucesso da campanha. É obrigatório
distribuir a imagem `1.34.105`, comprovar a retomada real acima, executar um
canário fresco com todas as provas e só então iniciar os blocos oficiais 50×.

#### Rollout e salvamento do incidente real

A imagem somente WWebJS `v20260814080039260`, job
`019fff49-915c-71ee-80b5-6437443a16dd`, foi construída pela interface entre
`2026-08-14T08:00:39.279Z` e `08:06:48.037Z` (`6 min 8,758 s`). O digest
imutável é
`sha256:7e55bc2fab528e809c2faa93497961bc8ae65d19777e3fefecb589d3c03516b7`.
O pull e a tag `latest` foram comprovados separadamente nos dois servidores;
o pareamento visível tornou esta versão default.

Os quatro warms WWebJS foram recriados sob o filtro exato
`Opção 2 (Navegador)` e terminaram prontos com pacote `1.34.105` e o mesmo
digest:

- Server 1: `019fff52-6007-77e8-bac6-7db1b8831158` e
  `019fff52-5fb2-728a-8ec3-5624f45ebfee`;
- Server 2: `019fff52-5ff0-77cc-a914-64f65f80072e` e
  `019fff52-5fd3-719a-ae7b-4fd8a61032cf`.

O journal durável reprovisionou automaticamente o handoff preso para o
container `d0121e81669d...`, geração `47`, pacote `1.34.105`, sem exclusão
manual da sessão. A retomada comprovou:

- `handoff.noise_bootstrap_policy_resolved` com `requested=true`,
  `effective=true` e `active_activation_resume=true`;
- perfil reutilizável restaurado em `623 ms`;
- equivalência positiva dos sete componentes Signal, sem divergências;
- `signal_table_import_mode=preserved_equivalent_bulk_tables`,
  `preserve_existing_app_state=true`, `preserve_existing_signal_tables=true`
  e ausência de `clear_signal_tables`;
- revisão `3140`, tentativa `0`, fingerprint original, nenhum QR/recovery;
- health nativo/JetStream/ACK central verdes e handoff concluído às
  `2026-08-14T08:13:31.370Z`; interface mostrou o canal conectado em
  `Opção 2 (Navegador)`.

Os `3500,232 s` armazenados no handoff incluem todo o período em que o
incidente permaneceu parado nas imagens antigas; não representam a duração da
retomada `1.34.105`. Esta recuperação valida o blocker, mas continua excluída
da amostra oficial porque não foi uma migração fresca.

#### Canário fresco `1.34.105` aprovado

Antes da amostra oficial foi executada, no navegador Playwright visível, uma
dupla fresca WWebJS → Baileys → WWebJS sobre as revisões `3140 → 3141 → 3142`:

- WWebJS → Baileys: handoff
  `8e2bd7cc-c8d8-447e-9485-d893d703c6ba`, tentativa `0`, sem recovery/QR,
  `44,543 s` no backend, `50,788 s` até a tela funcional e sustentação por
  mais `10 s`;
- Baileys → WWebJS: handoff
  `8aa96439-41c2-4f20-a5d9-42a18e3868c2`, tentativa `0`, sem recovery/QR,
  `88,164 s` no backend, `96,485 s` até a tela funcional e `131,496 s` até
  concluir toda a sustentação/prova;
- volta WWebJS com health `CONNECTED`, sessão pronta, probe `242 ms`, geração
  `49` e ingress `WorkerCommandJetStreamIngressService` autorizado;
- sete componentes Signal equivalentes,
  `signal_table_import_mode=preserved_equivalent_bulk_tables`,
  `app_state_import_mode=preserved_native_profile` e nenhuma limpeza
  destrutiva.

Este canário também não entra nas cinquenta execuções. A amostra oficial
Baileys ↔ WWebJS pode começar a partir da revisão `3142`; qualquer falha deve
parar a série e não pode ser contabilizada como sucesso.

#### Primeira série oficial interrompida por lacuna de evidência e release `1.34.106`

A primeira série oficial sobre a `1.34.105` foi interrompida, sem continuar
contando resultados, no retorno do terceiro par. Antes da interrupção houve
dois pares completos aprovados e a ida do terceiro par aprovada:

- duas migrações WWebJS → Baileys completas, mais uma terceira, todas em
  tentativa `0`, sem QR/recovery e com os gates funcionais verdes;
- duas migrações Baileys → WWebJS completas com prova terminal;
- o terceiro retorno, handoff com prefixo `10f79634`, trace
  `02ddc0de-2d9f-4c98-ad42-86364894c54d`, revisão `3147 → 3148`, concluiu
  funcionalmente em `88,665 s`, tentativa `0`, mas foi excluído porque faltou
  o evento terminal de auditoria.

A inspeção não encontrou regressão de compatibilidade nem alternância errada
entre a política de origem Baileys e a de origem WhatsMeow. O evento de
equivalência comprovou os sete componentes Signal iguais e
`preserved=true`. O estágio `clear_signal_credential_tables` observado nessa
execução limpa somente credenciais base/metadados/signed-prekey que precisam
ser resselados; ele não é o caminho destrutivo `clear_signal_tables` e não
remove identities, prekeys, sessions ou sender keys.

A causa foi observabilidade: os progressos eram emitidos com `force=true`, mas
o evento terminal `browser_bridge.canonical_projection_imported` ainda podia
ser descartado pelo sampling depois de handoffs repetidos. A `1.34.106` força
somente esse evento terminal. Não altera importação, equivalência, fallback,
limpeza, promoção ou política fail-closed. Um teste do fork exige agora que a
prova terminal contenha os modos efetivos de preservação e a opção
`{ force: true }`.

Proveniência e gates antes do novo rollout:

- fork `649d5719` — retenção da prova terminal;
- fork `d22913ce`, tag `v1.34.106` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.106`;
- shasum `ef40bbaba73cee7562da205737b4e60a9f93ac3c`;
- integridade
  `sha512-plU6nec4rP1wpGTFMuTyArsYwoLtka9fjpR7/0/le8BwquH4paeK7xSo/aEF9DzhLjJx7jk5eJK5RUhgHzgp+Q==`;
- fork: quatro suítes críticas `388/388`, lint, Prettier, web-cache, verificação
  dos 158 arquivos, prepack e dry-pack aprovados;
- Underchat `afbc0673b`: tarball real `1.34.106`, frozen-lockfile, `32/32`
  suítes selecionadas (`443/443` testes), ESLint do contrato,
  `git diff --check` e build TypeScript do worker WWebJS aprovados.

Os cinco resultados oficiais completos anteriores são evidência diagnóstica,
mas serão excluídos do total final. Depois do rollout da `1.34.106`, reiniciar
uma amostra limpa de cinquenta pares para que os cem resultados
Baileys ↔ WWebJS pertençam ao mesmo artefato e todos tenham prova terminal não
amostrada.

#### Rollout `1.34.106` e canário que revelou uma âncora nativa defasada

A imagem somente WWebJS `v20260814083959372` foi construída pela interface e
publicada com digest imutável
`sha256:7c6b14a6dd86216f3933583f471a82349763570f708bc8557ed588ef2a6faed3`.
Depois de um pull inicialmente preso no Server 1, somente os processos daquele
pull foram cancelados. A remoção restrita a imagens sem contêiner associado
recuperou `10,45 GB`, deixando `14 GB` livres, sem excluir ou reiniciar runtime
ativo. As tags Socket usadas pelos pools foram repostas e comprovadas pelos
digests anteriores. O pull WWebJS foi repetido nos dois hosts e os quatro warms
ficaram `ready`, todos com `@wwebjs/whatsapp-web.js@1.34.106` e o digest acima.

O canário fresco seguinte foi funcional e seguro, mas não entra na contagem:

- WWebJS → Baileys: handoff
  `2a1e186a-53e6-4590-b214-e242099254df`, revisão `3148 → 3149`, tentativa
  zero, sem QR/recovery, `17,868 s` no backend e `23,350 s` até a UI;
- Baileys → WWebJS: handoff
  `51033f1b-387d-454b-a909-c2bca910cb67`, revisão `3149 → 3150`, tentativa
  zero, sem QR/recovery, `90,503 s` no backend; terminou online, saudável, com
  fingerprint e ACK preservados.

A `1.34.106` cumpriu seu objetivo: o evento terminal forçado ficou disponível
no trace `bb78509c-3ea5-4fb6-a083-e40ada7df7f4`. Ele também tornou auditável
uma causa de performance distinta. A volta aprovou a autoridade de app-state,
mas encontrou diferença apenas em `signal_sessions`; os outros seis
componentes Signal eram iguais. O caminho seguro executou `clear_signal_tables`
em aproximadamente `45,495 s`, importou novamente as sete sessões e conectou
sem nova autenticação. Não relaxar essa igualdade nem forçar preservação:
diante de uma diferença real, o full replace é o comportamento correto.

A comparação das revisões provou que Baileys não alterou indevidamente as
sessões. As sete `whatsapp_signal_sessions` da revisão `3149` tinham a mesma
contagem e checksum das que o WWebJS exportou na revisão `3148`. A divergência
existia entre dois retratos do próprio WWebJS: a projeção canônica fresca e o
artefato Chromium antigo usado como âncora imutável. O handoff atual congela a
rede, exporta a projeção atual, encerra Chromium e associa essa projeção à
última âncora verificada; portanto o perfil físico pode ficar atrás das sessões
Signal que acabou de exportar. Na volta, a prova semântica detecta corretamente
essa defasagem e cai no caminho completo.

A correção candidata fica estritamente limitada à saída ativa WWebJS → Socket:
com a rede já quiescida, congelar o lifecycle Chromium, persistir artefato
nativo e projeção canônica do mesmo instante, revalidar o snapshot e só então
encerrar o navegador e publicar a prova de handoff. Falha antes do point of no
return deve conservar a âncora anterior, reativar o lifecycle ainda offline e
restaurar a origem. Conexão direta, QR, recriação do mesmo provider, startup,
rollback e entrada Socket → WWebJS não podem ganhar esse checkpoint adicional.
Também é obrigatório manter a ordem do rollback PQ na saída para WhatsMeow.

Não reiniciar a série oficial na `1.34.106`. Primeiro provar essa correção em
testes fail-closed do fork, publicar uma nova release, distribuir todos os pools
WWebJS e executar um canário fresco nos dois sentidos. Somente depois reiniciar
do zero as cinquenta execuções por direção.

#### Correção publicada: checkpoint coerente pós-Chromium na `1.34.107`

A solução final não copia LevelDB enquanto o navegador está vivo. O WWebJS
continua quiescendo a rede e exportando a projeção canônica antes do point of no
return; depois encerra Chromium e somente dentro de
`PostgresSessionStore.prepareHandoff()` captura o diretório agora estável. O
`checkpointProfile()` persiste artefato e projeção canônica na mesma transação,
gera uma nova âncora `full_profile_plus_fresh_canonical_v1` e só então a prova
do handoff é publicada. Isso fecha a defasagem temporal sem uma janela de
escrita concorrente do renderer.

O escopo é intencionalmente estreito:

- somente revisão ativa em saída WWebJS → Baileys/WhatsMeow recebe
  `profilePath` e a projeção canônica correspondente;
- startup, conexão direta, QR, recriação WWebJS, checkpoints periódicos,
  shutdown comum e entrada Socket → WWebJS não mudaram;
- `prepareHandoff()` rejeita `profilePath` sem a projeção canônica exata;
- qualquer erro de checkpoint permanece fail-closed, exceto
  `whatsapp_artifact_profile_too_large` com `size_bytes > max_bytes`
  estruturalmente válidos; somente esse caso reutiliza a âncora verificada e
  registra o fallback explicitamente;
- na saída para WhatsMeow, intenção de rollback PQ, RPC oficial, ACK durável,
  export e persistência do rollback continuam ocorrendo antes de Chromium ser
  encerrado e antes do novo checkpoint.

A prova `provider_handoff_checkpoint` e a telemetria `handoff.prepared` passam
a registrar modo, duração, tamanho e bytes enviados/reutilizados. Esses campos
permitem distinguir um checkpoint incremental curto de um fallback antigo sem
logar chave, checksum criptográfico ou conteúdo de sessão.

Proveniência:

- fork `bd92feb0` — checkpoint coerente, fallback limitado, telemetria e cinco
  novos contratos (incluindo a ordem PQ completa);
- fork `ca9dd299`, tag `v1.34.107` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.107`;
- shasum `2cfc1dfe51e53b713960bd6a6b51dccde5c96496`;
- integridade
  `sha512-U8izDRufnSLbtrPt4sVe3NV5lZdWvw1q2MZe8C5WXhM5yvA+HdXnp1K8KzdwojGvsZbG1rQhhTVLf6OCk1KUGg==`;
- fork: `393/393` testes nas quatro suítes críticas, lint integral, Prettier,
  cache web, auditoria dos 158 arquivos, prepack e dry-pack aprovados;
- Underchat: pacote real `1.34.107`, `34/34` suítes e `465/465` contratos
  ampliados aprovados, ESLint focado e build sem cache do worker WWebJS
  aprovados.

#### Rollout isolado da `1.34.107`

O build visual somente WWebJS `v20260814092719462`, job
`019fff98-eaa6-70a7-b246-87c019b0381b`, iniciou em
`2026-08-14T09:27:19.497Z` e concluiu sem erro em `09:33:42.528Z`
(`383,031 s` de job; `369,393 s` no comando de build). A imagem publicada e
definida como default é
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814092719462`,
digest imutável
`sha256:ea51797215549fe9f432e5f32f445ac19dbe6e06e1d0d44639fc6f33d242e1dd`.

O pull foi sequencial: Server 1 terminou e teve digest conferido antes do
início no Server 2. A interface visual de **Canais aquecidos** foi filtrada
exclusivamente por `Opção 2 (Navegador)` antes de **Recriar Todos**. Os quatro
novos pools terminaram `Pronto`, dois por servidor, no digest acima e com
`@wwebjs/whatsapp-web.js@1.34.107`:

- Server 1: `019fffa4-6d65-7668-9637-fd5cb76ef06f` e
  `019fffa4-6d27-73a2-9d9e-84894210c116`;
- Server 2: `019fffa4-6d97-700d-9e3f-ab100c7345b3` e
  `019fffa4-6d7b-76ad-a5c2-d8b9c1bda8d3`.

No Server 2, depois que os novos pools já mantinham o digest em uso, a remoção
restrita a imagens sem contêiner associado recuperou `28,73 GB` e elevou o
espaço livre de `3,2 GB` para `30 GB`. Como `docker image prune -a` remove tags
`latest` mesmo quando conserva os IDs usados, as tags de Baileys, WhatsMeow e
WWebJS foram imediatamente repostas e comparadas com seus digests esperados.
Nenhum contêiner ativo foi removido ou reiniciado.

Antes do canário, o runtime WWebJS ainda ativo na `1.34.106` foi recriado pelo
fluxo normal da interface, sem troca de provider. A ação começou em
`2026-08-14T09:43:57.747Z`; o novo runtime geração `58`, contêiner
`13ae3c17fa69076942620918a9c0ffafd8009b5eeb0c8916e660f92f6e3fdf42`,
entrou nativamente online em `09:46:03.110Z` (`125,363 s`) e a UI foi observada
em `Conectado` às `09:46:24.587Z`. O contêiner usa exatamente o digest da
`1.34.107`. Depois de mais de um health-check, permaneceu `Session ready`,
transporte `CONNECTED`, envio/recepção permitidos, ACK central e ingresso
JetStream ativos, fingerprint preservado, sem QR e sem operação ativa. Essa
prova confirma que o checkpoint adicional, limitado à saída cross-provider,
não regrediu a recriação WWebJS normal.

A release ainda não entra na campanha autoritativa até concluir o canário
fresco WWebJS → Baileys → WWebJS. Nesse canário, exigir no outbound
`full_profile_plus_fresh_canonical_v1`; na volta, exigir os sete componentes
Signal equivalentes, `preserved_equivalent_bulk_tables`, ausência de
`clear_signal_tables`, tentativa zero, sem QR/recovery e
health/ACK/JetStream sustentados. O auditor temporário rejeita qualquer linha
que não contenha esse checkpoint coerente e os campos de duração, tamanho e
bytes enviados/reutilizados.

#### Primeiro canário `1.34.107`: rotação bloqueada com segurança

O primeiro WWebJS → Baileys depois da recriação não foi contado. O handoff
`01a06e0d-e02c-4374-b8ee-09f30d6cf01b`, revisão pretendida `3150 → 3151`,
falhou antes de persistir checkpoint ou promover destino, em `3,005 s`, com
tentativa zero. A recuperação automática manteve a revisão `3150`, elevou o
runtime WWebJS para a geração `59` e terminou novamente online, autenticado,
sem QR, com ACK, fingerprint e sessão preservados. Não houve estado parcial no
Baileys.

O `error_code` persistido como `whatsapp_session_lease_lost` não descreveu a
causa real. O gRPC registrou `FAILED_PRECONDITION` com
`previous WWebJS profile anchor is still protected by a handoff`. A revisão
`3150` tem uma âncora ativa geração `2` e uma anterior geração `1`; a anterior
continua referenciada pelo `pre_activation_artifact_id` do handoff já concluído
Baileys → WWebJS `51033f1b-387d-454b-a909-c2bca910cb67`. A função SQL de
checkpoint permite no máximo uma âncora `previous` e, corretamente para um
handoff ainda recuperável, recusa apagá-la quando existe essa referência. A
lacuna é que a referência de um handoff **concluído e sem recovery** nunca é
liberada, bloqueando para sempre a próxima captura nativa coerente.

A correção não deve afrouxar o bloqueio nem reutilizar silenciosamente a âncora
defasada. A direção escolhida é liberar, na mesma transação da nova rotação,
somente a proteção pertencente a handoff terminal `completed`, destino WWebJS,
mesma revisão e `recovery_state=none`. Qualquer handoff ativo, falho,
recuperável ou com linhagem diferente continua bloqueando. Se o commit do novo
checkpoint falhar, a transação também desfaz a liberação. A telemetria também
deve deixar de traduzir essa precondição como perda de lease.

#### Correção publicada: liberação terminal e rotação atômica na `1.34.108`

A lacuna foi corrigida sem reduzir a proteção de rollback. A migração
`20260814095500.sql` adiciona
`commit_wwebjs_profile_anchor_checkpoint_v2`, que somente atua durante uma
rotação `full_profile_plus_fresh_canonical_v1`. Ela bloqueia por CAS a âncora
ativa e a única âncora anterior e libera `pre_activation_artifact_id` apenas
quando **todas** as referências são handoffs `completed`, com destino WWebJS,
mesma revisão alvo, point of no return e `completed_at` presentes e
`recovery_state=none`. Handoff ativo, falho, em recovery ou de outra linhagem
continua falhando com
`wwebjs_profile_anchor_previous_protection_active`.

Depois da liberação, v2 delega a validação e a rotação para v1 dentro da mesma
instrução SQL. Portanto, qualquer erro de artefato, checksum, projeção
canônica, lease, escopo ou CAS em v1 desfaz também a liberação anterior. V1 não
foi relaxada. A função nova não é executável por `PUBLIC` e foi concedida
somente a `whatsapp_session_runtime`. O handler central passou a classificar o
código estável como falha terminal pós-encerramento do Chromium, evitando a
telemetria incorreta de lease perdido.

O instalador standalone do fork também foi alinhado à migração canônica: além
de v2, agora contém a limpeza fail-closed de âncora anterior que já existia no
banco do Underchat. Isso evita comportamento diferente em instalações novas.
A instalação foi executada duas vezes concorrentemente e depois outra vez em
um banco PostgreSQL temporário real: permaneceu idempotente, com RLS e
privilégios default-deny. O banco temporário foi removido após a prova.

Proveniência desta correção:

- fork `2778c1b8` — rotação de proteção terminal;
- fork `169aa3ee`, tag `v1.34.108` — release publicada;
- pacote `@wwebjs/whatsapp-web.js@1.34.108`;
- shasum `948294ad202174b03e7c50196496f5ebc2db8341`;
- integridade
  `sha512-UwDreuHroLmGELfTIy++Z9L0a+hOGy9m6GTvXOKJ9H0hmpOtPQT0QAZ/+ByISsZE6gV92VWcXPxdAHTmrGu2vg==`;
- fork: 398 testes críticos aprovados, uma integração opcional inicialmente
  pendente e depois aprovada isoladamente; lint, Prettier, cache web, pacote
  de 158 arquivos, prepack e dry-pack aprovados;
- Underchat: migração aplicada localmente, 543 contratos da fronteira e
  handler aprovados, mais 127 contratos de conexão WWebJS, ESLint,
  `test:locations`, typecheck integral e build sem cache do worker aprovados.

O pacote real `1.34.108` já está fixado no Underchat. Ainda não contar o canário
nem qualquer rodada oficial até a imagem WWebJS correspondente ser publicada,
distribuída aos pools e comprovada pelo primeiro roundtrip fresco.

#### Rollout visual isolado da `1.34.108`

O build visual somente WWebJS `v20260814101603142`, job
`019fffc5-8746-75ab-9934-0aa960c4fb96`, iniciou em
`2026-08-14 07:16:03.160 -03` e terminou em
`2026-08-14 07:21:58.418 -03` (`355,258 s`). A imagem publicada e marcada
como default é
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814101603142`,
digest imutável
`sha256:f624bec99aa97d026ed5d3a0fd8d59feaec76f0208135d7ad72e8de83697a47a`.
O conteúdo da imagem foi conferido no host e contém exatamente
`@wwebjs/whatsapp-web.js@1.34.108`.

Server 1 e Server 2 foram reinstalados pela interface e terminaram `Online`.
No Server 2, o primeiro pull ficou preso no comportamento conhecido do Docker;
ele foi cancelado de forma restrita, repetido com configuração temporária e
concluiu em aproximadamente 38 segundos. A instalação visual foi então
repetida com a imagem em cache e terminou online. Nos dois hosts, `latest` e a
tag imutável resolvem para o mesmo digest acima.

A tela visual de **Canais aquecidos** foi filtrada exclusivamente por
`Opção 2 (Navegador)` antes de **Recriar Todos**. Nenhum pool de Baileys ou
WhatsMeow foi selecionado. Os quatro pools novos ficaram `ready`, dois por
servidor, todos no digest da `1.34.108` e com o pacote conferido dentro do
contêiner:

- Server 1: `019fffdb-73df-73e8-8bde-347d5131352c` e
  `019fffdb-73c2-7189-a82b-aa8956ff05c5`;
- Server 2: `019fffdb-7412-778b-a1cd-2d2c64412139` e
  `019fffdb-73f6-7799-b395-08d326dbe105`.

O runtime ativo do canal de prova passou pela recriação normal, sem troca de
provider, iniciada pela UI em `2026-08-14 07:42:45.783 -03`. A geração `60`,
contêiner
`00f231a1271637b6f06c532dc81ac5ec0ac7bfa019e1149bce577e0e1af77e27`,
publicou o status nativo online em `07:44:48.579 -03` (`122,796 s`) e foi
observada como `Conectado` na tabela às `07:44:58 -03`. O runtime consome o
digest imutável da `1.34.108` e o pacote interno foi conferido como
`@wwebjs/whatsapp-web.js@1.34.108`.

Depois da recriação, `/v1/connection/health/check` respondeu `200`, `Session
ready`, `waState=CONNECTED`, envio e recepção habilitados, autenticação,
readiness, ACK central e ingress autorizado/consumindo com owner
`WorkerCommandJetStreamIngressService`. A revisão ativa continuou `3150`, o
fingerprint permaneceu
`cabb522a5dbcb0c2c28aef43cd9403dcb0c246cab82c5f72a165e451ebab9700`,
sem QR, recovery, handoff ou resolução ativa. Assim, a `1.34.108` não regrediu
a recriação normal antes do canário cross-provider.

#### Canários frescos da `1.34.108` aprovados

O primeiro roundtrip comprovou que a rotação terminal corrigiu o bloqueio sem
afrouxar os gates:

- WWebJS → Baileys, handoff `39124294-6aa2-43e9-aea1-c34f65312ee2`,
  revisão `3150 → 3152`, concluído em `15,250 s`, tentativa zero, sem
  recovery/QR;
- a revisão `3151` havia sido reservada pela tentativa fail-closed anterior;
  por isso o salto até `3152` é monotônico e correto, não perda de revisão;
- a âncora WWebJS avançou para geração `3`, modo
  `full_profile_plus_fresh_canonical_v1`, artefato
  `35760504-2a2c-4fe1-b00d-e5676ab8ae74`, tamanho `14.337.760` bytes e
  checksum idêntico ao checkpoint autorizado do handoff;
- Baileys → WWebJS, handoff `1e67976c-5538-41f5-86d9-19a06fa19824`,
  revisão `3152 → 3153`, concluído no backend em `90,523 s` e na tela em
  `128,482 s`, tentativa zero, sem recovery/QR;
- os sete componentes Signal foram equivalentes, com
  `preserved_equivalent_bulk_tables`, `preserved_native_profile` e sem o
  estágio destrutivo `clear_signal_tables`; health, ACK e JetStream ficaram
  verdes após mais `35 s` de sustentação.

O auditor inicial parou depois da primeira ida por exigir revisão exatamente
`+1`. Esse gate foi corrigido para exigir progressão estritamente monotônica,
pois revisões de tentativas fail-closed continuam consumidas. A prova outbound
também passou a ser lida do artefato durável `provider_handoff_checkpoint`,
cujo manifest contém modo, artefato, duração e bytes enviados/reutilizados.
Ler `handoff.prepared` somente dos logs do runtime atual era insuficiente,
porque o contêiner WWebJS de origem já foi retirado quando Baileys se torna o
runtime ativo.

Um segundo roundtrip, completamente processado pelo auditor corrigido, também
passou:

- WWebJS → Baileys `c1cc60e9-124e-44a2-a4a9-81ccaff78f40`, revisão
  `3153 → 3154`, `21,481 s` no backend, `26,750 s` até a UI e `36,757 s`
  sustentados; checkpoint fresco em `1.297 ms`, perfil `22.962.678` bytes,
  `20.921.613` enviados e `2.041.065` reutilizados;
- Baileys → WWebJS `a341d818-850e-4794-bcaf-9196bb34e26a`, revisão
  `3154 → 3155`, `90,831 s` no backend, `99,220 s` até a UI e `134,224 s`
  sustentados;
- tentativa zero nos dois sentidos, fingerprint preservado, sem QR/recovery,
  sete componentes equivalentes, preservação de app-state/tabelas Signal,
  health `Session ready`, `CONNECTED`, probe `229 ms`, ACK e owner do ingress
  `WorkerCommandJetStreamIngressService`.

Os canários não entram na contagem oficial de cinquenta. A série oficial
Baileys ↔ WWebJS começa na revisão `3155`; qualquer falha funcional ou de
prova interrompe a série e não é contada.

#### Série oficial preliminar e lacuna de reconciliação visual

Quatro pares oficiais completos passaram antes de a quinta saída revelar uma
lacuna exclusivamente visual. Todos os oito handoffs terminaram na tentativa
zero, sem QR/recovery, preservando fingerprint, ACK, sessão, saúde nativa,
JetStream e a equivalência dos sete componentes Signal:

| Par | WWebJS → Baileys                       | Revisão       | Baileys → WWebJS                       | Revisão       |
| --: | -------------------------------------- | ------------- | -------------------------------------- | ------------- |
|   1 | `118e736f-9c8c-4f52-9da9-15827fd3b81a` | `3155 → 3156` | `244a65dc-1c0f-4110-ae42-4bc1ad2777c6` | `3156 → 3157` |
|   2 | `bf06c381-62a3-4f06-85f2-cb1366f2fe86` | `3157 → 3158` | `777963f4-4e56-4888-a76b-ece45b9c2c76` | `3158 → 3159` |
|   3 | `54ab2e97-2659-49b3-a464-68dcf00b2891` | `3159 → 3160` | `1a7cfc53-a48f-40fa-aa35-cf676b407d09` | `3160 → 3161` |
|   4 | `8615c7f1-b3e1-46e3-a5ef-66b2afd2fb7e` | `3161 → 3162` | `ae1abaa9-833f-4df8-bbbc-a34fa0e5a6c4` | `3162 → 3163` |

Tempos de backend das saídas: `30,971 s`, `66,428 s`, `22,547 s` e
`70,483 s`. Tempos dos retornos: `95,934 s`, `91,413 s`, `90,519 s` e
`93,217 s`; cada retorno permaneceu mais 35 segundos sob prova sustentada.
Essas oito execuções são evidência válida, mas a contagem final será reiniciada
sob o código de interface final para que os cinquenta pares comprovem também a
correção abaixo.

Na quinta saída, handoff
`6677ea2a-8335-4e9f-a75e-4c90fc30acd3`, revisão `3163 → 3164`, o backend
concluiu em `37,105 s` e a tabela já mostrava Baileys conectado, porém o modal
continuou em `Operação aceita e aguardando o novo ambiente`. O terminal do
handoff foi publicado antes do ACK nativo online; a primeira consulta correta
recusou encerrar o modal, mas nenhum novo terminal foi emitido depois do ACK.

As duas superfícies web agora reconciliam também cada atualização da lista
autoritativa. Somente quando a própria projeção comprova o worker monitorado,
o provider de destino exato, status online, ACK e conexão nativa online elas
solicitam uma nova leitura terminal do handoff. O monitor já coalesce leituras
concorrentes. Não foi criado timer nem polling, e uma origem restaurada, outro
provider ou um evento antigo não pode liberar o modal. O contrato cobre
`/channels` e `config/channels-tab.vue`; 50 testes focados e `vue-tsc` passaram.

#### Primeiro estado PQ real descoberto depois do rollback visual

Ao retornar a revisão `3164` de Baileys para WWebJS para provar a correção
visual, o handoff `48ac5d90-f804-4500-b47f-ce1877bca5be`, destino reservado
`3165`, falhou fechado em `77,350 s`. A recuperação automática terminou no
Baileys, geração `75`, revisão `3164`, online, autenticado, sem QR, com o mesmo
fingerprint e nenhuma operação ativa. Esta execução não conta como sucesso.

Pela primeira vez nesta série, o Baileys havia materializado `101` prekeys
ML-KEM e o respectivo allocator pós-quântico. Em relação à revisão `3162`,
device, 334 identities, 2.523 prekeys clássicas, sete Signal sessions, sender
key e todo App State permaneceram byte-equivalentes; apenas as tabelas PQ
avançaram. Portanto a repetição seguinte deve usar exatamente esta revisão,
sem apagar/regredir as chaves PQ, e validar o caminho WWebJS completo.

O erro persistido era apenas `handoff_browser_hydration_failed`. A causa
estável já existia como mensagem controlada `wwebjs_*`, mas era reduzida ao
genérico antes de o contêiner-alvo ser removido. O fork `1.34.109` preserva no
rollback e na telemetria somente `error.code` seguro ou uma mensagem que case
estritamente `^wwebjs_[a-z0-9_]+$`; texto arbitrário, segredo e material
criptográfico continuam excluídos. Proveniência: `b534ec75` (correção),
`39727cc9`/tag `v1.34.109` (release), shasum
`1648db6dbe5c49299f720ca825d9b2a2658b38df`. Foram aprovados 393 testes do
fork e 471 contratos Underchat focados. Depois do rollout, repetir a mesma
entrada PQ: se falhar, corrigir o código específico; se passar, ainda exigir
readiness, ACK, equivalência, modal final e 35 segundos sustentados.

Em `2026-08-14`, o critério solicitado para a campanha foi ampliado de dez
para **no mínimo cinquenta sucessos funcionais por direção** em
Baileys ↔ WWebJS e WhatsMeow ↔ WWebJS. Não contam execuções históricas que
terminaram visualmente e degradaram depois, nem repetições sem os gates de
provider nativo, readiness, autenticação, sessão válida, ausência de QR, ACK,
fingerprint, revisão e ausência de operação ativa.

Esta seção será atualizada por blocos durante a execução. Não interpretar uma
linha isolada como encerramento da campanha: a conclusão exige cinquenta sucessos em
cada uma das quatro direções Socket ↔ WWebJS, a matriz Baileys ↔ WhatsMeow,
recriação normal dos três providers e os gates automatizados finais.

#### Segundo canário da revisão 3164: sender-key público opcional

Depois de resolver explicitamente a falha histórica com **Retornar com
segurança** — fechar o X somente oculta o modal e não conclui a resolução
humana — a mesma revisão PQ `3164` foi submetida novamente ao WWebJS. O handoff
`67a8eeed-4e42-4647-9968-bd982f2af424`, lifecycle
`01a00027-8b88-71a5-8f0c-b6bac09fb970`, reservou a revisão `3166`, preservou o
fingerprint e produziu um checkpoint de `4.220` registros, `528.498` bytes e
checksum `6db78b…`. Ele falhou fechado antes do ponto sem retorno, na tentativa
zero e em `77,441 s`, com a nova telemetria específica
`wwebjs_ci.sender_key_validation.sender_key_incompatible`. A recuperação
automática devolveu o canal à revisão `3164`, online, ACK/autenticação/sessão
verdes, sem QR ou operação ativa.

A inspeção estrutural, sem registrar bytes de chave, mostrou que as revisões
anteriores traziam um sender-key de `82` bytes e um estado. A revisão `3164`
trazia `167` bytes e dois estados. O segundo é um estado público remoto válido:
chain seed de `32` bytes, signing public de `33` bytes e o campo privado
opcional presente com comprimento zero. O Baileys representava internamente a
ausência como `Buffer.alloc(0)` e o encoder canônico emitia esse campo; o
WWebJS aceita corretamente ausência ou exatamente `32` bytes e recusou zero.
Não era uma falha de PQ nem autorização para apagar sender keys.

A correção mantém o fail-closed nos dois lados:

1. WWebJS normaliza **somente** o campo privado opcional de tamanho zero para
   ausente, preserva todos os estados e continua recusando qualquer tamanho
   não vazio diferente de `32`;
2. decodificação, limite estrutural e parse nativo passaram a ter códigos
   distintos; não envolver um `fail()` controlado em `catch` genérico;
3. Baileys deixa de serializar o campo opcional quando vazio, exige public key
   de `33` bytes e private key de `32` quando presente;
4. nenhuma tabela ou sender-key é limpa, descartada ou reduzida para obter
   compatibilidade.

Proveniência dos forks:

- WWebJS `1.34.110`: correção `74eb857f`, release `2d60c9dc`, tag
  `v1.34.110`, shasum `421f82550aae9f9099e7f53bf3cc8de104edb493`;
- Baileys `1.0.26`: commit `ce733a3b8d`, shasum
  `a536435d36c133859d6d5cedb7f42c4c74d16da4`.

Gates aprovados antes do rollout: `469` testes críticos e lint do WWebJS;
`574/574` testes do Baileys, build do pacote e teste focal que comprova
`[32, ausente]` e rejeita `31` bytes; `171` contratos focados da Underchat e
builds locais dos workers Baileys/WWebJS. O lint global do fork Baileys ainda
aponta débitos preexistentes fora desta alteração; não atribuir esses erros à
normalização nem declarar esse gate global limpo. A campanha oficial de 50
reinicia somente depois do rollout e de um canário aprovado com a própria
revisão `3164`.

#### Canário pós-rollout `3164`: helper fora do realm serializado

O rollout `v20260814122621406` foi instalado nos dois servidores e os pools
foram renovados de forma seletiva. Os quatro pools WWebJS usam a imagem
`sha256:11f6a5f2...` com o pacote `1.34.110`; os oito pools Baileys usam
`sha256:74aba57f...` com `1.0.26`. WhatsMeow não foi recriado nessa operação.

O primeiro canário real Baileys → WWebJS consumiu um desses pools e revelou
uma segunda falha, handoff `2d35f6ab-7f4a-4de2-b844-a561db07a6ed`, revisão
`3164 → 3167`. O checkpoint teve `4.220` registros e `528.498` bytes; a
tentativa zero falhou em `82,665 s`, antes do ponto sem retorno, com
`wwebjs_ci.sender_key_validation.import_sender_key_validation_failed`. A
recuperação automática devolveu Baileys online, autenticado, ACK verdadeiro,
sem QR e sem operação residual. Esta execução não conta na campanha.

A causa não era outro formato criptográfico. `importCanonicalSessionProjection`
é serializada pelo Puppeteer e executada no realm da página, mas a normalização
adicionada em `1.34.110` havia sido declarada no escopo do módulo Node. A chamada
virava `ReferenceError` somente no browser; o teste unitário direto mantinha a
closure disponível e, por isso, não reproduzia. A proteção fail-closed converteu
corretamente a exceção opaca no código de estágio acima.

Regra contra regressão: todo helper usado por uma função enviada a
`page.evaluate()` deve existir dentro da própria função serializada ou ser
fornecido explicitamente como argumento. O teste do importador agora recria a
função a partir de `toString()`, importa um sender-key de dois estados no realm
sem closures, prova que apenas a private key remota vazia é omitida, preserva a
private local de `32` bytes e continua recusando `31` bytes antes de qualquer
escrita. Um canário aprovado ainda é obrigatório antes de reiniciar a contagem
oficial de cinquenta pares.

Correção publicada: fork `438800af`, release `80518d62`, tag
`v1.34.111`, pacote `@wwebjs/whatsapp-web.js@1.34.111`, shasum
`310cccf8af021319789b66a41194a358898a9ef6` e integridade
`sha512-2SIYdlY+43hjzwAYLPN6WXaR2Z49dk7VPLLFjz5lrN7Wh6rW1f2AYxHe8fH12DHy9jhaOy0cOYHnJ4EOu6xcxg==`.
O fork passou `467` testes críticos, com uma pendência declarada pelo próprio
projeto, além de ESLint, Prettier, verificação dos `158` arquivos do pacote e
do web-cache pinado. O pacote instalado na Underchat foi inspecionado, o
contrato de dependência passou `11/11` e o build TypeScript do worker WWebJS
foi aprovado. Antes desses gates foram encerrados `49` processos Mocha órfãos
de execuções antigas; serviços, containers e sessões não foram tocados. O
rollout seguinte deve substituir apenas WWebJS.

## Atualização autoritativa — recriação normal, JetStream e WWebJS — 2026-08-13

Esta seção é a referência mais recente para o botão **Recriar canal**. Ela não
descreve troca entre providers: recriação normal mantém `worker_id`, provider,
sessão canônica e epoch lógico, aposenta apenas o runtime anterior e ativa uma
geração maior. Todas as referências a Kafka nas seções históricas abaixo são
evidência da arquitetura existente na data em que foram escritas. O caminho
operacional atual de **comandos dos workers** é NATS JetStream; não voltar a
implementar ou operar um fallback Kafka a partir daqueles trechos antigos.

Os três canários reais desta rodada usam a mesma conta e a mesma identidade do
WhatsApp, mas são sessões independentes:

| Canal   | Worker                                 | Provider  | Servidor |
| ------- | -------------------------------------- | --------- | -------- |
| Baileys | `019ffb4e-1456-747b-8197-f19abb1eafe1` | Baileys   | Server 1 |
| Meow    | `019ffb4f-f7bc-7329-a25b-510cf114f679` | WhatsMeow | Server 2 |
| Wwebjs  | `019ffb52-7e9e-71cc-a611-a1e1725ae68c` | WWebJS    | Server 1 |

### Baseline real e causa da diferença

Antes das correções, a recriação normal medida de ponta a ponta terminou em
aproximadamente 10,6 s no Baileys, 3,23 s no WhatsMeow e 131,4 s no WWebJS. Os
providers socket restauravam diretamente a sessão nativa e passavam pelos
gates. O navegador não estava apenas “naturalmente mais lento”: ele repetia
trabalho ou aguardava deadlines inteiros por quatro problemas independentes:

1. uma navegação WWebJS já superada podia rejeitar com `TargetCloseError` e
   derrubar o Chromium saudável da navegação corrente;
2. o evento nativo `ready` ainda reiniciava a grace genérica de 30 s, mesmo
   quando restava apenas reconciliar os gates finais;
3. o scheduler oficial de App State podia ficar imóvel em `inFlight + dirty`,
   sem `pending`, `retry`, `fatal` ou `blocked`, e só falhar após o timeout;
4. o model/backend visual podia dizer `CONNECTED` enquanto stream,
   `WAComms.isCommsInitialized`, `WAComms.isSocketConnected` e entrada real
   continuavam desconectados. Isso foi observado tanto antes quanto depois de
   `hasSynced=true`.

A última causa encontrada só ficou alcançável depois que as anteriores foram
corrigidas. Em uma execução com `1.34.85`, a geração 9 iniciou às
20:40:10.683Z, manteve a contradição nativa até
`wwebjs_canonical_connected_timeout` às 20:42:48.324Z e só ficou online no
segundo `Client.initialize()`, às 20:43:28.861Z. Sessão e identidade estavam
válidas, mas o primeiro bootstrap gastou todo o timeout de 120 s porque
`hasSynced=false` ainda excluía o estado do classificador de stall. Esse era o
tempo residual percebido pelo usuário.

### Correções definitivas e limites de segurança

O tratamento é baseado no estado exato, nunca em sleep fixo ou em promoção
otimista:

- toda navegação da mesma `Page` recebe sequência monotônica; somente um erro
  comprovadamente pertencente a uma navegação superada é ignorado;
- `ready` abre reconciliação curta de 500 ms, limitada a 10 s, mas não remove
  identidade, socket, event bridge, checkpoint, fence, JetStream nem ACK;
- um App State nativo imóvel por pelo menos 15 s permite uma única troca do
  realm JavaScript no mesmo Chromium, e depois precisa provar uma nova janela
  estável;
- exceção de `WAComms.closeSocketAndResume` só é tolerada quando stream
  `DISCONNECTED` e `isSocketConnected=false` provam independentemente que o
  fechamento já ocorreu;
- a contradição completa de transporte antes **ou** depois de `hasSynced`
  permite uma única troca de realm após 15 s. `hasSynced` precisa ser booleano
  conhecido, todos os guards precisam estar íntegros e uma repetição falha
  fechada;
- no checkpoint final com rede comprovadamente offline, o model pode conservar
  `CONNECTED`; isso só é admitido no caminho interno `allowEstablished`, com
  documento, registro, listener, credenciais e pareamento atestados. Depois de
  reabrir a rede, o transporte real é provado novamente.

Nunca ampliar cada regra isoladamente. Em particular, não aceitar apenas
`Socket=CONNECTED`, não usar `hasSynced` como prova de transporte, não fazer
reload fora do mesmo Chromium, não permitir uma segunda recuperação e não
publicar `online` antes de tráfego real e dos gates do control plane.

### Releases e commits desta rodada

- WWebJS `1.34.81`, `f1365ce1`: sequência monotônica das navegações;
- Underchat `72c94a8c6`: reconciliação curta depois do evento `ready`;
- WWebJS `1.34.82`, `87c46752`: prova independente do fechamento oficial;
- Underchat `57c3b48cc`: consumo de `1.34.82`;
- WWebJS `1.34.83`, `206fdbb4`: recuperação única do stall de App State antes
  do restore;
- Underchat `ac515f8ac`: consumo de `1.34.83`;
- WWebJS `1.34.84`, `a1556d60`: recuperação única da contradição de transporte
  observada depois de `hasSynced`;
- Underchat `a8aad66bb`: consumo de `1.34.84`;
- WWebJS `1.34.85`, `21491d39`: `CONNECTED` permitido somente no checkpoint
  offline fortemente guardado;
- Underchat `d877e29ce`: consumo de `1.34.85`;
- WWebJS `1.34.86`, `8e307830`: o mesmo classificador exato passa a recuperar o
  stall também quando `hasSynced=false`, ainda na tentativa corrente;
- Underchat `a76938194`: consumo e contrato de `1.34.86`.

O pacote final publicado é `@wwebjs/whatsapp-web.js@1.34.86`, shasum
`5323931bb939f817a5b392c16e98cb1746243627` e integridade
`sha512-2iG9ANmcSh0Swxl58W+seLtL39uABGJsIBCT3DyQysb9ySGv7iWbxkfwwawRy6eAUVp2MegebQZAc7iasLvOUQ==`.
O fork terminou com 181 testes no bridge, 100 no RemoteAuth, lint, Prettier e
prepack aprovados. O prepack confirmou 158 arquivos e WhatsApp Web
`2.3000.1044338228`. Na Underchat, 26 suítes/414 contratos WWebJS e o build
TypeScript do worker passaram.

### JetStream obrigatório na recriação

O comando canônico é publicado em
`uc.worker.command.<worker_id>` no stream `UC_WORKER_COMMANDS_V1`, com durable e
filter exatos por worker. O stream é WorkQueue, file-backed, R3 e com MaxAge de
5 minutos. A geração física e o writer epoch giram; o epoch lógico da conexão é
preservado.

O health canônico é `command_ingress_ready=true` e
`command_ingress_authorized=true`. Campos `kafka_consumers_*` e códigos com
`kafka` são somente aliases binários/históricos que refletem o mesmo ingress
JetStream; não criam consumer Kafka. O Kafka global de eventos/resultados pode
continuar existindo, mas não recebe comandos e nunca libera readiness.

### Provas já concluídas nesta rodada

- Baileys: confirmação pela interface às 20:48:14.842Z, geração 6 online e ACK
  central às 20:48:26.190Z, aproximadamente 11,35 s;
- WhatsMeow: confirmação às 20:49:17.875Z, geração 8 online e ACK central às
  20:49:21.242Z, aproximadamente 3,37 s;
- ambos terminaram autenticados, com sessão válida, sem QR, status visual
  `Conectado` e sem alteração de provider;
- dois pools WWebJS `1.34.85` foram recriados do zero em 5,6 s e 11,2 s,
  saudáveis, zero restart e digest
  `sha256:5634f137703400ba23c3b0f97b3321fae2f5fd61d98886d7f2038aa6de840889`;
- capturas intermediárias:
  `output/playwright/baileys-recreate-connected.png`,
  `output/playwright/whatsmeow-recreate-connected.png` e
  `output/playwright/wwebjs-recreate-1.34.85-connected.png`.

### Rollout e prova live final do WWebJS `1.34.86`

- build `v20260813204738080`, job
  `019ffce1-6660-7273-a7ab-93a291b12139`;
- imagem
  `harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260813204738080`;
- digest imutável
  `sha256:9f5f7e0a11359a53cdd1dc5c720764dd03b8d1314b801d4823cbffab39c9fe28`;
- build WWebJS concluído em 5 min 49 s;
- pools `019ffce8-5a37-778a-bf28-074884828c2d` e
  `019ffce8-5a53-7079-ab9f-ebcb23c8c5d8` prontos em 6,84 s e 12,92 s,
  respectivamente, ambos com `1.34.86`, mesmo digest, healthy e zero restart.

A confirmação real do Wwebjs ocorreu às 20:55:56.160Z. O runtime novo iniciou
às 20:55:57.941Z, reutilizou a revisão canônica `3096`, comprovou transporte
real às 20:56:42.400Z, concluiu `Client.initialize()` na primeira tentativa às
20:56:42.927Z, fez o catch-up de App State em 2,301 s, publicou o status nativo
online às 20:56:48.000Z e recebeu o ACK central final às 20:56:49.306Z.

O relógio de interface até a conclusão foi **53,146 s**, contra 131,4 s do
baseline, redução aproximada de **59,6%**. Não houve retry do client, novo QR,
troca de identidade, erro de compatibilidade nem relaxamento de gate. A geração
10 terminou `online`, autenticada, `sessionValid=true`, com
`command_ingress_ready=true`, `command_ingress_authorized=true`, consumer
`WorkerCommandJetStreamIngressService` ativo no subject exato e ACK central.
A captura final é
`output/playwright/wwebjs-recreate-1.34.86-connected.png`.

### Balance, Harbor e convergência operacional final

O mesmo build `v20260813204738080` publicou o Balance API em 5 min 13 s:

- imagem
  `harbor.devunder.com/underchat/balance/under-balance-api:v20260813204738080`;
- digest imutável
  `sha256:c5e3c4050d82ba0e6553b3c21dab375050d53ab2f312e4f62479d533a7a0837b`.

Os dois Balance APIs ativos ainda carregavam valores antigos de namespace,
usuário e senha do Harbor. Isso não afetava a sessão já conectada, mas fazia o
provisionamento de imagens novas falhar ou consumir todo o timeout. Não manter
esse estado como workaround permanente e não colocar senha em argumento,
histórico ou log.

O rollout final foi executado pelo reconciliador transacional já existente:
referência imutável, captura da configuração do runtime anterior, substituição
exata das quatro variáveis `HARBOR_*`, autenticação em diretório Docker efêmero
`0700`, backup identificado do container anterior, candidato com o mesmo
`SERVER_ID`, mount NATS somente leitura, health Docker, HTTP e gRPC, aliases das
três imagens com content ID e timestamps recentes e janela adicional de
estabilidade de 120 s. Somente depois dessa janela o backup foi removido e o
estado passou a `PHASE=complete`; qualquer falha anterior continuava capaz de
restaurar o container antigo.

No Server 2, o primeiro candidato ficou corretamente retido porque
`under-worker-wwebjs:latest` registrou `worker_image_provision_timeout`, embora
HTTP e gRPC estivessem prontos. O pull antigo foi abandonado e a imagem WWebJS
foi baixada novamente pela referência imutável, com configuração de
autenticação efêmera. Na reconciliação seguinte, Baileys, WWebJS e WhatsMeow
ficaram com content IDs válidos, `error_code=null` e `last_success_at` recente;
só então a máquina de estados iniciou a janela de confirmação.

Resultado nos dois servidores: Balance API no digest `c5e3c405...`, healthy,
zero restart, `PHASE=complete`, sem container de rollback remanescente. Os
hashes e comprimentos dos quatro valores efetivos coincidem com a configuração
atual, e um pull autenticado pelo ambiente do próprio Balance foi comprovado em
ambos os hosts. Assim, um próximo recreate não depende de pre-pull manual.

### Auditoria final de não regressão

Depois do rollout dos Balance APIs, a página `/channels` foi recarregada com
Playwright e continuou mostrando os três canais como `Conectado`, nos tipos
originais `Opção 1 (Socket)`, `Opção 3 (Socket)` e
`Opção 2 (Navegador)`. A evidência consolidada é
`output/playwright/recreate-final-all-connected.png`. O único erro de console
era o carregamento de uma imagem antiga em um endereço interno indisponível;
não pertence ao lifecycle, ao command plane nem aos três canais.

O cruzamento final de banco, runtime e health confirmou:

| Canal   | Geração | Provider    | Status   | Sessão | QR    | ACK central |
| ------- | ------- | ----------- | -------- | ------ | ----- | ----------- |
| Baileys | 6       | `baileys`   | `online` | válida | falso | sim         |
| Meow    | 8       | `whatsmeow` | `online` | válida | falso | sim         |
| Wwebjs  | 10      | `wwebjs`    | `online` | válida | falso | sim         |

Todos têm `connected=true`, `authenticated=true`, capacidade de envio e
recepção, runtime ativo, container healthy e zero restart. Cada health expõe
um único `WorkerCommandJetStreamIngressService`, stream
`UC_WORKER_COMMANDS_V1`, subject exato `uc.worker.command.<worker_id>`, durable
pronto/autorizado, zero consumer ausente e zero consumer unhealthy. Os aliases
`kafka_consumers_*` retornam essa mesma instância JetStream e não representam
Kafka.

Não ficaram handoffs ativos, recoveries ativas nem resolutions ativas. Desde
17:00 BRT, o outbox terminou com 142 eventos publicados e um único
`dead_letter`: telemetria do WhatsMeow da geração 8 com `stale_runtime`, emitida
durante o fence do recreate. Ela não era comando, status final nem falha de
sessão, e não deixou item causal pendente. A barreira operacional global
permaneceu `active`, schema v1, sem permits em aberto.

Para evitar regressão na recriação normal:

1. medir da confirmação visual até `recreate_completed_at`, não apenas até o
   container iniciar;
2. exigir provider, `worker_id`, sessão canônica e epoch lógico inalterados;
3. exigir geração maior, sessão nativa pronta, envio/recepção, QR ausente,
   ingress JetStream pronto/autorizado e ACK central;
4. preservar as regras WWebJS exatas desta seção; não converter os stalls em
   sleeps fixos nem promover pelo model state;
5. validar aliases de imagem e credencial efetiva do Balance nos dois hosts,
   pois uma sessão conectada pode esconder falha futura de provisionamento;
6. após qualquer mudança, repetir Baileys, WhatsMeow e WWebJS e conferir também
   conexão direta, pools, outbox, containers e ausência de handoff/recovery;
7. manter a diferença esperada: WhatsMeow e Baileys restauram sockets nativos;
   WWebJS abre Chromium, sincroniza transporte e App State. O navegador pode
   levar mais tempo real, mas não deve gastar timeout artificial ou repetir
   `Client.initialize()` sem um erro fortemente classificado.

## Atualização final — matriz 6/6 e compatibilidade WWebJS neutra à origem — 2026-08-12

Esta seção continua sendo a referência da matriz de handoff 6/6, mas a seção de
2026-08-13 no início do arquivo é autoritativa para **recriação normal** e para
o command plane JetStream atual. Ela substitui qualquer pendência de
implementação, publicação, rollout ou teste da matriz descrita nas seções
históricas abaixo. As seis direções foram executadas de verdade pela interface,
em série e sobre a mesma sessão do WhatsApp, sem QR Code e sem nova
autenticação:

- Baileys → WhatsMeow;
- Baileys → WWebJS;
- WhatsMeow → Baileys;
- WhatsMeow → WWebJS;
- WWebJS → Baileys;
- WWebJS → WhatsMeow.

O canal canário é a B1, sessão
`019ff2fb-2b45-7759-81be-e9055876379a`, conta
`019a930d-c6f4-75ad-88ff-8d2fcd5839e1`. A impressão digital canônica permaneceu
`5d44c86a129deb15e4d107e15f8162b10cf38227933d2106da0ac9799a403192`
em todas as promoções. Portanto, o resultado não é apenas mudança de status:
é a continuidade da mesma identidade criptográfica.

### Veredito sobre a possível quebra cruzada no WWebJS

A observação de que uma correção para WhatsMeow → WWebJS poderia quebrar
Baileys → WWebJS, e vice-versa, apontava para um risco real do desenho anterior.
O problema não era uma incompatibilidade intrínseca entre os providers. Era o
reuso indevido de um artefato de destino:

1. um perfil WWebJS reutilizável havia sido criado originalmente por uma
   migração WhatsMeow → WWebJS;
2. uma migração posterior Baileys → WWebJS encontrava esse perfil e o tratava
   como artefato válido do destino;
3. o reanchor do destino podia ser pulado ou operar sobre o app-state privado
   já materializado pela origem anterior;
4. qualquer ajuste específico para uma linhagem acabava mascarando o problema
   da outra.

A correção definitiva é **neutra à origem**. Não existe um caminho especial
“se veio do Baileys” nem outro “se veio do WhatsMeow”. Durante o reanchor de um
perfil reutilizável:

- o snapshot canônico da origem já precisa estar completo e com checksum
  atestado;
- as três tabelas de app-state do perfil browser são substituídas pela projeção
  desse snapshot canônico;
- a projeção é selada com `complete=true` e `blockers=[]` somente depois da
  substituição completa;
- o checkpoint offline do alvo é produzido e validado antes de o provider ser
  iniciado;
- identidade, material Signal, devices, chaves pós-quânticas, checksum e CAS de
  promoção continuam fail-closed.

O overlay incompleto só é permitido por
`allowIncompleteAppStateOverlay=true`, exclusivamente no reanchor de destino
com perfil reutilizável e apenas quando os blockers pertencem ao conjunto
estrito de leitura/linha de app-state. Blockers de identidade, Signal, device,
PQ, integridade ou completude geral continuam rejeitados. Não ampliar esse
allowlist e não transformá-lo em tolerância genérica.

As alterações centrais ficaram em
`CanonicalSessionBridge.canonicalBrowserProjectionToStore` e no exportador do
perfil browser. A primeira preserva `complete` e `blockers` por padrão; a
segunda só aceita o overlay sob a opção explícita descrita acima. Nos dois
testes de entrada no WWebJS, a única limitação do reader privado foi
`app_state_sync_keys.read_failed`; o snapshot canônico atestado foi aplicado,
o checkpoint offline concluiu e o alvo entrou online sem QR.

### Histórico técnico das releases que levaram à correção

- WWebJS `1.34.77`, commit `901bef6e`: perfis de handoff WWebJS coerentes;
- Underchat `ba19d38aa`: reforço SQL e de segurança da continuidade;
- Baileys `1.0.24`, commit `502d2735b3`: normalização dos JIDs de companion
  herdados do WWebJS;
- Underchat `fdb929b9a`: instalação do pacote Baileys corrigido;
- Underchat `757a1ee87`: erro exato de provider indisponível no startup Kafka
  tornado retryable, sem relaxar readiness;
- WWebJS `1.34.78`, commit `e1c6cbf1`: primeira etapa do reanchor;
- WWebJS `1.34.79`, commit `ee177959`: retry do reanchor;
- WWebJS `1.34.80`, commit `762302b3`: substituição estrutural e atestada do
  app-state no reanchor, solução final neutra à origem;
- Underchat `2ae9e430a`: instalação de `1.34.80`, lockfile e contrato final.

O pacote publicado é `@wwebjs/whatsapp-web.js@1.34.80`, com integridade
`sha512-YHFblUaIMw/yMoUdjbghLSVJYEWds6vMvE10AXrkgopNFnM8zYWlwWlqAqmB1s8cqxu66Vj9/3wzTKXaxMYRdw==`
registrada no lockfile. O fork executou 320 testes aprovados e 1 pendente, além
de lint, formatação e prepack. O contrato do Underchat com o pacote passou
11/11.

### Rollout final do WWebJS

- versão de build: `v20260812235439475`;
- build id: `019ff866-43f3-712d-9c30-f2792e0bac62`;
- imagem:
  `harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260812235439475`;
- digest:
  `sha256:41a1bc90374226952dfd71d97ae241fa041d5727e4bdeada42fb0004be3c3048`;
- a versão default WWebJS aponta para esse mesmo build imutável;
- dois pools WWebJS finalizados `ready`, containers running/healthy, pacote
  `1.34.80` e o mesmo digest.

A primeira execução do build foi interrompida pelo watchdog após dez minutos
sem saída, embora o trabalho remoto ainda estivesse em andamento. O mesmo build
foi reprocessado pela interface e concluiu em cerca de 5 min 45 s de execução
efetiva. Durante a distribuição, o operador pediu o cancelamento dos pulls em
aberto. Todos os processos remotos `docker pull` daquele rollout foram
encerrados e o pull foi repetido do zero; a repetição concluiu em 4,9 s com a
imagem já íntegra. Não criar outra versão apenas por causa desse evento.

### Matriz real final executada pelo Playwright

| Direção             | Handoff                                | Revisão       | Geração     |    Duração | Resultado   |
| ------------------- | -------------------------------------- | ------------- | ----------- | ---------: | ----------- |
| Baileys → WWebJS    | `9cd2b783-2b6c-4316-974e-32a8048e68c6` | `3079 → 3086` | `103 → 104` | `84,821 s` | `completed` |
| WWebJS → WhatsMeow  | `ddd1c19c-2b93-4e7a-bc2b-5b7feeaba0d2` | `3086 → 3087` | `104 → 105` | `13,836 s` | `completed` |
| WhatsMeow → WWebJS  | `6dbc386f-3352-416c-ae1a-c34503c4a802` | `3087 → 3088` | `105 → 106` | `78,050 s` | `completed` |
| WWebJS → Baileys    | `b91c2af4-97d2-462a-b276-896c007b1259` | `3088 → 3089` | `106 → 107` | `99,965 s` | `completed` |
| Baileys → WhatsMeow | `5af19b3e-067e-44ee-a7bd-47d4771fe6af` | `3089 → 3090` | `107 → 108` | `14,809 s` | `completed` |
| WhatsMeow → Baileys | `4e26d4b4-651e-45da-a923-03b7aa902f33` | `3090 → 3091` | `108 → 109` | `45,076 s` | `completed` |

Em todas as linhas:

- `error_code` permaneceu nulo;
- o alvo terminou online, autenticado e com sessão válida;
- não foi emitido QR Code nem pairing novo;
- o fingerprint permaneceu invariável;
- o modal moderno exibiu origem e destino reais;
- o mesmo dialog evoluiu de progresso para `Conexão bem-sucedida!`;
- a captura foi feita antes do fechamento explícito pelo X.

Capturas do progresso e do sucesso, na ordem da matriz:

- Baileys → WWebJS:
  `.playwright-cli/page-2026-08-13T00-38-45-747Z.png` e
  `.playwright-cli/page-2026-08-13T00-42-20-676Z.png`;
- WWebJS → WhatsMeow:
  `.playwright-cli/page-2026-08-13T00-43-14-635Z.png` e
  `.playwright-cli/page-2026-08-13T00-44-10-889Z.png`;
- WhatsMeow → WWebJS:
  `.playwright-cli/page-2026-08-13T00-44-47-429Z.png` e
  `.playwright-cli/page-2026-08-13T00-46-41-774Z.png`;
- WWebJS → Baileys:
  `.playwright-cli/page-2026-08-13T00-47-44-153Z.png` e
  `.playwright-cli/page-2026-08-13T00-49-45-555Z.png`;
- Baileys → WhatsMeow:
  `.playwright-cli/page-2026-08-13T00-50-16-968Z.png` e
  `.playwright-cli/page-2026-08-13T00-51-09-169Z.png`;
- WhatsMeow → Baileys:
  `.playwright-cli/page-2026-08-13T00-51-46-038Z.png` e
  `.playwright-cli/page-2026-08-13T00-53-16-645Z.png`.

As duas entradas independentes no WWebJS são a contraprova da regressão
cruzada. Ambas geraram `checkpoint.offline_candidate_completed`, registraram
`handoff.reusable_profile_app_state_authoritative` com
`target_profile_checkpointed=true` e deixaram um `wwebjs_profile` ready com
anchor ativo na revisão promovida.

### Baileys, normalização e análise de desempenho

O retorno do WWebJS mantém a normalização dos JIDs de companion. O WWebJS usa
`556192037138:85@c.us`, enquanto os providers nativos usam
`556192037138:85@s.whatsapp.net`; o LID observado é
`128317164409045:85@lid`. No último retorno WhatsMeow → Baileys foram hidratados
2.505 registros e 668 mapas de LID, as credenciais foram revalidadas e não houve
QR.

O tempo Baileys não é um sleep fixo de migração. A sessão já estava autenticada
e válida enquanto a publicação permanecia bloqueada pelo ingress de comandos.
O worker só promoveu depois de `command_ingress_ready=true` e
`command_ingress_authorized=true`, da drenagem, do checkpoint final e do CAS.
Hoje esse ingress é o consumer durável e filtrado do NATS JetStream; nomes como
`verify_kafka_consumers_failed` ou `kafka_consumers_*` podem sobreviver apenas
como códigos/aliases históricos de compatibilidade e não representam um
consumer Kafka. Remover essa barreira para reduzir o relógio criaria janela
real de perda de mensagens e status conectado prematuro.

O último WhatsMeow → Baileys terminou em 45,076 s, contra aproximadamente 135 s
do caminho patológico anterior. WWebJS → Baileys precisou de mais ciclos de
posicionamento do ingress e terminou em 99,965 s. A conversão de sessão não foi
a causa dessa espera; os logs mostraram autenticação anterior ao gate
JetStream. Otimizações futuras devem atacar a disponibilidade/posicionamento do
durable, mantendo todas as barreiras de segurança.

### Regressão de conexão direta e estado operacional final

Os canais auxiliares B2 e Meow foram abertos individualmente no modal existente
e exibiram `Conexão bem-sucedida!` e `pronto para uso`; os modais foram fechados
explicitamente depois da verificação, sem mutação. Isso protege contra o erro de
otimizar apenas handoff e quebrar conexão direta.

Estado ao encerrar:

- B1 em `Opção 1 (Socket)`/Baileys, revisão `3091`, geração `109`, conectada;
- B2 conectada;
- Meow conectada;
- pools quentes: Baileys `4 ready`, WhatsMeow `2 ready`, WWebJS `2 ready`;
- servidor de canais online;
- handoffs ativos: `0`;
- recoveries ativos: `0`;
- resolutions ativas vinculadas a worker não removido: `0`;
- outbox não publicada criada durante a rodada: `0`;
- nenhum deadletter novo no período.

Existe uma resolution histórica de 2026-08-06 com `state=running` ligada a um
worker já soft-deleted e sem handoff correspondente. Ela é resíduo de auditoria
anterior, não operação executável, e por isso a auditoria ativa deve sempre
fazer join com `worker.deleted_at IS NULL`. Não apagar histórico durável nem
contabilizar essa linha como migração corrente.

O único erro de console da rodada foi a imagem externa de perfil em um endpoint
indisponível; não houve erro de sessão, handoff, lifecycle ou modal.

### Gates finais executados

- suíte Underchat completa: 1.408 suítes e 9.393 testes aprovados;
- 6 suítes e 21 testes explicitamente skipped pelo próprio projeto;
- TypeScript raiz com `tsc --noEmit`;
- Vue com `vue-tsc --noEmit`;
- contrato do pacote WWebJS: 11/11;
- fork WWebJS: 320 testes aprovados e 1 pendente;
- i18n JSON parseável e em paridade: `pt`, `en` e `es` com 4.352 chaves cada,
  zero ausente e zero extra;
- `git diff --check`;
- Playwright real nos seis handoffs e nas duas conexões diretas auxiliares;
- inspeção PostgreSQL de revisão, geração, fingerprint, artifacts, anchors,
  filas e operações ativas;
- inspeção de pools, imagens, versões e saúde dos containers.

### Regras obrigatórias de não regressão

1. Nunca corrigir entrada no WWebJS por origem. Baileys e WhatsMeow devem passar
   pelo mesmo snapshot canônico atestado e pelo mesmo reanchor de destino.
2. Um perfil WWebJS reutilizável é cache de destino, não autoridade de sessão.
   A autoridade sempre é a revisão canônica promovível da origem atual.
3. Sempre substituir conjuntamente as três tabelas de app-state antes de selar
   o checkpoint; overlay parcial é proibido.
4. `allowIncompleteAppStateOverlay` só pode existir no reanchor protegido e
   nunca pode aceitar blocker de identidade, Signal, device, PQ ou checksum.
5. Toda mudança no caminho WhatsMeow → WWebJS deve repetir também Baileys →
   WWebJS; toda mudança em Baileys → WWebJS deve repetir WhatsMeow → WWebJS.
6. Toda mudança na importação Baileys deve repetir WWebJS → Baileys e
   WhatsMeow → Baileys, preservando a normalização `c.us`/`s.whatsapp.net`/LID.
7. Depois de alterar qualquer direção, repetir a matriz completa 6/6 na mesma
   sessão e validar fingerprint, revisão, geração, QR ausente e modal final.
8. Não publicar `online` antes de socket, autenticação, ingress JetStream ready
   e autorizado, app-state, checkpoint selado e CAS de promoção.
9. Não fechar automaticamente o dialog em sucesso com sessão retida; a UI deve
   chegar a `Conexão bem-sucedida!` e aguardar o usuário fechar.
10. Manter origem/destino, animação com `prefers-reduced-motion`, X sem clipping,
    responsividade e paridade `pt/en/es` em todo ajuste visual.
11. Validar conexões diretas além dos handoffs; a sessão nova/QR não pode ser
    prejudicada por lógica de migração.
12. Antes de criar versão nova, conferir commits, pacote, digest, build default
    e pools. Não repetir publish/rollout já comprovado nesta seção.
13. A B1 terminou em Baileys, revisão `3091`. Não refazer a matriz apenas para
    obter a mesma prova sem uma mudança posterior que a invalide.

## Atualização mais recente — WWebJS não gerava novo QR após desconectar — 2026-08-11

Esta seção registra a reprodução live, a causa e a correção do fluxo
**conectar por QR → desconectar removendo a sessão → solicitar novo QR**. O
fork corrigido foi publicado e instalado localmente no Underchat. Ainda não
houve rollout da nova imagem nem repetição live do fluxo depois do patch.

### Sintoma reproduzido e estado durável encontrado

No canal `Wwebjs`, worker
`019ff0d5-5b40-74ae-ac43-65665e781b08`, a conexão inicial terminou em
**Conexão bem-sucedida!**. Depois de **Desconectar**, a interface voltou a
**Aguardando leitura do QR code**, mas uma nova escolha de **QR Code** produziu:

```text
POST /v1/worker/019ff0d5-5b40-74ae-ac43-65665e781b08/connection/qrcode
HTTP 503
Canal ainda não está disponível para solicitar QR Code.
```

O requester estava correto ao falhar. O tombstone de desconexão era exato:

- `connection_epoch` e `disconnected_connection_epoch` iguais;
- `connection_disconnected_at=2026-08-11 09:40:59.427977-03`;
- ACK central removido e worker durável `offline`;
- lease WWebJS já liberada, sem owner nem epoch.

Porém, a árvore canônica não havia sido removida. A sessão permanecia
`state=ready`, com a revisão ativa de pairing `2992`, além de 3 provider
records, 1 device, 1 artifact, 1 profile anchor e 1 reservation. O snapshot
nativo persistido também continuava `online/ready`, embora sem ACK central. A
projeção visual de **Aguardando leitura do QR code** vinha do tombstone, não da
conclusão do pós-requisito destrutivo.

Antes de abrir um novo grant, `WorkerConnectionQrCodeRequester` executou
`finalizeWorkerConnectionDisconnect`. Como a sessão ainda continha material,
o finalizer retornou `session_not_empty`, manteve o status indisponível e
respondeu 503. Não houve erro no gate de QR nem motivo para enfraquecê-lo.
O trace e o network log da reprodução ficaram em
`output/playwright/wwebjs-reconnect/.playwright-cli/traces/trace-1786452568743.trace`
e `trace-1786452568743.network`.

### Causa raiz

No fork WWebJS `1.34.41`, `Client.logout()` executava as fases em sequência
linear:

1. `Socket.logout()` dentro da página;
2. fechamento do Chromium;
3. `authStrategy.logout()` para apagar a sessão PostgreSQL.

O próprio `Socket.logout()` navega ou destrói o documento que fez a chamada.
Nessa corrida, o Puppeteer rejeitou o `page.evaluate` por perda do execution
context. A exceção interrompeu o método antes das fases 2 e 3. O fallback do
Underchat chamou `Client.destroy()`; para um shutdown ordinário,
`RemoteAuth.shutdown()` preserva/checkpointa a sessão e libera a lease. O
resultado foi exatamente o observado: Chromium encerrado, lease liberada e
árvore canônica ainda pronta. A tentativa posterior de purge já não possuía a
lease necessária para `clear_whatsapp_session`.

### Correção publicada no fork WWebJS `1.34.42`

`Client.logout()` agora trata logout como uma operação composta:

- preserva a falha da chamada na página, mas sempre tenta encerrar o browser;
- confirma que o Chromium realmente saiu antes de qualquer exclusão durável;
- depois da fence física, sempre chama `authStrategy.logout()`;
- considera a navegação da página não terminal quando browser e remoção
  durável terminaram com sucesso;
- não chama a limpeza destrutiva se o Chromium continuar conectado;
- agrega e preserva as causas quando browser ou auth cleanup também falham.

Proveniência da release:

- repositório: `/home/maycon/wwebjs`;
- commit enviado a `origin/main`: `cd465121` —
  `fix(client): complete durable cleanup after logout navigation`;
- pacote publicado: `@wwebjs/whatsapp-web.js@1.34.42`;
- tarball:
  `https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.42/whatsapp-web.js-1.34.42.tgz`;
- integrity:
  `sha512-A6u+aCBtq2wXLszfGOkrUHPvLMHGQg+WbK6XbICIIWWhCfCwx5GRT/BmZG8FXGnwgBhTtiC2rELo8DdSu2nTWg==`;
- shasum: `da8edd31ff5972ad576b4bb0160a517fb9e921d5`.

### Correção complementar no Underchat

O Underchat local foi atualizado para o tarball real `1.34.42` em
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` e no contrato da
dependência. Não foi criado `pnpm patch`.

`purgePostgresSession()` também foi tornado recuperável e fail-closed para o
estado já encalhado por versões antigas. Ele roda somente depois de a
terminação de todos os browsers ser confirmada. Se a lease do provider já foi
liberada, o próprio provider reacquire a lease da geração/epoch/capability
exatas, executa `delete()` e exige a liberação confirmada da nova lease. Se
purge e release falharem, as duas causas são preservadas e o estado conhecido
não é falsamente marcado como vazio. Isso permite que uma nova desconexão com
o runtime corrigido limpe também o canal já afetado, sem transformar o manager
em escritor dos dados da sessão.

O contrato real da dependência comprova os dois lados: a perda do execution
context não impede a remoção após o Chromium sair, e a remoção não acontece se
a terminação do Chromium não puder ser confirmada.

### Validações concluídas

Fork WWebJS:

- lifecycle focado: 18/18 testes;
- suítes locais determinísticas: 391 aprovados e 1 integração PostgreSQL
  ignorada por ausência de `WWEBJS_TEST_POSTGRES_INSTALLER_URL`;
- a suíte global não inicia sem `WWEBJS_TEST_REMOTE_ID`, pois inclui os testes
  upstream que exigem uma conta WhatsApp real;
- ESLint, Prettier, verificação do cache web, verificação dos 158 arquivos do
  pacote, dry-run do tarball e `git diff --check`: aprovados;
- publicação lida de volta do registry com versão, shasum e integrity exatos.

Underchat:

- contratos de dependência real, serviço WWebJS, desconexão e requester de QR:
  170/170 testes;
- `tsc -p tsconfig.json --noEmit`, ESLint, Prettier dos arquivos tocados,
  `test:locations` e `git diff --check`: aprovados;
- build sem cache de `worker_wwebjs`: aprovado.

### Próxima prova operacional obrigatória

Ainda é necessário construir e implantar o `worker_wwebjs` contendo o
Underchat desta árvore e o pacote `1.34.42`. Depois do rollout:

1. clicar novamente em **Desconectar** no canal encalhado, se a árvore antiga
   ainda existir, e exigir sessão/revisões/artifacts/provider records vazios e
   lease liberada;
2. solicitar **QR Code** e exigir HTTP 200/202, grant novo e QR novo;
3. ler o QR, confirmar `connecting → online`, desconectar outra vez e repetir
   a solicitação sem 503;
4. confirmar que nenhum browser permaneceu vivo durante a limpeza e que o
   finalizer só concluiu depois do pós-requisito canônico vazio.

## Atualização mais recente — WhatsMeow sem transição visível após leitura do QR — 2026-08-11

Esta seção registra a correção local do fluxo relatado nos canais `Meow` e
`Meow 2`. Houve build local de `service` e `web`, mas não houve rollout nem
nova leitura real de QR depois do patch; esses passos continuam sob
responsabilidade do operador.

### Sintoma e causa comprovada

Nos dois canais, o QR foi lido e a sessão terminou online, mas a janela entre
o scan e o ACK final ficou incorreta:

- tabela e cabeçalho permaneceram em **Aguardando leitura do QR code**;
- o modal retirou o QR e mostrou **Iniciando conexão**;
- não apareceu **Conectando e pareando** nem o status durável **Conectando**.

Os outboxes `4128` e `4138` reproduzem exatamente a causa. O fork WhatsMeow
avançou diretamente do snapshot nativo `qr` para uma telemetria
`connecting`, código informativo `1000`, com:

- `connection_attempt_id` da tentativa corrente;
- `authenticated=true`;
- `sessionValid=true`;
- `qrAvailable=false`;
- runtime generation, writer epoch, connection sequence e grant consumido
  coerentes.

Não houve antes dessa telemetria um evento `206/pairingInProgress` do canal de
QR. A prova nativa era suficiente para demonstrar que a credencial havia sido
consumida e já era reconhecida por
`isWhatsappQrCredentialConsumedState`. Porém,
`WorkerRuntimeEventOutboxService` só chamava esse helper depois de classificar
o payload como QR/passkey por código ou campo de credencial. Como a telemetria
`1000` não carregava mais `qrcode`, ela não entrava nesse ramo: era publicada
sem a promoção manager-owned `disponible → connecting`. O frontend recebia
então `native=connecting` autenticado, sem código `206`, e corretamente caía no
fallback **Iniciando conexão**.

### Correção entregue localmente

O outbox agora também classifica como progresso da tentativa uma prova nativa
de consumo que possua `connection_attempt_id` não vazio. O restante da
fronteira permanece inalterado e fail-closed:

1. a tentativa ativa, provider, worker type e runtime generation ainda são
   validados contra o envelope Redis;
2. a promoção exige o outbox em publicação, worker/conta/provider/container,
   writer epoch, capability, connection sequence e grant consumido exatos;
3. terminal nativo mais novo, lifecycle ativo, tentativa substituída, epoch
   divergente ou worker fora de `disponible|connecting` continuam rejeitados;
4. somente depois da promoção durável o payload é normalizado para
   `worker_status_id=connecting`, `code=206`, `qr_pending=false` e publicado;
5. telemetria autenticada sem `connection_attempt_id`, típica de restore ou
   reconexão ordinária, continua fora do ramo de QR e não sofre promoção.

O contrato novo reproduz o envelope real WhatsMeow sem callback `success` e
comprova a publicação simultânea de **Conectando** para a projeção do worker e
**Conectando e pareando** para o modal. Um segundo caso prova que telemetria de
reconexão sem tentativa permanece inalterada.

### Validações locais

- quatro suítes focadas de outbox, normalização do modal e reducers:
  99/99 testes;
- `tsc -p tsconfig.json --noEmit` e `vue-tsc --noEmit`: aprovados;
- ESLint e Prettier dos arquivos da correção: aprovados;
- builds sem cache de `service` e `web`: aprovados; o web manteve somente os
  warnings baseline de CSS, anotações PURE, imports dinâmicos e chunks;
- `test:locations` e `git diff --check`: aprovados.

Para a prova live pós-rollout, exigir a sequência `qr/202 →
pairingInProgress/206 + worker connecting → online/200`. A publicação `206`
pode vir do callback explícito do canal de QR ou da prova nativa autenticada
correlacionada, mas nos dois casos precisa passar pela mesma promoção durável e
pelos mesmos fences. Não aceitar novo salto `202 → native authenticated/1000 →
online` sem a janela durável intermediária.

## Atualização mais recente — correção do pareamento WWebJS preso em `connecting` — 2026-08-11

Esta seção é a autoridade de retomada mais recente e substitui operacionalmente
as instruções de “próxima rodada” anteriores. O rollout e a nova leitura real
do QR **não foram executados nesta rodada**, por decisão do operador, que ficou
responsável pelo build e pelo teste live.

### Incidente reproduzido e causas comprovadas

O canal WWebJS `W1`, worker
`019feec3-6a49-75ab-848d-c3e9cfdbfa22`, geração 1 e sessão PostgreSQL,
leu o QR e autenticou, mas falhou no checkpoint pós-autenticação. A sequência
causal observada nos logs foi:

1. primeira tentativa solicitada às `03:00:14.494Z` e QR publicado às
   `03:00:21.067Z`;
2. uma segunda solicitação, criada enquanto o lifecycle ainda estava em
   criação, substituiu o primeiro client e publicou outro QR às
   `03:00:24.517Z`;
3. a segunda tentativa foi autenticada às `03:00:38.070Z`;
4. o checkpoint `after-auth` falhou às `03:00:55.267Z` com PostgreSQL `42501`,
   `permission denied for table whatsapp_wwebjs_profile_anchor`;
5. o provider publicou `initialization_failed`, fechou a página/browser e
   terminou nativamente em `error`;
6. um evento atrasado de consumo de QR promoveu novamente o worker durável para
   `connecting`, depois do terminal mais novo, deixando a UI presa em
   **Conectando e pareando**.

O erro `42501` foi introduzido pela política normal de `anchor + canônico` da
rodada anterior. O fork lia `whatsapp_wwebjs_profile_anchor` com
`SELECT ... FOR UPDATE OF anchor`. O papel live `whatsapp_worker_runtime`
possui intencionalmente `SELECT=true` e `UPDATE=false` nessa tabela; no
PostgreSQL, `SELECT FOR UPDATE` exige privilégio `UPDATE`. A prova direta no
banco foi:

```text
SELECT comum como whatsapp_worker_runtime: aprovado, 0 linhas no escopo vazio
SELECT ... FOR UPDATE como whatsapp_worker_runtime: ERROR 42501
```

Não foi concedido `UPDATE` ao runtime. Esse privilégio seria uma ampliação
indevida e contrariaria o modelo de segurança. A serialização já acontece em
`begin_whatsapp_session_mutation`, que bloqueia sessão e revisão, e o commit
`SECURITY DEFINER` bloqueia o anchor e valida CAS de artifact, anchor generation
e canonical generation. Portanto, o lock direto redundante foi removido do
caller não privilegiado.

A regressão durável foi comprovada pelos outbox ids `3888..3893`: o evento
`3888`, ainda ligado ao QR consumido, foi processado depois dos terminais
`3889..3891`; a projeção nativa já apontava para um outbox mais novo e `error`,
mas a promoção de QR ainda aceitava o owner disponível/conectando. O update
tardio gravou `worker.updated_at=2026-08-11 00:00:55.684966-03`, posterior ao
outbox `3893`, e deixou o status do worker em `connecting`.

Também foi comprovada a origem do QR duplicado: uma solicitação era aceita
durante `creating/recreating`, quando ainda não existia um pairing grant válido.
Ao terminar o lifecycle, a recuperação do frontend encontrava a tentativa sem
grant, invalidava-a e criava outra tentativa/client. Uma tentativa não pode
nascer antes da geração, época e autorização às quais ela será vinculada.

### Correções entregues

#### Fork WWebJS `1.34.41`

- removido `FOR UPDATE OF anchor` das três leituras do anchor feitas pelo papel
  do runtime;
- mantidos os locks de sessão/revisão e o CAS privilegiado no commit do anchor;
- o fake PostgreSQL da suíte passou a fazer round-trip realista de device,
  provider records, tabelas canônicas e passthrough, de modo que o readback
  canônico dentro da transação não seja mascarado;
- contrato explícito comprova que a query do anchor não pede o lock proibido.

Proveniência:

- commit do fork: `de544161` —
  `fix(session): keep profile anchor reads within runtime grants`;
- commit enviado para `origin/main` do fork;
- pacote privado publicado: `@wwebjs/whatsapp-web.js@1.34.41`;
- tarball:
  `https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.41/whatsapp-web.js-1.34.41.tgz`;
- integrity:
  `sha512-FZelUjJ3LvBzVNxhGDzcIrwxALuIShVcaKy6mgHkGJSf7o7L8iPtaT8dS5OnDGG+7JMlWyqpq0NSSmcpCtJ4Og==`.

#### Underchat

- `WorkerRuntimeEventOutboxService` rejeita uma promoção atrasada de QR quando
  `native_connection_status_outbox_id` já é maior que o outbox consumido e a
  projeção nativa mais nova é terminal (`offline`, `logged_out`,
  `invalid_session`, `conflict`, `lease_lost`, `stopped` ou `error`);
- o evento rejeitado é dead-lettered com
  `qr_connecting_fence_rejected`, sem republicar `connecting`;
- manager e frontend não aceitam solicitação de QR durante
  `creating/recreating`; a conclusão `disponible` do lifecycle continua
  event-driven e então inicia a solicitação válida;
- pacote, lockfile, allow-build e contrato real foram atualizados para
  `1.34.41` e para a integrity publicada.

Commits do Underchat, publicados em `origin/main`:

- `972eab837` —
  `fix(connection): fence pairing status and ship wwebjs 1.34.41`;
- `b9cc2f7e3` — `test(wwebjs): type the private anchor contract`.

Depois desses commits, o commit concorrente `e28c92466` adicionou uma defesa
complementar para manter o status monotônico enquanto o pairing grant exato
está ativo, reutilizar QR da mesma tentativa e tolerar o setup inicial sem
terminal prematuro. Ele também adicionou a migration
`atlas/prod/20260811010000.sql`. Esse commit faz parte do HEAD que o operador
deve construir/testar, mas entrou depois do worktree isolado usado nos gates
desta correção e, portanto, precisa ser revalidado junto com a migration.

### Validações concluídas antes da transferência ao operador

Fork WWebJS:

- arquivo completo `PostgresSessionStore`: 74/74 testes;
- ESLint e Prettier: aprovados;
- `verify:package`: 158 arquivos e um artifact web aprovados;
- `git diff --check`: aprovado;
- pacote `1.34.41` publicado e lido de volta no registry com a mesma integrity.

Underchat, no worktree isolado contendo `972eab837 + b9cc2f7e3`, sem incluir as
mudanças paralelas ainda não commitadas naquele momento:

- quatro suítes focadas: 81/81 testes;
- `tsc -p tsconfig.json --noEmit`: aprovado;
- `vue-tsc --noEmit`: aprovado;
- builds sem cache de `manager`, `service`, `worker_wwebjs` e `web`: 4/4
  aprovados;
- o build web exibiu apenas warnings baseline de CSS, pure annotations,
  imports dinâmicos e tamanho de chunks.

Por solicitação do operador, não houve build/deploy do HEAD final
`e28c92466`, aplicação da migration, atualização da imagem no servidor de
canais, nova tentativa de QR, restart pós-pareamento nem teste de mensagem.

### Estado live deixado para retomada

O runtime live ainda usa a entrega anterior e não deve ser interpretado como
prova da correção local. Na última leitura, W1 continuava:

- worker status id `019fee6d-09b1-752b-b759-943c3743db7e` (`connecting`);
- `runtime_generation=1`;
- `native_connection_status_outbox_id=3893`;
- projeção nativa pública `error`;
- `connection_sequence=3`;
- `worker.updated_at=2026-08-11 00:00:55.684966-03`.

Não foi iniciada outra conexão nem alterado manualmente o estado desse canal.

### Próxima rodada obrigatória atualizada — build, migration e prova live de W1

Não iniciar handoff entre providers. A próxima rodada deve limitar-se a
instalar e provar esta correção de pareamento:

1. Trabalhar a partir de `origin/main`, que contém `972eab837`, `b9cc2f7e3`,
   `e28c92466` e esta atualização de memória; confirmar que não há alteração
   local acidental antes de construir.
2. Revisar e aplicar uma única vez `atlas/prod/20260811010000.sql`; provar que a
   função pública `apply_worker_runtime_status` continua executável somente
   pelos papéis previstos e que o helper renomeado permanece privado.
3. Repetir no HEAD final os contracts adicionados, typecheck raiz, `vue-tsc`,
   lint/Prettier direcionados e builds sem cache de `manager`, `service`,
   `worker_wwebjs` e `web`.
4. Construir/publicar a imagem WWebJS com o tarball real `1.34.41`; conferir no
   container o package version, integrity/bytes críticos e a ausência de
   `FOR UPDATE OF anchor` na query do runtime.
5. Fazer rollout apenas de W1. Antes de pedir QR, aguardar o lifecycle terminar
   em estado requestable; não criar tentativa em `creating/recreating`.
6. Abrir uma única tentativa e comprovar: um `connection_attempt_id`, um
   pairing grant, um client/browser e um QR. Nenhuma recuperação pode substituir
   a tentativa enquanto o mesmo grant estiver válido.
7. Ler o QR e observar até terminal. A ordem válida é
   `qr → connecting → online/ACK` ou um terminal correlacionado; nenhum outbox
   antigo pode promover `connecting` sobre uma projeção nativa terminal mais
   nova. Não pode reaparecer SQL `42501`.
8. Para sucesso, exigir conjuntamente: worker `online`, projeção nativa
   `online`, `connected/authenticated/sessionValid=true`, ACK online, número e
   `connection_date`, revisão ativa, anchor ativo com checksum/gerações
   coerentes, zero pending/DLQ causal e um único runtime/container.
9. Reiniciar uma vez pelo lifecycle oficial e provar restore sem QR, sem
   reautenticação e sem troca indevida do anchor; depois validar uma mensagem
   de saída e uma de entrada.
10. Se qualquer fence, grant, epoch, outbox, checkpoint ou status divergir,
    parar no primeiro blocker e preservar logs/linhagem. Não corrigir o worker
    diretamente por SQL e não ampliar privilégios de tabela do runtime.

## Atualização mais recente — WWebJS `1.34.39`, G30 e fallback `artifact íntegro + canônico fresco` aprovado

Esta seção substitui operacionalmente todas as instruções de “próxima rodada”
que aparecem mais abaixo. O objetivo da próxima rodada não é executar outro
handoff entre providers. É transformar o mecanismo provado neste canário na
política normal de persistência das conexões WWebJS, com retenção, GC,
observabilidade e rollout próprios.

### Proveniência do rollout

O código e a imagem usados no teste foram conferidos ponta a ponta:

- Underchat em `1754b00a9d2b29391363fb095f73153c084776a4`, alinhado com
  `origin/main`;
- fork WWebJS `1.34.39` no commit
  `706ebee367cafd577bb992eb0b9e884d33298dca`;
- pacote, lockfile, contrato e instalação do Underchat em `1.34.39`, com
  integrity
  `sha512-n0Z9JdE/WvGrJqdVRAjG5tWhwnqx7+YtTC2jeD5xvyqVGuXhJQzlkd9JEXvOUWR4Qmz6CtN/8J5qXVq+iMeytg==`;
- build WWebJS `v20260809051854052`, digest imutável
  `sha256:8ee72acbfb86b8389dba032176678cc3dca319884903bf31bbc506431b776d72`;
- runtime ativo e warms com os arquivos críticos exatamente iguais ao pacote
  publicado e com a role PostgreSQL dedicada `whatsapp_worker_runtime`, sem
  privilégios de control-plane.

O patch `1.34.39` contém uma primitive comum para `active_restart_ready`,
handoff e shutdown. Somente o erro exato de perfil acima do teto pode acionar o
fallback. Antes de reutilizar um artifact, a transação valida revisão ativa,
estado ready, fingerprint, manifest, checksum, tamanho, sequência completa de
chunks e blobs. A projeção canônica fresca e o marker do anchor são persistidos
atomicamente sob a lease. No active restart, o WebSocket permanece cercado até
o commit terminar.

### Prova de conexão real anterior ao canário forçado

O primeiro restart oficial criou o G29 e restaurou a sessão real sem QR. O
operador enviou e recebeu mensagens com sucesso nesse runtime, comprovando que
a sessão restaurada era funcional nas duas direções. Esse primeiro ciclo não
exercitou o fallback: o checkpoint completo ainda coube no teto de 512 MiB.

Essa prova de mensagens e a prova de fallback descrita abaixo são
complementares. Nenhuma segunda mensagem foi enviada durante o canário forçado,
evitando duplicidade desnecessária; depois do fallback, a prova foi de
restauração, autenticação, READY/ONLINE e
`connection_online_acknowledged=true`.

### Canário forçado no mesmo runtime G30

O canal `019fd88a-2894-739b-9471-cd3502f648df`, revisão ativa 2060, foi
recriado pelo lifecycle oficial. O G30 ficou online sem QR e produziu um
artifact íntegro usado como anchor:

- artifact `05ef2ef9-ac05-497b-932f-90084d2fac7c`;
- checksum
  `2980de3aa9e380d6ecbc62a288c2338ae0884eecf292d9be1d2be6fead2a7af7`;
- `531042449` bytes;
- 725 chunks/blobs completos;
- persistido em `2026-08-09T12:59:09.715012Z`.

Para tornar a prova determinística sem adulterar o artifact, foi aplicado um
teto temporário exatamente igual ao tamanho desse anchor apenas no overlay do
container G30. O mesmo container foi reiniciado uma única vez para executar o
canário forçado; não houve nova geração, segundo writer, handoff ou pareamento.

O processo restaurou integralmente o artifact e produziu um snapshot posterior
de `531704260` bytes, portanto maior que o teto do canário. O caminho normal de
artifact completo foi recusado e o fallback persistiu:

- mode `last_good_plus_fresh_canonical_v1`;
- source `active_restart_ready`;
- o mesmo artifact, checksum e os mesmos 725 chunks como anchor;
- projeção canônica fresca com 2308 registros e `111928` bytes;
- checksum lógico canônico iniciado por `41aef5`;
- marker no banco em `2026-08-09T13:02:36.601434Z`;
- log `canonical_projection.last_good_profile_anchor_persisted` em
  `2026-08-09T13:02:36.960Z`;
- log `checkpoint.active_restart_ready_last_good_profile_fallback` antes de
  liberar a rede;
- ONLINE/READY em `2026-08-09T13:02:38.423Z`.

A ordem observada foi a necessária:

```text
restaura e valida artifact íntegro
→ captura/normaliza o canônico fresco
→ grava canônico + referência do anchor atomicamente
→ confirma lease/fence
→ libera WebSocket
→ READY/ONLINE/ACK
```

Durante todo o ensaio houve um único container e um único writer. Não apareceu
QR, conflito, nova autenticação, duplicata de lifecycle ou perda de lease.

### Limpeza e estado final

O arquivo original foi restaurado no ativo e nos dois warms, os backups
temporários foram removidos e os warms voltaram healthy. Um restart final do
mesmo container G30 carregou novamente o teto de produção
`536870912` bytes. O canal terminou:

- no mesmo G30 e epoch;
- container `9c153e269215...`, imagem imutável `sha256:8ee72acb...`;
- running/healthy, restart count zero após estabilização;
- connected, authenticated e `sessionValid=true`;
- ONLINE com ACK verdadeiro, QR falso e lease saudável no fence 142;
- sem lifecycle/monitor lock residual e sem container duplicado.

Com o teto original, o primeiro checkpoint completo de limpeza produziu o
artifact `0c835b3a-08f9-4d3c-a252-5439ac39ae60`, checksum
`e952a7e7e90b63e4d6d1c69fd55b6e72f1ec2f90879363d1c3393dd3c913939a`,
`530319025` bytes e 725 chunks, em `2026-08-09T13:09:46.297077Z`. O ciclo
normal seguinte o substituiu atomicamente pelo artifact atualmente íntegro:

- artifact `81e59dfd-3656-43cd-910a-9f01032a5a60`;
- checksum
  `393574e84b2fcb07d89c857b6a244615794edae32fb1601cfba9bc8530ef09f6`;
- `536082460` bytes, 751 chunks/blobs completos;
- persistido em `2026-08-09T13:11:48.481188Z`;
- projeção canônica completa com 2308 registros e `111928` bytes.

O checkpoint completo de limpeza removeu o marker e coletou o anchor anterior,
como manda o contrato atual. A evidência do canário permanece nos logs e na
auditoria capturada acima. Às `13:12:47Z` e `13:13:47Z`, o perfil em execução
voltou a ultrapassar naturalmente 512 MiB; os checkpoints periódicos falharam
com `whatsapp_artifact_profile_too_large`, preservando o último artifact
íntegro. O canal continuou online e healthy. Um futuro restart controlado já
consegue exercitar o mesmo fallback com o teto normal, sem qualquer patch.

### Conclusão técnica e limite da prova

O canário comprova em uma sessão real que é viável inicializar WWebJS a partir
de um artifact íntegro existente e aplicar uma projeção canônica fresca antes
de abrir a rede. Isso evita regravar centenas de MiB quando somente o estado
canônico mudou e também permite continuar quando o perfil vivo ultrapassa o
teto.

Isso ainda **não** significa que conexões comuns já persistem sempre nesse
formato. Em `1.34.39`, ele é um fallback para perfil acima do teto em
active-restart-ready, handoff e shutdown. Os checkpoints normais ainda tentam
gerar artifacts completos e podem rotacioná-los a cada ciclo.

Também não reduz sozinho o tamanho do anchor inicial. O artifact atual possui
aproximadamente 511 MiB. Cem conexões desse porte representam cerca de 50 GiB
lógicos somente de anchors, antes de índices, WAL, réplicas, backups e margem
de retenção. A economia principal desta primeira arquitetura é de
**amplificação de escrita e crescimento por versões repetidas**, não de todo o
espaço-base. Reduzir o próprio anchor exige uma etapa posterior de compactação
ou seleção segura de arquivos.

### Próxima rodada obrigatória — política normal `anchor + canônico`

A próxima rodada deve ser exclusivamente a refatoração da persistência normal
das conexões WWebJS. Não iniciar novo handoff entre providers nessa rodada.

Ordem proposta:

1. Tornar o artifact íntegro e imutável um anchor explícito da revisão ativa.
   Checkpoints rotineiros passam a salvar somente a projeção canônica fresca e
   sua referência ao anchor.
2. Gravar atomicamente, sob a mesma lease, geração canônica, checksum, contagem,
   tamanho, artifact id/checksum e compatibilidade. Uma falha não pode publicar
   metade do estado.
3. No startup, validar todo o anchor, restaurá-lo, aplicar o canônico fresco e
   manter o first-WebSocket gate fechado até terminar. Falta/tamper/checksum ou
   incompatibilidade devem falhar fechados.
4. Criar uma política limitada de renovação do anchor completo: primeiro
   pareamento, mudança incompatível de versão/schema/fingerprint, anchor velho
   ou não saudável, compactação verificada e manutenção explícita. Não
   rotacionar o perfil inteiro a cada checkpoint periódico.
5. Reaproveitar os artifacts existentes como anchors iniciais, sem migração em
   massa. Uma sessão sem anchor verificável cria exatamente um antes de entrar
   no modo canônico.
6. Implementar referências e GC transacional. Proteger o anchor ativo, o
   anterior durante a janela de rollback e anchors citados por handoff; apagar
   somente artifacts/chunks/blobs comprovadamente não referenciados após um
   período de graça.
7. Separar retenção lógica de compactação física. Medir IndexedDB/LevelDB e só
   criar um anchor mais fino após provar que nenhum SST/manifest necessário ao
   restore foi removido.
8. Expor observabilidade: modo/source, anchor id/checksum/idade/tamanho,
   canonical generation/count/bytes/hash, tamanho rejeitado, latência de
   restore, número de fallbacks, bytes/WAL evitados e falhas de validação.
9. Cobrir startup, shutdown, crash, restart, handoff, envio e recebimento após
   restore, concorrência de lease, chunks ausentes, tamper, mudança de versão e
   GC. Adicionar um ensaio de capacidade com pelo menos 100 sessões para medir
   banco, WAL, réplica e backup.
10. Fazer canário em um único WWebJS por pelo menos 24 horas, com restart e
    mensagem bidirecional, antes de rollout progressivo. Manter rollback para a
    política de artifact completo.

O frontend deve continuar event-driven via Centrifugo para header e status. A
refatoração de storage não autoriza polling HTTP periódico nem reabre o modal de
escolha de conexão durante migração protegida.

## Registro adicional — desconexão destrutiva e estado terminal disponível — 2026-08-09

> Este registro é estritamente aditivo. Ele **não substitui, não executa, não
> reordena e não altera** a seção autoritativa `Próxima rodada obrigatória —
política normal anchor + canônico` acima. A ordem e o escopo daquela próxima
> rodada permanecem integralmente preservados.

### Causas confirmadas

O botão apresentado como **Desconectar** reutilizava o fluxo de reset por
recriação. O frontend acionava a rota de reset, marcava o modal como logout/reset
e o backend enfileirava `action=recreate`, persistia/publicava `Recriando`,
removia a sessão e, em seguida, reservava outra geração e inicializava um novo
runtime. Por isso o canal entrava no loop visual e operacional
`Recriando → Conectando`, inclusive no WWebJS, em vez de concluir a remoção da
conexão.

Havia ainda uma segunda regressão de projeção: gravar apenas o worker como
`disponible` não era suficiente quando a projeção nativa anterior ainda
permanecia `online`, ou quando `recreate_phase`/lifecycle antigos continuavam no
cliente. Pela precedência canônica, esse conjunto podia voltar a aparecer como
`Conectando`. A conclusão precisa, portanto, terminalizar tanto o estado de
negócio quanto a projeção nativa e os fences de apresentação.

No backend, a remoção também não possuía uma barreira instalada **antes** do
logout do provider. Uma escrita já autorizada pela lease podia atravessar a
janela da limpeza e recriar uma revisão ou repor status da época removida. A
correção precisava, portanto, drenar escritores, aposentar a época e persistir o
tombstone antes de executar qualquer efeito externo.

### Contrato corrigido da desconexão

- Foi criado o comando dedicado `DELETE /worker/:worker_id/connection`. O botão
  **Desconectar** não reutiliza mais reset nem recreate.
- **Desconectar não é Recriar.** A ação pode exibir somente o transitório
  `Desconectando`/logout enquanto o provider confirma o encerramento; ela não
  pode publicar `Recriando`, reservar automaticamente uma nova conexão, pedir
  QR code nem iniciar pairing.
- O preparo transacional bloqueia worker, runtime, sessão e lease na ordem
  definida, valida geração/container/epoch/lifecycle exatos e instala
  `connection_disconnected_at` junto da época aposentada. Só depois o provider é
  chamado. Assim, escritores anteriores são drenados e o trigger do PostgreSQL
  rejeita qualquer revisão/status tardio da conexão removida.
- O provider encerra a sessão e aposenta a época de conexão anterior. O mesmo
  runtime/container pode permanecer disponível para uma reconexão explícita,
  mas fica sob uma barreira durável que rejeita status, escrita canônica e
  efeitos tardios da época removida. Redelivery e clique duplicado precisam ser
  idempotentes.
- O cadastro do canal/worker permanece, porque é ele que oferece a reconexão
  futura. Número, data de conexão, lifecycle, `recreate_phase`, ACK ONLINE e a
  projeção nativa da conexão removida são limpos/terminalizados atomicamente.
- O estado terminal correto é `EWorkerStatus.disponible`, apresentado no header
  e na tabela como **Aguardando leitura do QR code**. Esse texto significa que o
  canal está apto a receber uma nova solicitação de conexão; não significa que
  um QR já foi solicitado ou gerado.
- Após a confirmação terminal, o modal mostra o informativo de que a sessão foi
  removida e oferece **Conectar novamente**. Somente esse clique explícito abre
  uma instância nova do modal ordinário de conexão; nenhum QR ou pairing é
  solicitado automaticamente.
- Header, tabela e modal convergem pelo ACK terminal e pelas publicações
  Centrifugo na fila account-scoped do worker, sem F5 e sem polling HTTP
  periódico. Eventos atrasados do runtime aposentado não podem ressuscitar
  `ONLINE`, `Recriando`, `Conectando` ou uma sessão apagada.

### Contrato de persistência após a remoção

A remoção deve zerar toda a árvore operacional de autenticação e protocolo:
revisões ativas/anteriores, registros de provider, dispositivos e stores,
reservas de companion, handoff operacional, GC, artifacts, chunks, blobs e o
anchor WWebJS deixam de constituir sessão recuperável.

O header `whatsapp_session` pode permanecer em `state=empty`, sem revisão,
fingerprint, instante persistido ou erro. A lease, o epoch e a capability do
runtime ainda vivo também podem permanecer para permitir sua reutilização sem
recriar container; eles não contêm credenciais nem constituem uma sessão
restaurável. A barreira `connection_disconnected_at`/época desconectada impede
que essa autoridade técnica abra revisão ou republique estado da conexão
removida. Somente a ativação explícita de uma época nova libera escrita e
pairing. A linha
`whatsapp_session_handoff_resolution` também permanece auditável e idempotente
até a exclusão do worker, por pertencer deliberadamente ao canal/worker e não à
árvore operacional descartada.

Logo, a invariância verificável é: canal e runtime presentes; header vazio e
lease técnica cercada; nenhuma credencial ou revisão restaurável; nenhuma
conexão ativa; resultado de handoff anterior preservado somente para auditoria;
estado terminal `disponible`.

O finalizador só aceita esse terminal quando encontra, sob os mesmos fences, o
header vazio, a árvore operacional vazia e uma lease viva cujo
provider/generation/epoch/capability ainda coincidem com o runtime. O retry de
uma resposta perdida reconhece o tombstone e os pós-requisitos já satisfeitos e
retorna o mesmo resultado sem repetir logout ou limpeza. No WWebJS, a remoção
explícita inclui o diretório atual e sua quarentena; no WhatsMeow, falhas do
store, da limpeza local ou da reinicialização deixam de ser registradas como
sucesso.

### Matriz obrigatória

O mesmo contrato vale para **Baileys, WWebJS e WhatsMeow**. A regressão do
WWebJS que passava de `Recriando` para `Conectando` é caso obrigatório, mas não
pode ser tratada como exceção de provider. Nos três casos devem ser provados:

- logout/encerramento do provider e bloqueio durável da época anterior;
- limpeza da árvore operacional no PostgreSQL;
- header vazio e lease técnica cercada, sem possibilidade de restore;
- lifecycle e projeção nativa terminalizados sem eventos tardios dominantes;
- header e tabela em `Aguardando leitura do QR code`;
- informativo de sessão removida, sem QR automático;
- abertura do modal de conexão somente após **Conectar novamente**.

### Registro adicional dos sintomas de realtime e recriação

Dois sintomas da mesma família foram incorporados a esta análise:

1. O header global e a tabela de Canais podiam divergir ao navegar. A tabela
   consultava `DatabaseRo`, enquanto os endpoints do header consultavam
   `DatabaseRw`; além disso, o snapshot potencialmente atrasado da réplica era
   carimbado com `clock_timestamp()` no instante da leitura. Assim, um valor
   velho podia parecer posterior ao evento Centrifugo e substituir a projeção
   canônica. Header e tabela também mantinham handlers separados da mesma fila,
   de modo que o segundo consumidor podia receber `rejected/duplicate` do
   reducer e deixar de convergir seu backing store.
2. Depois da instalação de uma imagem nova, o ACK `202/queued` de **Recriar**
   era aplicado visualmente somente se a linha local já estivesse
   `recreating`. Partindo de `Conectado`, a condição era falsa; quando a
   publicação Centrifugo demorava ou se perdia na troca da imagem, apenas o F5
   lia o estado durável e revelava `Recriando → Conectando`.

O contrato corrigido usa uma única projeção canônica para a apresentação de
header e tabela. O status de worker passa a carregar
`worker_status_observed_at` baseado no `worker.updated_at` durável, e não no
relógio da consulta; hidratações atrasadas não vencem eventos posteriores. Os
handlers duplicados continuam idempotentes, mas seus efeitos são derivados do
snapshot canônico já aceito. Não foi introduzido polling periódico: a linha de
base vem do HTTP e as transições continuam sendo recebidas pelo Centrifugo.

Para **Recriar**, o ACK durável da própria requisição é sempre projetado no
reducer e nos backing stores imediatamente, independentemente do status local
anterior. A publicação Centrifugo correspondente confirma a mesma operação de
forma idempotente. Isso preserva o comportamento legítimo
`Recriando → Conectando` da ação **Recriar**, mas o remove por completo da ação
**Desconectar**.

### Recuperação do WWebJS preso em `Conectando`

O caso observado no worker `019fd88a-2894-739b-9471-cd3502f648df` retornava
repetidamente `202/queued` com `reason=recreate_already_running` e a mesma
operação `019fe724-a608-74b9-a76a-4449f9a0f49f`. O dedupe estava correto: o
defeito era que a operação antiga nunca alcançava seu critério terminal. A
inspeção somente leitura encontrou lifecycle/control ainda referenciando uma
geração anterior, enquanto o runtime já estava numa geração mais nova, saudável
e sem sessão restaurável.

O bloqueio específico do WWebJS era um impasse de bootstrap: o finalizador de
recreate exigia source/status nativo e consumidores funcionais, porém um runtime
WWebJS sem sessão ainda não criou client nativo e seus consumidores dependentes
da sessão não podem ficar prontos. O processo estava apto a receber uma
solicitação de QR, mas essa evidência válida não era reconhecida como terminal;
por isso o recreate permanecia em `Conectando` indefinidamente.

Handler e monitor agora aceitam uma segunda prova terminal, estrita e cercada,
para sessão vazia. Ela exige schema de health compatível, identidade completa de
worker/account/provider, geração exata, runtime ativo/ready/activated e não
standby, `has_session=false`, `qr_stream_ready=true`, ausência de autenticação,
telefone, erro e capacidade de envio/recebimento, além de nenhuma evidência de
sessão no provider. O estado nativo pode estar ausente antes da criação do client
ou explicitamente offline/initializing/connecting/QR/stopped, desde que sua
origem seja atual e coerente. Nenhuma prova parcial, geração antiga ou sessão
ambígua é aceita.

Quando essa prova fecha, a própria operação existente é finalizada de modo
idempotente em `EWorkerStatus.disponible`, lifecycle e recreate markers são
limpos e o evento account-scoped atualiza header e tabela para **Aguardando
leitura do QR code**. Não há criação automática de QR. Assim, um redrive pelo
handler ou pelo monitor recupera também operações já deduplicadas como
`recreate_already_running`, sem criar outra operação concorrente.

### Fila de QR autorrecuperável

A instalação de imagem e a invalidação de tentativas também podiam deixar o
stream Redis existente sem consumer group. Nesse estado, `XREADGROUP` e
`XAUTOCLAIM` retornavam `NOGROUP`, o consumer parava de avançar e o runtime
continuava aparentemente em `Conectando` mesmo estando disponível para QR.

A fila agora garante o grupo antes e depois de `XADD`, e `readNew`/`claimPending`
recriam o grupo tipado quando recebem `NOGROUP`; o mesmo comportamento foi
incorporado ao worker WhatsMeow. A invalidação aguarda destruição de grupos,
scan e exclusão antes de concluir e propaga falhas inesperadas, evitando limpeza
que parece concluída enquanto uma operação tardia ainda atua no stream.

Além disso, o cache de resultado usa comparação atômica em Lua com tentativa,
tipo e geração ativos. Baileys e WWebJS verificam a tentativa imediatamente
antes e depois de pedir QR ao provider; uma tentativa substituída é cancelada e
confirmada sem publicar nem cachear QR obsoleto. Com isso, a autorrecuperação de
`NOGROUP` não reabre a possibilidade de uma resposta atrasada vencer a geração
atual.

### Verificações realizadas e validações externas pendentes

Validações confirmadas até este ponto:

- rastreamento ponta a ponta de botão, store, Centrifugo, rota, controller, use
  case, lifecycle/monitor, handler, providers, Redis, projeção e repositório;
- 10 suites frontend, **184/184 testes**, incluindo apresentação canônica,
  header/tabela, recreate imediato, tombstone de sessão, modal de remoção e
  recuperação Centrifugo; `web` typecheck, Prettier e `diff --check` passaram
  nesse checkpoint;
- 5 suites focadas de migration/repository/fila QR/consumer WWebJS/limpeza
  WWebJS, **138/138 testes**, após o endurecimento dos fences e do cache atômico;
- a bateria final consolidada aprovou **34 suites Jest e 1.202/1.202 testes**:
  16 suites/955 testes de backend, disconnect, recreate, QR, providers e
  monitor; 10 suites/162 testes de frontend, realtime e Centrifugo; e 8
  suites/85 testes complementares de status, QR, WorkerUpdater e mobile;
- o WhatsMeow aprovou 702 eventos de teste sem falha e mais 50 eventos de QR,
  conexão e pairing sob o race detector, também sem falha;
- os typechecks raiz e web, os builds de manager, web, Baileys e WWebJS,
  `test:locations` e `git diff --check` passaram. O build web manteve apenas
  avisos não bloqueantes preexistentes;
- PostgreSQL descartável criado do zero aplicou com sucesso as **283 migrations**
  até `20260809130000`, usando as roles reais de runtime; o hash Atlas foi
  regenerado e validado. Uma primeira execução funcional encontrou e permitiu
  corrigir um acesso indevido a campos do header no trigger compartilhado;
  depois da correção, a base foi recriada e todas as 283 migrations foram
  reaplicadas do zero;
- na base recém-migrada, a fixture transacional confirmou que
  `clear_whatsapp_session` esvazia o header e as revisões, preserva a lease viva
  e cercada e rejeita com SQLSTATE `55000` uma revisão tardia da época removida;
- a inspeção do worker live citado acima foi somente leitura. Nenhum lifecycle,
  sessão, Redis, container ou status live foi alterado para produzir este
  diagnóstico.

Os gates locais e transacionais desta rodada estão concluídos. Permanecem como
validações externas, porque dependem de deploy e operação live autorizados:

1. depois do deploy, redirigir a operação WWebJS existente e provar
   que ela fecha em `Aguardando leitura do QR code` via Centrifugo, sem F5 e sem
   QR automático;
2. executar E2E serial para Baileys, WWebJS e WhatsMeow: conectado → desconectar
   → persistência limpa/cercada → `Aguardando leitura do QR code` → reconectar
   somente por ação explícita, incluindo crash, redelivery, clique duplicado e
   eventos atrasados da época aposentada.

### Atualização da fonte de verdade, runtime parado e ciclo de QR — 2026-08-10

Esta atualização pertence somente ao contrato de conexão descrito neste
registro. Ela não modifica nem reordena a seção autoritativa `Próxima rodada
obrigatória — política normal anchor + canônico` no início do documento.

O catálogo de status passou a separar dois estados que antes compartilhavam o
mesmo significado operacional. O UUID histórico
`019bcd18-ce66-77a2-9d7c-e48159c253da`, usado pelo enforcement de plano, foi
preservado e renomeado para `blocked`. Um novo UUID,
`019feb94-c2ff-76b1-9d00-d7602a50affe`, representa exclusivamente `stopped`, ou
seja, container/runtime fisicamente parado. O nome técnico `disponible` foi
mantido para evitar uma migração invasiva em providers, contratos e dados, mas
sua apresentação é sempre **Aguardando leitura do QR code**; ele nunca deve ser
exibido ao usuário como “Disponível”.

`worker.worker_status_id` é a fonte de verdade durável para os dois modos de
sessão, `postgres` e `legacy_volume`. O monitor agora confirma container ausente
ou não executando, relê o worker de forma consistente e faz uma atualização
atômica para `stopped`, cercada por account, servidor, provider, status anterior,
container, geração e ausência de lifecycle. A publicação realtime ocorre apenas
depois dessa persistência. A entrada SQL compartilhada pelos dois modos também
rejeita publicação de status e ativação tardias enquanto o worker estiver
`stopped`; somente uma recriação explícita pode mover o worker para o lifecycle
que autoriza uma nova ativação.

Na apresentação e nas ações, o contrato ficou:

- `disponible` → **Aguardando leitura do QR code**, com **Conectar Canal**;
- `stopped` → **Parado**, sem **Conectar Canal** e com **Recriar**;
- `blocked` → **Bloqueado pelo plano**, sem conexão ou recriação até desbloqueio;
- `delete` → **Exclusão pendente**, distinto do transitório **Excluindo**.

Os filtros e resolvedores web/mobile cobrem agora todo o catálogo conhecido.
Isso elimina o caso em que um container parado permanecia duravelmente como
`disponible`, oferecia **Conectar Canal** e terminava no erro “Canal ainda não
está disponível para solicitar QR Code”.

Para um runtime realmente ativo em `disponible`, selecionar **Conectar Canal →
QR Code** solicita a primeira geração imediatamente e mantém a tela em preparo
até a chegada do código. Baileys, WWebJS e WhatsMeow aceitam até cinco QR codes
distintos na mesma rodada. O botão **Reiniciar QR Code** só aparece depois do
evento de esgotamento, isto é, quando as cinco gerações expiraram sem leitura;
reiniciar abre uma nova rodada com o contador novamente disponível.

O informativo **Sessão removida** foi alinhado ao padrão visual atual: card mais
compacto, hierarquia de sucesso, orientação explícita do próximo passo, ações
Vuetify padronizadas e layout responsivo. Ele continua sem iniciar conexão por
conta própria; **Conectar novamente** abre o fluxo ordinário e a escolha de QR é
que dispara a geração automática descrita acima.

As validações locais desta atualização aprovaram o typecheck raiz, o build web,
os builds de `manager`, `balancer`, `worker_baileys` e `worker_wwebjs`, 23 suites
Jest com 1.075 testes e o pacote Go completo de `worker_whatsmeow/internal/app`.
O checksum Atlas da nova migration foi recalculado e conferido contra todos os
arquivos do diretório.

### Correção do primeiro QR em sessão PostgreSQL abandonada — 2026-08-10

O ensaio real do canal `Baileys` encontrou um caso adicional que não era um
container parado. O worker e o runtime estavam coerentes, ativos, em
`disponible` e prontos para o stream de QR, mas a sessão canônica PostgreSQL
retinha um rascunho incompleto da rodada anterior: header `preparing`, uma única
revisão `staging/pairing`, somente `baileys/creds` e um device placeholder sem
JID, fingerprint ou material de identidade. O gate tratava qualquer árvore não
vazia como sessão autenticada e devolvia `session_not_empty`, projetado para a
UI como “Canal ainda não está disponível para solicitar QR Code”.

A preparação da autorização de pairing agora bloqueia worker, runtime, header
canônico e lease na ordem global e reconcilia somente esse formato exato de
rascunho abandonado. A limpeza exige igualdade de provider, generation, writer
epoch, capability hash, revisão ativa e limites completos da árvore. Sessões
`ready`/`active`, devices identificados, artifacts, handoffs, reservas ou
qualquer fence divergente continuam falhando fechados e nunca são apagados. A
decisão foi extraída da transação principal para manter os limites de
complexidade e quantidade de statements do lint sem relaxar regra alguma.

O frontend também deixou de transformar eventos terminais transitórios da
própria tentativa em novas solicitações silenciosas. Um status com
`connection_attempt_id` atualiza o modal, mas não dispara outra rodada; somente
a transição canônica para disponível, sem tentativa associada, pode iniciar o
fluxo automático previsto. Isso removeu o feedback que chegou a produzir
dezenas de `POST /connection/qrcode` consecutivos.

No Playwright autenticado, o caminho exato `Baileys → Conectar Canal → QR Code`
passou de `503 Service Unavailable` para `202 Accepted`, retornou
`cached_qr_available` e exibiu imediatamente um QR real no modal
**Aguardando leitura do QR code**. Após o ajuste do guard, a repetição completa
produziu uma única chamada nova ao endpoint e nenhuma recursão. Os contratos de
repository, requester e projeção web aprovaram 42 testes, além do ESLint,
typecheck raiz e `vue-tsc` do web.

Uma repetição mais longa expôs uma segunda causa independente. O primeiro QR
era publicado com `attempt=1/max_attempts=5`, mas o socket Baileys encerrava com
`408 Request Timeout` cerca de 161 segundos depois. A continuidade sem sessão
autenticada era autorizada somente para `restartRequired`; por isso o `408`
encerrava a tentativa após um único QR e o modal recebia **Canal desconectado**.
O provider agora mantém a mesma identidade de tentativa em qualquer fechamento
recuperável durante uma leitura ativa, renova explicitamente o socket após 25
segundos quando o provider não emite um QR novo, preserva contador/fence e
encerra somente depois da janela do quinto QR. O timeout do primeiro QR também
mantém uma recuperação limitada, sem converter a preparação em terminal falso.

O mesmo contrato foi auditado nos três providers. WWebJS agora permite
recuperação da leitura ativa sem exigir uma sessão já autenticada, trata
`auth_failure`, desconexão e timeout de preparação como recuperáveis enquanto o
orçamento não terminou e configura `qrMaxRetries=5` no client nativo.
WhatsMeow já implementava a regra corretamente: o fork emite automaticamente
seis códigos (o primeiro por 60 segundos e os demais por 20), enquanto o worker
publica somente os cinco primeiros e usa o sexto evento como terminal. O teste
Go confirma contador, duplicatas, reset explícito e bloqueio após o quinto.

Os gates locais desta extensão aprovaram 180 testes TypeScript do contrato de
QR, 119 testes focados de WWebJS, 61 de Baileys, o pacote Go
`worker_whatsmeow/internal/app`, todo o fork WhatsMeow, ESLint dos arquivos
afetados e o typecheck raiz. A prova live alternada ainda depende do rollout das
imagens de manager, `worker_baileys` e `worker_wwebjs`; `worker_whatsmeow` não
teve alteração de código nesta extensão. Isso não altera nem reordena a próxima
rodada autoritativa do início deste documento.

### Correção do bootstrap preso em `Recriando` — 2026-08-10

Depois do rollout do pairing grant, cinco recriações Baileys avançaram no banco
para novas gerações e materializaram containers distintos, mas todos os
containers entraram em restart loop com `worker_runtime_fence_rejected`. O
defeito estava na composição das sobrecargas SQL: o bootstrap ordinário usa a
assinatura histórica de oito argumentos; o wrapper de `stopped` encaminhava
essa chamada para a nova assinatura de nove argumentos usando
`connection_attempt_id = NULL`, enquanto o wrapper do rascunho de QR rejeitava
o valor nulo antes de alcançar o fence de runtime já autorizado.

A migration `20260810140000.sql` separa novamente os contratos sem reduzir os
fences. Chamadas sem tentativa explícita passam pelo boundary grant-aware de
sessão, que suporta o sentinel nulo e mantém identidade de worker/account,
provider, geração, writer epoch, capability e container. Chamadas de QR com
tentativa concreta continuam no caminho estrito do rascunho retomável e do
grant one-shot. O bloqueio canônico de `stopped`, a ordem de locks
worker→runtime e as ACLs `SECURITY DEFINER` permanecem antes dos dois ramos.
Isso cobre o bootstrap compartilhado de Baileys e WWebJS e a ativação
equivalente do WhatsMeow.

A migration foi aplicada no ambiente local e os cinco containers existentes
saíram do restart loop sem troca manual de status. Os throttles efêmeros de
redrive das duas operações online que haviam falhado antes da correção foram
removidos; os journals duráveis permaneceram intactos e concluíram pelo fluxo
normal. O estado final dos cinco canais ficou com `lifecycle_operation_id`
nulo, `worker.container_id = worker_runtime.container_id`, completion marker
da geração corrente e containers healthy. Baileys, Baileys 2 e Baileys 3
terminaram em `disponible`; Baileys 4 e Baileys 5 terminaram `online` com native
online e ACK verdadeiro.

Como prova independente dos containers recuperados, o Playwright autenticado
recriou novamente apenas `Baileys 3`. A operação avançou da geração 7 para a 8,
criou o container `08cad1d64d04...`, terminou com restart count zero e status
healthy, convergiu os dois ponteiros duráveis, gravou a completion exata e
voltou em cerca de dez segundos para **Aguardando leitura do QR code**. Após
reload, não havia nenhuma ocorrência de **Recriando** e `Baileys 4` era exibido
como **Conectado**.

Os gates desta correção aprovaram 22 suites/165 testes dos contratos de schema,
runtime e migrações, o pacote Go `worker_whatsmeow/internal/app`, ESLint do novo
contrato, aplicação Atlas da migration e `git diff --check`. Esta atualização é
somente do fluxo de conexão/recriação e não altera, executa nem reordena qualquer
seção de próximo passo deste documento.

### Eliminação do flash de desconexão antes do QR — 2026-08-10

Uma bateria visual posterior encontrou uma inconsistência curta, mas visível,
na abertura do QR. Depois do ACK `202/qr_pending`, o provider publicava
`connecting/initializing` com o `connection_attempt_id` correto, enquanto a
projeção canônica global ainda conservava por alguns milissegundos o checkpoint
HTTP anterior em `offline`/`reconnect_required`. Como esse evento transitório
não continha ainda QR, pairing ou passkey, o modal não o reconhecia como parte
da tentativa atual, reaplicava a projeção antiga e exibia a sequência incorreta
`Preparando QR Code → Canal desconectado → Preparando QR Code → QR`.

O modal agora cerca também os eventos transitórios pelo
`connection_attempt_id` exato. Enquanto a tentativa atual estiver ativa, uma
projeção canônica anterior não pode apagar o overlay de preparação. A proteção
é deliberadamente limitada: tentativa divergente, desconexão explícita, worker
parado/bloqueado/em exclusão, remoção de sessão e esgotamento das cinco
tentativas continuam terminais e substituem o overlay imediatamente. Um
checkpoint nativo terminal também continua autoritativo, exceto quando vem
anexado a uma publicação não terminal da tentativa atual e será substituído
pelo próximo snapshot ordenado do novo socket. O normalizador recebeu o mesmo
contexto explícito para que um native `offline` anterior não vença o
`qr_pending` já aceito.

No Playwright autenticado foram executadas inicialmente dez aberturas reais,
alternando `Baileys`, `Baileys 2` e `Baileys 3`, com amostragem visual entre 25
e 50 ms. Todas seguiram diretamente de **Preparando QR Code** para
**Aguardando leitura do QR code**, exibiram uma imagem real entre 65 ms e 2,831
s e tiveram zero frames de **Canal desconectado**.

A extensão da prova para WWebJS e WhatsMeow revelou que o `503` observado nesses
dois providers não era um terminal legítimo: a fronteira de ativação reconhecia
como reutilizável apenas o rascunho PostgreSQL vazio do Baileys. O repository e
a função privada transacional passaram a aceitar os três providers sob os
mesmos fences de worker, runtime, sessão, lease e grant. A exceção continua
fail-closed e específica por provider: Baileys admite somente seus placeholders
vazios de credencial/dispositivo; WWebJS e WhatsMeow exigem zero provider
records e zero devices, além de revisão única `staging/pairing`, sem artifacts,
anchors, chunks, blobs, reservation ou handoff. A migration
`20260810150000.sql` mantém a ordem global de locks, o `search_path` fixo e a
função auxiliar sem permissão pública ou da role de runtime.

Depois da aplicação real da migration, WWebJS chegou ao primeiro QR em 12,718 s
e WhatsMeow em 2,409 s, ambos sem erro HTTP ou desconexão visual. Em seguida,
uma bateria de nove aberturas consecutivas alternou Baileys, WWebJS e WhatsMeow
com amostragem a cada 25 ms: 9/9 exibiram QR, nenhuma requisição de conexão
falhou e houve zero frames de **Canal desconectado**. No total desta validação,
foram 21 aberturas reais observadas nessa primeira fase sem regressão visual.

Um ensaio adicional esperou os clientes terminarem naturalmente e repetiu a
abertura a partir de `native=stopped`. WWebJS recuperou, mas WhatsMeow expôs uma
segunda janela: sua nova tentativa publicou `pairingInProgress` com o
`connection_attempt_id` correto e carregou, no mesmo envelope, o último
snapshot `stopped` do cliente anterior. O modal mostrou **Canal desconectado**
por aproximadamente 438 ms antes do novo snapshot `connecting/qr`.

O seletor agora preserva o estado neutro quando a fonte durável do worker é
`disponible`, antes da escolha do método. Depois do clique, uma publicação de
progresso pertencente à tentativa atual ignora somente esse snapshot terminal
anexado; o evento explícito terminal continua vencendo. Repetido a partir do
mesmo `native=stopped`, o WhatsMeow percorreu **Preparando QR Code → Conectando
e pareando → Preparando QR Code → Aguardando leitura do QR code** em 2,923 s,
sem um único frame desconectado. A bateria final pós-correção fez mais seis
aberturas alternadas nos três providers: 6/6 com QR, zero desconexões antes ou
depois da escolha do método e zero falhas HTTP. Foram 30 aberturas reais no
total, incluindo deliberadamente a reprodução que encontrou a última corrida.

Os gates consolidados aprovaram 9 suites/182 testes, typechecks raiz e web,
ESLint dos arquivos TypeScript afetados, Prettier, aplicação e hash Atlas e
`git diff --check`. Esta atualização permanece restrita ao contrato de conexão
e não modifica, executa nem reordena nenhuma seção de próximo passo deste
documento.

### Catálogo formal de status e correção da rotação WWebJS — 2026-08-10

Esta seção consolida a fronteira de status do fluxo de conexão sem alterar
nenhuma seção de próximo passo. A regra central é única para `postgres` e
`legacy_volume`: **`worker.worker_status_id` é a verdade operacional exibida**.
Listagem, filtro, ordenação, cabeçalho, ações e abertura do modal usam exatamente
esse ponteiro. A projeção nativa continua disponível para progresso,
correlação, observabilidade e para autorizar uma futura escrita durável, mas
não converte status durante a leitura. Assim, `disponible` não vira `offline`
por causa de um checkpoint antigo `stopped/client_destroyed`, e `online` não é
rebaixado visualmente sem que a transição seja primeiro aceita e persistida no
worker. A gravação de `online` continua fail-closed e exige a confirmação
central de runtime/sessão; a mudança é somente a remoção da reinterpretação no
read-side.

#### Status persistidos do worker

| Status       | Significado e fronteira operacional                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new`        | Registro alocado, ainda aguardando o início do provisionamento. Não prova container nem cliente WhatsApp.                                                                      |
| `creating`   | Criação inicial do worker em andamento. Não é recriação e não autoriza a mensagem “Recriando canal”.                                                                           |
| `recreating` | Substituição explícita do runtime/container em andamento, cercada por uma operação de lifecycle.                                                                               |
| `disponible` | Runtime executável e sem sessão autenticada. Na UI é sempre **Aguardando leitura do QR code** e permite escolher/iniciar uma forma de conexão. Não significa que já exista QR. |
| `connecting` | A credencial da tentativa corrente já foi consumida e o pareamento/conexão está sendo concluído. Na UI é **Conectando**; exige tentativa, runtime e grant correlacionados.     |
| `online`     | Sessão autenticada e conectada cuja prontidão foi confirmada e persistida centralmente.                                                                                        |
| `offline`    | Sessão anteriormente autenticada ou restaurável está temporariamente indisponível; o runtime físico não está necessariamente parado.                                           |
| `mismatched` | Identidade, provider, número ou material da sessão diverge do runtime esperado e exige reconciliação.                                                                          |
| `error`      | Falha persistente de lifecycle/runtime que exige recuperação explícita ou automática antes de voltar ao estado saudável.                                                       |
| `blocked`    | Canal bloqueado por regra administrativa/plano. Não autoriza conexão nem recriação até o desbloqueio.                                                                          |
| `stopped`    | Container/runtime físico confirmado como parado ou inexistente. A única ação de retomada é **Recriar**; **Conectar Canal** não aparece.                                        |
| `delete`     | Exclusão solicitada e aguardando consumo/processamento.                                                                                                                        |
| `deleting`   | Exclusão já em execução; é transitório e distinto de `delete`.                                                                                                                 |

O nome técnico histórico `disponible` e seus UUIDs permanecem inalterados para
evitar uma migração de alto impacto. A semântica correta fica expressa na
apresentação, nos contratos e nesta memória.

**`Desconhecido` não é um status persistido nem nativo.** Era somente o fallback
visual usado quando o store ainda não tinha um `worker_status_id`. A corrida
reproduzida no Baileys acontecia quando uma telemetria nativa sem
`worker_status_id` chegava antes da hidratação HTTP, mas gravava o relógio de
status do worker; a hidratação durável posterior parecia mais antiga e o campo
ficava `null`. Telemetria sem o ID autoritativo agora não avança esse relógio,
de modo que o `worker.worker_status_id` hidratado sempre substitui o vazio. O
Baileys persistido como `disponible` volta, portanto, a ser apresentado como
**Aguardando leitura do QR code** e pode iniciar a tentativa normalmente.

#### Status nativos dos providers

Os status abaixo pertencem ao cliente interno de Baileys, WWebJS ou WhatsMeow.
Eles nunca substituem diretamente um status persistido:

| Status nativo     | Evidência permitida                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initializing`    | Cliente interno está sendo construído; ainda não há prova de sessão ou QR.                                                                                       |
| `restoring`       | Provider tenta restaurar material de sessão existente.                                                                                                           |
| `connecting`      | Transporte/autenticação está avançando, sem confirmação central de online.                                                                                       |
| `qr`              | Provider oferece uma credencial QR corrente; só alimenta a tentativa correlacionada.                                                                             |
| `online`          | Provider afirma conexão/autenticação; só pode levar o worker a `online` após ACK central e fences válidos.                                                       |
| `reconnecting`    | Cliente tenta recuperar transporte de uma sessão conhecida.                                                                                                      |
| `offline`         | Transporte nativo indisponível; é diagnóstico até a transição durável correspondente ser persistida.                                                             |
| `logged_out`      | Provider confirmou logout da sessão interna.                                                                                                                     |
| `invalid_session` | Material da sessão é inválido e não pode ser usado como autenticação válida.                                                                                     |
| `conflict`        | Outro cliente/dispositivo substituiu ou conflitou com esta sessão.                                                                                               |
| `lease_lost`      | Writer perdeu a lease/fence e deve parar de publicar ou operar a sessão.                                                                                         |
| `handoff`         | Migração protegida entre providers/runtimes está em andamento; não autoriza chooser ou novo QR no alvo ainda não promovido.                                      |
| `stopped`         | O **cliente interno** foi encerrado (`client_destroyed` pode ser o motivo). Não equivale ao `worker stopped`, que exige confirmação física do container/runtime. |
| `error`           | Falha interna sanitizada do provider; sua recuperabilidade e correlação determinam o próximo passo, não uma troca visual automática do status do worker.         |

Uma evidência nativa só é aceita quando provider, source id, runtime generation,
sequência/outbox order, session storage, lease/epoch/fencing token e, quando o
evento pertence a uma conexão, `connection_attempt_id` correspondem à fronteira
corrente. Durante uma tentativa de QR ativa, eventos terminais de outra
tentativa — inclusive um `stopped/client_destroyed` tardio — permanecem apenas
como diagnóstico e não podem apagar o QR/pending nem mostrar **Canal
desconectado**. Um terminal explicitamente correlacionado à tentativa atual,
um esgotamento `attempt=6/max_attempts=5` ou um status durável terminal continua
vencendo imediatamente.

O diagnóstico real de `Teste QR WWebJS` confirmou duas falhas independentes.
Primeiro, o worker estava persistido como `disponible`, com container executando
e saudável, mas o read-side transformava checkpoints nativos transitórios em
`offline`; essa conversão foi removida de rows, filtros, totais e banners.
Segundo, o probe genérico de 120 segundos encerrava o cliente WWebJS em uma
tentativa QR ativa. O `qrMaxRetries=5` do SDK limitava eventos, mas não provocava
cinco emissões.

O serviço WWebJS agora agenda uma renovação explícita a cada 25 segundos dentro
do fence de chamada do provider, conserva o mesmo `connection_attempt_id`, a
mesma runtime generation e o contador cumulativo, e publica no máximo cinco QRs
distintos. Falha ou ausência do evento de refresh por dez segundos recicla
somente o cliente interno e retoma a mesma tentativa; o probe de 120 segundos
cede enquanto essa tentativa estiver ativa. Timers são cancelados em
autenticação, online, remoção, perda de lease, handoff e encerramento explícito.
Depois que o quinto QR expira, o provider publica o terminal `6/5`, e somente
então o modal oferece **Reiniciar QR Code**. A resposta HTTP do primeiro QR foi
também alinhada para anunciar `max_attempts=5`, eliminando o antigo valor
genérico `10`.

O cache de credencial obedece à mesma fronteira: uma imagem só pode ser
reapresentada quando existe uma tentativa ativa e seu `connection_attempt_id`,
runtime generation e authorized connection epoch coincidem exatamente com o
envelope cacheado. O terminal remove a autoridade da tentativa, portanto seu
quinto QR não pode ser reaproveitado por um clique em **Reiniciar QR Code**,
mesmo que o TTL físico da chave Redis ainda não tenha acabado. O reinício limpa
a imagem local, mostra **Preparando QR Code**, enfileira uma tentativa nova e só
volta a exibir QR depois que o provider publicar uma credencial pertencente ao
novo `connection_attempt_id`.

No WhatsMeow, `is_new_login=true` informa apenas que o provider está no fluxo
de uma sessão nova; sozinho, esse campo **não prova leitura do QR**. A
apresentação só entra em **Conectando e pareando** quando existe progresso de
pareamento explícito ou evidência nativa autenticada. Enquanto o evento atual
continuar em `qr/awaitingRead`, o QR permanece visível e não pode ser consumido
por essa flag genérica.

Cada abertura de QR do WhatsMeow também possui agora um leitor cercado pela
combinação `runtime_generation + connection_attempt_id + reader_serial`. Ao
começar uma tentativa, o leitor anterior é cancelado antes de obter o novo
canal de QR. Um leitor supersedido não pode consumir, contar, republicar nem
rotular um QR com a tentativa seguinte. Isso elimina a espera artificial em
**Preparando QR Code** causada por goroutines antigas que disputavam o mesmo
canal nativo e garante que somente o leitor corrente alimente as cinco
gerações. Autenticação, reset, timeout, perda da tentativa ou nova abertura
cancelam o leitor ativo.

#### Fronteira `Desconectado/Offline → Aguardando leitura do QR code`

`Desconectado` e `Offline` descrevem a condição **anterior** a uma nova
tentativa. Eles não podem permanecer como apresentação depois que o manager
aceitou **Conectar Canal → QR Code**. A aceitação do grant da tentativa, a
transição do worker e o vínculo ao runtime são uma única transação: o manager
grava `worker.worker_status_id=disponible`, limpa a identidade da sessão
anterior e devolve o relógio durável `worker_status_observed_at`. Somente depois
desse commit o pedido entra no stream. A partir desse instante, tabela,
cabeçalho e modal exibem **Aguardando leitura do QR code**, tanto antes da
primeira imagem quanto durante suas renovações.

Uma leitura HTTP atrasada ainda pode carregar o `offline` anterior, mas não
pode regredir a tentativa já aceita. O envelope ativo em Redis conserva o ACK
do manager com `event_type=status`, `worker_status_id=disponible`,
`worker_status_observed_at`, `runtime_generation`,
`connection_attempt_id` e `authorized_connection_epoch`. Respostas coalescidas
e QRs recuperados do cache reaplicam esse ACK cercado, em vez de sobrescrevê-lo
com o snapshot antigo. O frontend aceita a publicação somente quando operação,
geração, tentativa e relógio pertencem à fronteira atual.

No logout remoto, alguns providers aposentam o ponteiro
`worker.container_id` antes que o processo físico termine. A recuperação não
adota um container apenas por ele existir: o manager exige a prova remota do
runtime exato — mesmo worker, account, provider, geração e container,
`activated=true`, `standby=false` e sem erro — e então religa o ponteiro por
CAS. Um ponteiro já ocupado por outro container nunca é substituído. Se essa
prova falhar, o pedido fecha sem criar QR; se o runtime estiver fisicamente
parado, o estado durável correto é `stopped`, com somente **Recriar**.

Essa fronteira é comum a Baileys, WWebJS e WhatsMeow e independe de
`session_storage=postgres` ou `legacy_volume`. Ela não transforma todo
`offline` automaticamente em `disponible`: a mudança ocorre somente após a
ação explícita do usuário e o grant cercado da nova tentativa ser aceito.

A regressão ampliada aprovou 709 testes em sete suites, ESLint de todos os
arquivos alterados, typecheck raiz, builds de `manager`, `service` e web e
`git diff --check`. No Playwright
autenticado, o Baileys 5 partiu do logout remoto, aceitou o QR com HTTP 202 e
UUID persistido de `disponible`, apresentou uma imagem real e manteve tabela,
cabeçalho e modal em **Aguardando leitura do QR code** inclusive ao fechar e
abrir novamente o fluxo. Não houve toast de indisponibilidade nem regressão
visual para `Offline`/`Desconectado`.

#### Reabertura imediata após logout com lease viva — 2026-08-10

Uma repetição posterior encontrou uma fronteira ainda mais específica. O
logout havia concluído corretamente: `worker.worker_status_id=disponible`,
header canônico `empty`, árvore operacional vazia e tombstone exato em
`disconnected_connection_epoch`. O container, porém, continuava saudável e o
mesmo writer mantinha sua lease viva. A preparação do novo pairing aceitava
lease liberada ou expirada depois de logout, mas aceitava lease viva somente
quando não existia tombstone; por isso rejeitava esse runtime íntegro com
`session_fence_invalid`, convertido no toast **Canal ainda não está disponível
para solicitar QR Code**.

A lease viva agora também é elegível quando o tombstone corresponde exatamente
ao `connection_epoch` corrente. A exceção não abre a fronteira: continuam
obrigatórios o mesmo provider, runtime generation, session writer epoch,
capability hash, owner presente e fencing token válido, além do header vazio e
da árvore sem sessão. Tombstone parcial/divergente, sessão com identidade,
lease de outro
runtime ou qualquer fence incompatível continuam falhando fechados. O grant
consumido instala um novo `authorized_connection_epoch` e limpa o tombstone
somente dentro da ativação cercada.

O contrato foi exercitado para Baileys, WWebJS e WhatsMeow. A regressão focada
aprovou 554 testes de disconnect, pairing activation, requester e command
handler, além de ESLint e typecheck raiz. No Playwright, o mesmo Baileys que
falhava reabriu o QR duas vezes consecutivas sem `503` ou toast; o banco
confirmou o grant consumido, o novo `connection_epoch`, native `qr` e o status
durável preservado em `disponible`.

## Atualização mais recente — rollout `1.34.37`, canário duplo e HOLD operacional

Esta seção substitui operacionalmente todas as instruções de “próxima rodada”
que aparecem mais abaixo. As seções anteriores continuam preservadas como
histórico e não autorizam retry, limpeza manual ou novo handoff fora da ordem
definida aqui.

### Rollout auditado antes do canário

O operador concluiu o build, instalou as novas imagens no servidor e atualizou
os warms. A auditoria somente leitura confirmou:

- Underchat em `b39286fcbf3322d38d64faf71b74897acc70b0b2`, alinhado com a origem;
- fork WWebJS em `bf84300cd2d927614e0a7b8bfdce5921035ecf62`, alinhado com a origem;
- pin, lockfile, contrato e `node_modules` em `1.34.37`;
- migration `20260808110000` aplicada e ABI de rollback causal 8/9 com ACL
  correta;
- imagem WWebJS ativa e dois warms no digest `sha256:de7fe3c4...`, todos
  healthy, restart zero e executando `1.34.37`;
- quatro warms Baileys e os pools dos demais providers prontos e saudáveis;
- manager HTTP 200, service com 27/27 consumers e lag/pending zero, balance
  saudável e sem drift;
- frontend Vite servido com a projeção imediata do ACK de recriação e os
  fences de conexão protegida;
- Redis sem lifecycle lock, redrive, self-heal ou slot causal nos dois canais;
- Kafka lifecycle Stable/lag zero e outbox sem item pendente causal.

O T0 final foi `2026-08-09T01:24:06.405935Z`
(`2026-08-08 22:24:06.405935-03`). O Baileys estava online em G17, revisão
2047; o WWebJS estava online em G24, revisão 2060. Nos dois, runtime/native,
ACK, sessão, lease, provider, epoch e capability estavam coerentes, QR era
falso, lifecycle era nulo e `previous_revision_id` era nulo.

### Disparo duplo e identidade das operações

Os dois Saves foram disparados uma única vez, em duas abas e sem retry, em
`2026-08-09T01:24:36.776Z`. O backend criou exatamente dois handoffs distintos:

| Direção          | Lifecycle operation                    | Handoff                                | Target             |
| ---------------- | -------------------------------------- | -------------------------------------- | ------------------ |
| Baileys → WWebJS | `019fe41f-32c1-720d-aa1b-a9e014e56c3a` | `7507b7b5-5eb0-45c0-899e-371c76359e59` | revisão 2071 / G18 |
| WWebJS → Baileys | `019fe41f-349d-7683-b829-8953563197bf` | `a7850fcd-22a5-4585-a091-b6ec889bf6c6` | revisão 2072 / G25 |

As operações foram criadas às `22:24:37.699-03` e `22:24:38.221-03`,
respectivamente. Ambas começaram sem QR e sem point-of-no-return.

O frontend desta imagem provou a correção do ACK de recriação: sem F5, a
tabela/header passaram imediatamente por `Recriando`/`Conectando`. Depois, as
publicações Centrifugo continuaram sendo a fonte realtime do status. Não foi
introduzido polling HTTP para apresentação.

### Resultado Baileys → WWebJS: falha causal durável, recovery seguro

A revisão 2071 falhou em `2026-08-08 22:25:18.462-03`, antes do
point-of-no-return e antes de persistir o primeiro artifact. A migration da
rodada anterior cumpriu seu objetivo: o mesmo código causal foi gravado na
revisão e no handoff:

```text
wwebjs_canonical_import_task_timeout
```

O task de inventário grande já recebia o budget correto de 240 segundos e a
imagem realmente continha `1.34.37`. A falha estava no control-plane do
`BrowserSessionBridge`: cada chamada `observe` tinha cap isolado de 10
segundos. Como ML-KEM executa trabalho síncrono no renderer, uma observação
podia ficar enfileirada atrás de mais de 10 segundos de crypto e ser declarada
timeout, embora o task page-local ainda estivesse dentro dos 240 segundos.

O subestágio exato não sobreviveu à remoção do container candidato. Pelo
inventário de 101 PQ prekeys e pela topologia do código,
`pq_pre_key_pair_validation` é a inferência mais forte, mas não deve ser
registrado como fato observado.

A correção local do fork WWebJS altera somente o RPC `observe`: ele pode usar o
restante do deadline já limitado do task. `start` e `consume` continuam em 10
segundos, `cancel` em 1 segundo, e o deadline page-local continua absoluto. O
teste de regressão bloqueia a observação por 15 segundos dentro de um task de
30 segundos e comprova conclusão/consume sem ampliar o budget.

O recovery do source Baileys usou a operação
`3dbba7f9-bc21-4bb0-a11e-f2262a759df1`. O source voltou online em G19,
revisão 2047, com ACK verdadeiro e QR falso, e o recovery concluiu em
`22:26:00.137-03`. Depois da prova terminal, foi executado exatamente um
**Retornar com segurança**:

- resolution operation `019fe42c-78d3-73fe-b5d7-c598d4dda8ec`;
- `return/completed` entre `22:39:07.604-03` e `22:39:07.609-03`;
- nenhuma alteração adversa de runtime, lease, sessão ou revisão.

### Resultado WWebJS → Baileys: SQLSTATE 25006 e lifecycle ainda preso

A candidata Baileys G25, revisão 2072, container `fe27fa2a...`, hidratou 1273
registros/227207 bytes. Ao iniciar a validação do resync, o log preservou a
causa primária exata:

```text
SQLSTATE 25006: cannot execute SELECT FOR SHARE in a read-only transaction
```

O caminho foi:

```text
readAppStateSnapshotResyncReadiness
→ PostgresSessionLease.assertScopeInTransaction
→ begin_whatsapp_session_operation
→ SELECT ... FOR SHARE
```

O caller Baileys abria a leitura como `REPEATABLE READ READ ONLY`, mas a prova
de lease deliberadamente usa `FOR SHARE`. O wrapper reclassificou o resultado
como `LEASE_LOST`; não houve perda real inicial da lease. A correção local do
fork Baileys remove apenas `READ ONLY` dessa transação, preservando
`REPEATABLE READ`, o fence e a ordem das leituras.

Como o handler ficou bloqueado sem terminalizar o handoff, a lease candidata
expirou depois. O monitor antigo passou a republicar o journal original sempre
que lock/cooldown expiravam. Foram observados redrives da **mesma** operação —
não novos handoffs — por volta de `22:30:00-03` e `22:45:01-03`. O Kafka chegou
a acumular poucas mensagens na partição correspondente, enquanto cada novo
handler voltava a aguardar a candidata já sem lease.

A causa do loop é que os dois caminhos de redrive verificavam worker/idade e
locks Redis, mas não reconciliavam o handoff PostgreSQL `validating`, sem PONR,
com target não promovido e lease expirada.

Na última leitura somente leitura, em `22:59:46-03`:

- o handoff `a7850fcd-...` ainda estava `validating`;
- `error_code` estava vazio, `recovery_state=none` e PONR era nulo;
- o worker permanecia `recreating` em G25;
- a revisão target 2072 continuava não promovida e a lease target estava
  expirada;
- a revisão source WWebJS 2060 ainda não havia sido restaurada ao runtime;
- não existia um caminho seguro de Return, porque o handoff não era terminal.

Não fazer retry, não limpar Redis, não remover container e não editar o banco
manualmente. O rollout atual não consegue sair desse loop sozinho.

### Reconciliador local do target stale

A migration local `atlas/prod/20260808120000.sql` adiciona a capability
control-plane `fail_stale_whatsapp_handoff_target(uuid, uuid, uuid)`. Ela usa
`SECURITY DEFINER`, `search_path` fixo, timeouts limitados e locks na ordem:

```text
worker → runtime → lease → session → source revision → target revision → handoff
```

A função só age quando todas as provas exatas coincidem: lifecycle/account,
worker source em `recreating`, sessão PostgreSQL ainda no source, target em
`hydrating|validating`, bootstrap completo e não-retired, runtime/lease/epoch/G
do target, lease expirada além da grace, target não promovido, PONR e artifact
pré-ativação nulos. Lease viva, target promovido, estado posterior ou qualquer
mismatch retornam `not_applicable` sem mutação.

No caso elegível, a mesma transação:

1. marca target `failed/retired` com
   `whatsapp_handoff_target_lease_expired_before_promotion`;
2. reafirma source revision ativa e sessão `ready` no source;
3. marca o handoff `failed`;
4. exige que o trigger existente gere recovery `pending` com UUID diferente da
   operação original.

Replay exato retorna `recovery_owned` e nunca ressuscita o journal target,
inclusive se o recovery estiver `blocked`, `cancelled` ou `completed`.
`whatsapp_session_runtime` não recebe EXECUTE; somente o role control-plane que
aplicou a migration pode chamar a capability.

O `WorkerMonitor` chama esse reconciliador antes de claim/publish nos dois
caminhos de redrive. `failed` ou `recovery_owned` encerram o redrive original;
erro de prova falha fechado. A migração precisa ser aplicada pelo mesmo
`DB_USER=under` usado pelo service antes de o código novo subir.

Checksum Atlas:

- raiz: `h1:uZVcHsHpJJVKoXdkckuW9cEEgwRd3p1C5POWUtCuUVM=`;
- `20260808120000.sql`:
  `h1:F41TVWpfkyhRtXMKMLRhBE8Sub5uOW51iDD6e+5uWBQ=`.

A prova PostgreSQL 17.10 aplicou as 281 migrations como owner `under`
não-superuser, com RLS, FKs, constraints e triggers ativos. O harness live-like
confirmou: uma transição `failed/pending`, replays `recovery_owned` em
pending/blocked/cancelled/completed, UUID de recovery distinto, e
`not_applicable` sem mutação para lease viva, PONR, target promovido e mismatch.
ACL: `under=true`, `whatsapp_session_runtime=false`.

### Frontend: contrato final dos dois modais e do realtime

A formulação correta, conforme esclarecido pelo operador, é:

- ao aceitar **Trocar canal** em um handoff PostgreSQL, abrir imediatamente o
  modal informativo `Migrando canal`;
- header, tabela e conteúdo desse modal podem avançar por Centrifugo;
- não executar polling HTTP periódico para status;
- não abrir nem renderizar o seletor de nova conexão durante o handoff;
- somente um resultado durável `freshSession` pode desmontar o informativo e
  remontar o fluxo de conexão nova;
- em falha, o diálogo protegido substitui o informativo.

O patch local faz `handleChannelUpdated()` montar o `AppConnectChannel` com
`isSessionMigration=true` no mesmo tick do ACK, antes de qualquer refresh da
lista. Nesse contexto, o normalizador retorna sempre `migrating`, inclusive
diante de publicações transitórias de error/logout/QR/passkey/online.

`canOfferNewConnection=false` bloqueia e limpa seletor, QR, pairing, passkey,
secure helper, link externo, downloads, ações e todos os entrypoints de polling
HTTP seguro. A assinatura Centrifugo continua ativa exclusivamente para
projetar status. O callback de recovery fecha o informativo sincronicamente
antes de expor o diálogo protegido.

Também foi fechada a corrida que deixava o source recuperado em `Conectando`
até F5/Return: um snapshot `recovery_state=completed` que chega durante uma
flight iniciada com `running` agora fica pendente na mesma flight e é consumido
uma vez. Não há timer, segundo state machine, polling HTTP ou tombstone falso.

### Gates locais desta rodada

- frontend: 6 suites, 151/151; root `tsc`, web `vue-tsc`, Prettier, diff-check
  e build Vite verdes; ESLint sem erro nos arquivos cobertos;
- WWebJS BrowserSessionBridge: 128/128; suites relacionadas e revisão
  adversarial também verdes;
- Baileys session store: 94/94; typecheck/build/Prettier/diff-check verdes;
- backend reconciliador: 3 suites, 203/203; typecheck, lint, Prettier,
  `test:locations` e diff-check verdes;
- PostgreSQL 17.10 live-like e ACL/RLS conforme descrito acima.

Esses resultados são **GO técnico local**. O canário live desta rodada é
**HOLD operacional**: B→W recuperou com segurança, mas W→B permanece preso e
os três patches de runtime/backend ainda não foram publicados nesse ambiente.

### Próxima rodada obrigatória

Executar exatamente nesta ordem:

1. versionar/publicar os forks WWebJS e Baileys com os fixes desta seção;
2. atualizar pins, locks e contratos de dependência no Underchat;
3. aplicar `20260808120000` **antes** do service novo, usando `DB_USER=under`,
   e provar `has_function_privilege(under)=true` e runtime=false;
4. build/deploy do service/manager/balance e web, mais imagens Baileys/WWebJS e
   warms; confirmar digests, versões, health e restart zero;
5. sem emitir novo Save, observar o monitor novo reconhecer a operação W→B já
   presa, gravar `failed/recovery pending` e restaurar automaticamente o source
   WWebJS da revisão 2060;
6. somente após recovery terminal e prova ONLINE/ACK/lease/session, executar um
   único **Retornar com segurança** para fechar a resolução pendente;
7. validar na interface, sem F5: modal informativo abre imediatamente, nunca
   aparece chooser/QR/link, status avança por Centrifugo e eventual recovery
   substitui corretamente pelo diálogo protegido, sem polling HTTP;
8. só então repetir uma vez cada direção Baileys → WWebJS e WWebJS → Baileys,
   com operations/handoffs independentes e sem retry.

Critério de aprovação da próxima tentativa: B→W atravessa o import sem falso
`wwebjs_canonical_import_task_timeout`; W→B atravessa o resync sem SQLSTATE
25006; ambos promovem o target e terminalizam com provider/revision/runtime/
lease/ACK coerentes, PONR esperado, QR falso, outbox publicado e Kafka lag zero.

## Atualização anterior — rollout `1.34.36`, correções web e novo canário

Esta seção é o checkpoint operacional anterior. As seções seguintes
permanecem como histórico imutável das rodadas anteriores.

O rollout do fork WWebJS `1.34.36` já havia sido concluído pelo operador, com
nova imagem instalada no servidor e warms atualizados. Depois desse rollout,
as três recriações concorrentes terminaram em estado seguro:

| Provider  | Operação de recriação                  | Geração terminal | Conclusão       |
| --------- | -------------------------------------- | ---------------: | --------------- |
| Baileys   | `019fe3b6-8ccc-77ac-8aae-28a250e05702` |              G14 | `23:30:57.664Z` |
| WWebJS    | `019fe3b6-a76b-7386-bd02-5fdd10d29c93` |              G23 | `23:33:02.403Z` |
| WhatsMeow | `019fe3b6-b081-7304-9acc-f07a70b25330` |               G7 | `23:31:03.892Z` |

O T0 de auditoria posterior foi `2026-08-08T23:34:23.758Z`. Nesse ponto, os
três canais estavam online, com native online, ACK verdadeiro, QR falso,
lifecycle nulo, sessão `ready`, lease viva, revisão anterior nula e containers
healthy/restart zero. Redis estava sem locks ou slots residuais causais, Kafka
estava Stable/lag zero e os warms estavam prontos. O WWebJS ativo e seus dois
warms executavam o pacote `1.34.36`, no digest `f94bb693...`.

### Recriação aceita pelo backend, mas sem atualização imediata na interface

Ao recriar os três canais, o backend aceitou as operações, porém a tabela e o
banner não mostraram imediatamente o novo estado. O status correto só apareceu
depois de F5. A causa ficou isolada no frontend:

1. `channelsStore.recreateChannel()` recebia o ACK durável `202`,
   `queued/recreating`;
2. o ACK atualizava somente o store legado, por mutação local;
3. tabela e banner leem prioritariamente a máquina canônica
   `channelStatusPresentation`;
4. essa máquina só convergia quando chegava um evento Centrifugo ou quando um
   novo GET era feito no reload.

A correção local adiciona `applyAcceptedRecreateAck()` ao store canônico. O
ACK é aceito somente quando corresponde ao envelope exato de recriação
assíncrona e passa pelas mesmas regras de redução, geração e fences dos eventos
do manager. A página de canais encaminha o ACK HTTP diretamente para essa ação,
de modo que `Recriando` apareça imediatamente, sem esperar realtime e sem F5.

O teste cobre três ACKs no mesmo tick, um para cada provider, incluindo canais
que carregavam tombstones de recovery de handoff, além da rejeição de um ACK
mais antigo que o estado já projetado.

### Modal de nova conexão indevido durante handoff preservado

Também foi reproduzido o comportamento relatado pelo operador: durante uma
troca de provider com sessão PostgreSQL preservada, aparecia primeiro o modal
geral de conexão/seleção de método e, muito depois, o diálogo de recuperação ou
decisão protegida do handoff. Esse fluxo era incorreto. O modal de nova conexão
deve aparecer somente para uma conexão realmente nova, nunca durante a fase
normal de uma migração preservada.

A causa estava em dois níveis:

- `handleChannelUpdated()` abria o diálogo geral antes de distinguir handoff
  preservado de reset destrutivo;
- `AppConnectChannel` ainda podia normalizar QR, selecionar um método, pedir
  QR, criar link externo ou renderizar ações de pairing mesmo com
  `isSessionMigration=true`.

A correção local separa os caminhos:

- handoff preservado inicia somente o monitor/diálogo protegido da migração;
- o modal geral fica fechado durante toda a migração;
- reset destrutivo/legado continua abrindo o modal de conexão;
- se o backend comprovar mais tarde `freshSession`, o modal geral pode então
  ser aberto para a conexão nova;
- enquanto `isSessionMigration=true`, o estado visual permanece `migrating` e
  ficam cercados o seletor de método, QR, pairing/passkey, links externos,
  instaladores, recuperação de QR histórico e respectivas ações/efeitos;
- um erro terminal real continua sendo apresentado como `disconnected`.

> Nota de supersessão: essa foi a formulação intermediária da rodada
> `1.34.36`. O contrato vigente está na atualização `1.34.37` acima: o mesmo
> componente pode ser montado imediatamente como **modal informativo**
> `Migrando canal`, mas chooser/QR/link/ações e polling HTTP permanecem
> proibidos; em falha, o diálogo protegido o substitui.

As duas correções web foram aprovadas em revisão adversarial. Os gates locais
registrados foram:

- 118 testes em quatro suites, todos passando;
- typecheck raiz e `vue-tsc` web passando;
- ESLint TypeScript, Prettier e `git diff --check` passando;
- build web de produção passando, somente com warnings baseline de CSS,
  chunks e VueUse.

Essas correções são locais nesta árvore e precisam integrar o próximo
build/rollout para a prova live específica dos dois comportamentos.

### Canário desta rodada: somente Baileys → WWebJS foi aceito

O exercício pretendia disparar uma vez cada uma das duas direções:

- Baileys → WWebJS;
- WWebJS → Baileys.

As duas telas foram preparadas e os saves foram acionados juntos, porém somente
a requisição Baileys → WWebJS foi efetivamente emitida/aceita. O canal WWebJS
original não gerou request, journal, lifecycle operation nem handoff para
WWebJS → Baileys. O motivo provável é uma limitação do despacho concorrente do
controle de browser, mas isso não foi tratado como prova de defeito da
aplicação.

Conforme a regra de isolamento, não houve um segundo clique nem qualquer retry
de nenhuma das direções depois que a operação aceita encontrou o blocker.

Identidades da única tentativa criada:

| Campo               | Valor                                  |
| ------------------- | -------------------------------------- |
| Direção             | Baileys → WWebJS                       |
| Lifecycle operation | `019fe3c1-1446-7234-813c-7e9032370ffc` |
| Handoff             | `dd96832d-2e1c-4e02-a1ac-3fa821bd24b8` |
| Revisão candidata   | 2070                                   |
| Geração candidata   | G15                                    |
| Container candidato | `8555b5a...`                           |
| Início              | `23:41:49.513Z`                        |

O source Baileys produziu um checkpoint de 2268 registros, 619587 bytes e
checksum `b76819ea...`; o ACK de drain ocorreu em `23:41:55.633Z`. A candidata
WWebJS usou a imagem `f94bb693...` e pacote `1.34.36`.

Ao contrário da falha da rodada anterior, a otimização de PQ funcionou: a
transformação/materialização percorreu as 101 PQ prekeys, as tabelas e
registros do provider e o resync gate. Essa etapa terminou por volta de
`23:41:59.324Z`, sem repetir o antigo deadline serial de PQ.

A falha seguinte ocorreu no bootstrap offline do Chromium, depois da
transformação completa e antes do primeiro artifact/checkpoint canônico da
candidata. A revisão 2070 foi marcada `failed/retired` em
`23:42:31.121Z`; o handoff terminou `failed` em `23:42:31.124Z`. A candidata
ficou com `size_bytes=0`, sem `persisted_at`, sem `validated_at`, sem outbox ou
runtime target publicado. O point-of-no-return permaneceu nulo.

O limite causal comprovado é, portanto:

> depois da transformação/materialização e do resync gate, mas antes do
> primeiro artifact/checkpoint da candidata.

Não atribuir uma causa mais específica a essa falha sem nova evidência
durável.

### Recovery, retorno seguro e estado terminal

A recuperação automática usou a operação
`a158e69a-c0e1-4e0d-aa77-eaf8f95e0c45`:

- começou em `23:42:45.022Z`;
- restaurou o source Baileys na G16, container `1c26ae...`;
- atingiu native online em `23:42:50.325Z`;
- recebeu ACK do manager em `23:43:15.564Z`;
- concluiu em `23:44:00.029Z`.

Houve apenas um `recovery_last_error=worker_lifecycle_lock_active` transitório
durante a convergência; ele não permaneceu no terminal. A revisão 2047
continuou ativa, `previous_revision_id` permaneceu nulo e o canal voltou
online/ACK/QR falso com sessão, lease e runtime coerentes.

Depois da prova de recuperação, a ação idempotente **Retornar com segurança**
foi executada uma única vez. A resolution operation
`019fe3c5-ba1c-716b-8eaf-8c5e90cd1c6b` registrou `return/completed` entre
`23:46:54.108Z` e `23:46:54.111Z`, sem alterar runtime, sessão, lease, geração
ou revisão.

O canal WWebJS original permaneceu intocado em G23, revisão 2060, container
`725e702...`, online e com ACK. O WhatsMeow permaneceu saudável em G7. Ao
final:

- Baileys estava novamente online em G16 e revisão 2047;
- WWebJS estava online em G23 e revisão 2060;
- WhatsMeow estava online em G7;
- lifecycle, handoff, recovery e resolution ativos estavam zerados;
- QR e point-of-no-return permaneceram ausentes;
- não houve novo dead letter causal, lock/slot/self-heal residual ou restart;
- outbox terminou publicado, Kafka Stable/lag zero e containers healthy;
- a interface voltou a mostrar os três como `Conectado` sem F5 depois do
  recovery/return.

### Persistência causal e defesa do bootstrap — concluídas localmente

A inspeção comprovou uma lacuna de observabilidade: o erro causal chegava ao
rollback do session store, mas a persistência durável gravava somente códigos
genéricos como `handoff_rolled_back`/`rolled_back`. Como o log do container
candidato é efêmero e o container é removido durante a compensação, não foi
possível recuperar depois do fato o erro exato desta falha de bootstrap.

Essa lacuna foi corrigida localmente pela migration
`atlas/prod/20260808110000.sql`. Ela adiciona como ABI atual o overload de nove
argumentos:

```text
rollback_whatsapp_session_revision(
  uuid, bigint, bigint, uuid, bigint, integer, uuid, text, text
)
```

O nono argumento é o código causal. A função o aceita somente quando casa com
`^(handoff|whatsapp|wwebjs)_[a-z0-9_.-]{1,91}$`; qualquer valor ausente,
inválido ou potencialmente sensível vira `handoff_validation_failed`. O mesmo
código sanitizado é escrito atomicamente em
`whatsapp_session_revision.error_code` e
`whatsapp_session_handoff.error_code`, preservando a transação, a ordem de
locks e os fences preexistentes.

O overload antigo de oito argumentos continua disponível exclusivamente para
rolling deployment e delega ao core novo com o fallback genérico. As duas
assinaturas são `SECURITY DEFINER`, têm `search_path` fixo, não concedem
`EXECUTE` a `PUBLIC` e concedem `EXECUTE` ao role
`whatsapp_session_runtime`. O installer e o guia standalone do fork também
documentam e concedem as duas assinaturas durante a janela de compatibilidade.

Checksums Atlas depois da regeneração:

- raiz: `h1:zrd2PsAq8+vxXRS5hqbas/27HA6zC5zZ9C/SFYgYG7s=`;
- `20260808110000.sql`:
  `h1:sdkK7jrhiVgDn+Tp8V+6IrVjBlBolFtuqajKsEdnTSo=`.

No fork WWebJS, `PostgresSessionStore` agora sanitiza o código uma única vez,
envia o mesmo valor como nono argumento e registra somente esse valor seguro.
Foram atualizados:

- `src/session/PostgresSessionStore.js`;
- `sql/install-postgres-session-store.sql`;
- `docs/POSTGRES_SESSION_STORE_SCHEMA.md`;
- os contratos do store e do installer.

Também foi adicionada defesa em profundidade ao bootstrap offline de uma
revisão staged de handoff:

- runtime e reload usam orçamento autoritativo de 120 segundos;
- módulos usam 60 segundos;
- repair offline permanece limitado a 30 segundos;
- o credential guard é rearmado explicitamente depois do reload e antes do
  segundo import/reseal;
- falhas de reload ganham códigos duráveis por estágio, inclusive
  `wwebjs_canonical_reload_runtime_stability_timeout`, sem incluir erro bruto,
  chave, payload ou segredo;
- o fluxo comum, fora de uma revisão staged, preserva os budgets anteriores;
- o contrato público do Underchat prova que `connect()` com handoff pendente
  cria o cliente com `authTimeoutMs=150000`.

Os arquivos desse complemento são `RemoteAuth.js`,
`BrowserSessionBridge.js`, seus testes e o contrato de `connection.service` no
Underchat.

Validação final e revisão adversarial:

- fork combinado: 276 testes passando e 1 integração condicionada a
  PostgreSQL externo;
- installer em PostgreSQL 17: 4/4, incluindo concorrência e idempotência;
- Underchat afetado: 119/119 testes;
- cadeia Atlas completa de 280 migrations até `20260808110000`, seguida de
  duas reaplicações controladas da migration e E2E PostgreSQL, tudo verde;
- overloads 8/9, ACL, `search_path`, sanitização e atomicidade verificados;
- TypeScript, ESLint, Prettier e `git diff --check` verdes;
- dois blockers encontrados na revisão foram fechados: o `GRANT` standalone da
  ABI 9 e o rearm do credential guard antes do reseal.

**Limite obrigatório da conclusão:** não existe prova de que o incidente live
foi causado por `authTimeoutMs=30000`. O fluxo esperado do Underchat já
fornecia 150 segundos, e a janela observada de aproximadamente 29 segundos
também pode incluir o repair offline de 30 segundos. Portanto o patch recebe
**GO técnico**, mas Baileys → WWebJS continua em **HOLD operacional** até a
migration, a nova versão/imagem/warm e um novo canário. A entrega torna uma
eventual próxima falha causalmente durável e adiciona uma defesa segura; ela
não autoriza declarar a falha anterior resolvida por inferência.

Há ainda um caveat não bloqueante a observar: o watchdog de inicialização do
Underchat é 210 segundos, menor que a soma dos máximos teóricos de todos os
estágios da lib. Ele é preexistente e não explica o rollback em cerca de 29
segundos. O código causal persistido deverá indicar se esse watchdog se tornar
o próximo limite.

### Próxima rodada obrigatória

Não repetir o canário com as imagens atuais. A próxima rodada deve obedecer à
seguinte ordem:

1. escolher a próxima versão livre do fork WWebJS, publicar o tarball real e
   atualizar/pinar o Underchat com sua versão e integrity reais;
2. rodar novamente testes, typechecks, lint, formatter, build e contratos de
   migration e
   dependência afetados;
3. aplicar e validar `20260808110000.sql` no PostgreSQL antes de colocar o novo
   runtime em produção;
4. gerar e implantar manager, service, balance e worker WWebJS da mesma árvore,
   além de
   atualizar todos os warms WWebJS;
5. incluir no mesmo rollout web as duas correções visuais desta seção: ACK de
   recriação imediato e supressão integral do modal comum durante handoff;
6. provar versão e digest dentro do WWebJS ativo e dos warms, e confirmar a
   nova assinatura/função no PostgreSQL;
7. executar preflight somente leitura dos canais Baileys G16, WWebJS G23 e da
   infraestrutura compartilhada;
8. repetir **uma única vez cada** Baileys → WWebJS e WWebJS → Baileys no mesmo
   ciclo, usando um mecanismo de despacho comprovadamente duplo;
9. só considerar o despacho concluído depois de observar duas requisições
   distintas, dois ACKs `202`, dois operation IDs e dois journals associados
   aos canais corretos; não confiar apenas em um `Promise.all` de cliques do
   controle de browser;
10. se somente uma requisição for observada, não clicar novamente na mesma
    rodada: parar, preservar o estado e investigar o despacho incerto;
11. validar ao vivo que `Recriando` aparece no ACK sem F5 e que nenhuma API,
    QR, pairing, link ou modal comum de conexão aparece durante o handoff
    preservado;
12. parar imediatamente no primeiro blocker. Se houver rollback, o novo código
    causal deverá permanecer durável antes da remoção do container candidato.

Somente depois de as duas direções desse par terminarem verdes deve-se avançar
para o próximo par da matriz solicitado pelo operador.

## Atualização mais recente — primeira rodada bidirecional de handoff

Esta é a atualização operacional mais recente e substitui o HOLD que aguardava
uma rotação espontânea de nove para onze app-state sync keys. O operador
autorizou conscientemente um exercício controlado com dois canais em paralelo,
preservando a regra de parar no primeiro problema e nunca repetir uma operação
incerta.

As duas direções exercitadas foram:

- canal originalmente WWebJS: **WWebJS → Baileys**;
- canal originalmente Baileys: **Baileys → WWebJS**.

As duas tentativas chegaram a falhas diferentes antes do point-of-no-return,
foram revertidas automaticamente e mantiveram as revisões de sessão originais.
Nenhum retry de handoff, descarte de sessão, limpeza manual de Redis ou edição
manual de PostgreSQL foi executado. As duas causas foram reproduzidas no código,
corrigidas no fork WWebJS e aprovadas por revisão adversarial independente.

### T0 e identidades da rodada

T0 conjunto: `2026-08-08T20:42:33.417Z`.

| Linha            | Worker                                 | Estado de origem no T0    | Cursor outbox |
| ---------------- | -------------------------------------- | ------------------------- | ------------: |
| WWebJS → Baileys | `019fd88a-2894-739b-9471-cd3502f648df` | WWebJS G21, revisão 2060  |          2317 |
| Baileys → WWebJS | `019fd752-2c52-74fa-8924-a6e8f7d7df97` | Baileys G11, revisão 2047 |          2295 |

Nos dois canais, antes do disparo:

- worker/runtime online, ACK verdadeiro e QR falso;
- sessão PostgreSQL `ready`, lease viva e geração/epoch/capability coerentes;
- `lifecycle_operation_id` nulo;
- nenhum handoff, recovery ou resolution ativo;
- Redis sem lifecycle lock, redrive, self-heal, liveness ou recreate slot;
- Kafka Stable e com lag zero;
- containers ativos healthy/restart zero;
- quatro warms Baileys e dois warms WWebJS `ready`, todos nos digests da
  imagem `v20260808193411469`.

O WWebJS ainda apresentava browser e PostgreSQL convergentes em nove sync keys,
2302 registros e 110214 bytes. A espera indefinida por uma rotação natural foi
substituída, por autorização explícita, por esta prova de handoff cercada.

### Operações emitidas uma única vez

| Direção          | Operação lifecycle                     | Handoff                                | Revisão candidata |
| ---------------- | -------------------------------------- | -------------------------------------- | ----------------: |
| WWebJS → Baileys | `019fe31e-1b18-772e-bbcf-2587fb653723` | `63aa24e4-f03f-41ab-801c-becf8f195ad5` |              2068 |
| Baileys → WWebJS | `019fe31e-1ddb-760e-91e5-ab187bbf5341` | `33494873-c8ac-488e-8ae7-44c8e5c13eef` |              2069 |

Os IDs são distintos e ficaram associados aos `session_id` corretos. Não houve
mistura de worker, lease, revisão, pool ou operação entre as duas linhas.

### Falha WWebJS → Baileys: corrida entre checkpoints do source

O source WWebJS exportou a projeção canônica de 2302 registros/nove sync keys e
registrou `handoff.app_state_snapshot_resync_normalized` em
`20:43:57.032Z`. O checkpoint do source falhou em `20:44:02.085Z` com:

- SQLSTATE `23503`;
- constraint `whatsapp_artifact_chunk_blob_fk`;
- DML afetada: inserção dos mappings em `whatsapp_artifact_chunk`;
- relação exigida: `(session_id, sha256)` apontando para
  `whatsapp_artifact_blob(session_id, sha256)`.

A ordem causal foi confirmada no código e nos timestamps:

1. um checkpoint periódico já estava em voo;
2. `prepareHandoff()` cancelava novas agendas, mas não drenava nem fechava toda
   a admissão de `checkpointTail`;
3. o handoff construiu/uploadou seus blobs;
4. o checkpoint concorrente terminou executando
   `prune_whatsapp_orphan_artifact_blobs`, cuja versão atual remove blobs sem
   mapping imediatamente;
5. o handoff tentou inserir os chunks depois de os blobs correspondentes terem
   sido removidos e recebeu a FK.

A tentativa falhou antes do point-of-no-return. A candidata 2068 foi marcada
`failed/retired`; a revisão 2060 permaneceu ativa.

#### Correção local no fork WWebJS

`RemoteAuth.prepareHandoff()` agora:

- fecha sincronicamente a admissão de checkpoints antes de callbacks;
- recusa inclusive checkpoints `force`, `storeRemoteSession` e critical
  reentrantes enquanto o handoff possui a fence;
- drena o writer já admitido com limite máximo de 90 segundos;
- revalida autorização e linhagem depois da espera e antes de quiescer ou
  encerrar Chromium;
- mantém a source fail-closed/fenced em timeout para o recovery do manager;
- usa single-flight real por chave; a mesma chave recebe literalmente a mesma
  `Promise`, e uma chave divergente é rejeitada;
- não reabre a admissão se um retry desautorizado ocorre depois de um timeout;
- instala `shutdownRequested`, `authReady=false` e a fence antes de publicar o
  estado `handoff_preparing`, fechando também a reentrância por callback.

Os testes adversariais cobrem writer já em voo, checkpoint `force` tardio,
reentrância no callback, igualdade da `Promise`, chave divergente, timeout e
retry posterior desautorizado com a fence preservada.

### Falha Baileys → WWebJS: validação PQ serial acima do deadline

O import da candidata WWebJS começou em `20:44:19.343Z`. A projeção possuía
1945 registros e 101 PQ prekeys. Cada chave executava sequencialmente uma
assinatura e um par ML-KEM `encapsulate + decapsulate`; portanto eram 202
operações KEM serializadas dentro do único budget de 120 segundos.

O primeiro progresso durável disponível do stage
`pq_pre_key_pair_validation` foi `20:44:30.993Z` (`duration_ms=11649`). Os
demais pontos observados foram:

- `20:44:46.187Z`, `duration_ms=26844`;
- `20:45:01.336Z`, `duration_ms=41994`;
- `20:45:16.523Z`, `duration_ms=57179`;
- `20:45:31.687Z`, `duration_ms=72344`;
- `20:45:46.806Z`, `duration_ms=87463`.

O deadline calculado foi `20:46:19.343Z`. A revisão 2069 foi aposentada em
`20:46:19.502759Z` e o rollback concluiu em `20:46:19.505512Z`, cerca de 162
ms depois do deadline. Lease permaneceu saudável e QR ficou falso; não foi
deadlock, falha de PostgreSQL, IndexedDB ou storage.

#### Correção local no fork WWebJS

O import canônico agora:

- valida shape e assinaturas antes de qualquer escrita;
- mantém a prova integral `encapsulate + decapsulate` para cada PQ prekey;
- processa os pares em batches determinísticos com concorrência máxima quatro;
- usa `Promise.allSettled` para drenar todos os siblings antes de falhar ou
  limpar segredos;
- só materializa cópias privadas depois de todas as 101 provas passarem;
- zera `ArrayBuffer` e views tanto no sucesso quanto na falha;
- publica apenas progresso agregado `completed/total` e contagem segura;
- mantém cancel/deadline fail-closed a cada batch;
- limita RPCs de controle do Chromium: start/observe até 10 segundos, consume
  10 segundos, cancel best-effort de um segundo e uma observação terminal final
  que não estende o deadline criptográfico;
- usa 240 segundos por import quando há mais de 32 PQ prekeys;
- usa credential guard de 300 segundos e o rearma depois de cada import,
  reload e reseal.

O caso determinístico de 101 chaves prova 202 operações, máximo de quatro em
voo e nenhuma escrita se a decapsulation 98 falha enquanto a 100 ainda está
pendente. O teste também prova drain dos siblings e wipe dos inputs, shared
secrets e cópias intermediárias.

### Rollback e estado final seguro

As duas recuperações automáticas terminaram sem intervenção manual:

- canal originalmente Baileys: voltou a Baileys em G13, container
  `54f2d2b...`, revisão ativa 2047;
- canal originalmente WWebJS: voltou a WWebJS em G22, container
  `cce91ab...`, revisão ativa 2060.

Nos dois casos:

- worker/runtime online, ACK verdadeiro e QR falso;
- sessão, lease, runtime, provider, geração, epoch e capability coerentes;
- revisão original ativa, `previous_revision_id` nulo;
- candidata failed/retired;
- point-of-no-return nulo;
- recovery `completed`;
- containers healthy/restart zero;
- outbox causal publicado e sem pending/DLQ;
- Kafka Stable/lag zero;
- Redis sem lifecycle lock ou recreate slot.

Um cooldown Redis da operação Baileys → WWebJS permaneceu apenas com TTL
decrescente. Ele não era lock nem lifecycle ativo e deve expirar naturalmente;
não removê-lo manualmente.

### Fechamento explícito das duas recuperações

Depois de as sources estarem comprovadamente restauradas, a interface ainda
apresentava a decisão segura porque os dois handoffs estavam `failed`, com
`resolution_required=true`, mas sem linha de resolution. Nesse estado, a ação
**Retornar com segurança** é um fechamento idempotente: apenas registra a
decisão `return/completed`; não recria runtime, não troca revisão, não altera
lease/sessão e não publica lifecycle em Kafka.

As duas decisões foram confirmadas uma vez cada:

| Handoff                        | Resolution operation                   | Conclusão local (UTC-3) |
| ------------------------------ | -------------------------------------- | ----------------------- |
| Baileys → WWebJS `33494873...` | `019fe34b-b6bc-727b-b17b-c7d98aadf645` | `18:33:37.856763`       |
| WWebJS → Baileys `63aa24e4...` | `019fe34b-df1d-720d-af4a-3dfd623f61d4` | `18:33:48.190896`       |

O recheck posterior confirmou:

- `action=return`, `state=completed` e `last_error` nulo nos dois;
- handoffs históricos continuam `failed`, PONR nulo e recovery `completed`;
- `unresolved_failed=0`, `incomplete_resolution=0` e `active_handoff=0` para
  os dois canais;
- workers, runtimes, containers, gerações G13/G22, capabilities, epochs,
  revisões 2047/2060 e ACKs não foram alterados;
- zero outbox, journal, redrive, lifecycle lock, self-heal, liveness ou slot
  associado às duas resolution operations;
- Kafka não contém as resolution operations e permaneceu Stable/lag zero.

Isso removeu o bloqueio `previous whatsapp provider handoff requires
resolution` sem apagar a evidência forense das duas falhas.

### Correção da convergência visual depois do rollback

A recuperação do backend estava correta, mas a aba que iniciou as duas trocas
continuou exibindo o canal originalmente Baileys como `Conectando` e o canal
originalmente WWebJS como `Recriando`. Uma segunda aba, após um único GET
autoritativo, mostrava imediatamente os três canais como `Conectado`. Isso
isolou o problema na projeção em memória da primeira aba, não no runtime,
PostgreSQL, Redis, Kafka ou Centrifugo.

Havia três componentes na causa:

1. um handoff que falha e restaura a source não grava
   `recreate_completed_*`, porque não é uma recriação bem-sucedida;
2. o monitor de recovery da página mantém apenas um diálogo ativo, enquanto a
   rodada executou dois handoffs independentes ao mesmo tempo;
3. uma resposta HTTP ou publicação manager atrasada podia reinstalar a operação
   encerrada depois de a source já ter sido restaurada.

A correção preserva `channelStatusPresentation` como única máquina de estado
canônica e não fabrica um tombstone de recreate. Ela acrescenta uma redução
específica `provider_handoff_source_recovery`, aceita somente quando existe:

- journal durável exato do handoff;
- recovery `completed`, source revision preservada e source runtime restaurada;
- uma das duas terminações mutuamente exclusivas:
  - recovery automático ainda aguardando a decisão do operador; ou
  - resolução explícita `return/completed`, com seu operation ID exato;
- GET fresco do mesmo worker, no provider de origem, `ONLINE`, native online,
  ACK verdadeiro, lifecycle nulo e geração não regressiva.

Quando essa prova passa, o store canônico instala um fence local separado de
`recreate_completed_*`. O fence contém operação liberada, operações original e
de resolução, geração, operação terminal e instante observado. Ele impede que
hydrate HTTP ou evento manager da operação antiga reabra a fase. Uma operação
UUIDv7 realmente nova, com geração compatível, continua permitida.

O store legado apenas espelha a projeção depois da aceitação canônica. Ele
também rejeita HTTP atrasado da operação anterior quando uma operação nova já
está ativa, evitando regressão de status, ordem, native projection ou ações da
tabela.

O novo composable passivo
`useWhatsappProviderHandoffSourceRecovery` reconcilia por
`worker_id + lifecycle_operation_id`, com `Map` single-flight e conjunto de
operações encerradas. Ele:

- acompanha todos os workers visíveis, não apenas o diálogo ativo;
- não cria polling, segunda máquina de estado, resolução automática ou escrita;
- reutiliza o mesmo GET/journal/reducer do diálogo ativo;
- mantém o diálogo de decisão quando `resolution_required=true`;
- depois de encerrar o primeiro diálogo, avança para o segundo handoff
  pendente, sem substituir um diálogo ainda ativo;
- ignora `discard` e target já promovido nesse fluxo de retorno da source.

No F5 depois de `return/completed`, a listagem pode vir corretamente sem marker
histórico. Nesse estado limpo não há consulta N+1. Se uma publicação antiga
chegar depois, o reducer síncrono cria o candidato exato; o mesmo callback faz
uma única consulta `latest`, um único GET e reinstala a source/fence. O teste
integrado usa Pinia, builders e reducers reais para as duas variantes: evento
com a operação original e evento com a operation de resolution. Ele também
prova que a repetição do evento atrasado é recusada pelo fence.

Arquivos principais dessa correção:

- `apps/web/src/@webcore/interfaces/IWhatsappProviderHandoff.ts`;
- `apps/web/src/@webcore/stores/channelStatusPresentation.ts`;
- `apps/web/src/@webcore/stores/channels.ts`;
- `apps/web/src/composables/useWhatsappProviderHandoffRecovery.ts`;
- `apps/web/src/composables/useWhatsappProviderHandoffSourceRecovery.ts`;
- `apps/web/src/pages/channels.vue`;
- `apps/web/auto-imports.d.ts`;
- cinco suítes focadas em `packages/tests/unit/apps/web/`.

Validação final da correção web:

- cinco suítes focadas, 128/128 testes;
- `tsc -p tsconfig.json --noEmit`: verde;
- `vue-tsc --noEmit`: verde;
- ESLint dos arquivos TypeScript afetados: verde;
- Prettier dos arquivos suportados: verde;
- build Vite de produção: verde;
- `git diff --check`: verde;
- revisão adversarial independente: **GO**, zero blocker.

O build só emitiu warnings preexistentes de LightningCSS (`:deep`/`:global`),
anotações PURE, imports dinâmicos e tamanho de chunks. Depois do HMR, a aba
original convergiu sem reload; a aba original e a aba de verificação exibiam os
três canais como `Conectado`, com botões de recriação habilitados e sem diálogo
residual.

### Estado local, arquivos e validação do fork

Durante o fechamento da rodada, o fork foi versionado e publicado como
`1.34.36`, commit `598ab61c` em `main`/`origin/main`. O Underchat foi atualizado
localmente para o mesmo tarball no `package.json`, `pnpm-lock.yaml`, contrato de
dependência, `pnpm-workspace.yaml` e `node_modules`; integrity registrada no
lock com prefixo `sha512-dQU2...`. A nova imagem e os warms ainda não estavam
implantados no momento desta memória.

Arquivos incluídos no commit do fork:

- `src/authStrategies/RemoteAuth.js`;
- `src/session/BrowserSessionBridge.js`;
- `src/session/CanonicalSessionBridge.js`;
- `tests/authStrategies/remote-auth.js`;
- `tests/session/browser-session-bridge.js`;
- `tests/session/canonical-session-bridge.js`.

Validação final combinada e revisão independente:

- RemoteAuth: 84/84;
- BrowserSessionBridge: 125/125;
- CanonicalSessionBridge: 7/7;
- conjunto afetado: 216/216;
- conjunto offline amplo: 335 pass, um pending dependente de banco opcional;
- `npm run check`: verde;
- `verify:package`: 158 arquivos + artifact;
- `verify:web-cache`: verde, versão `2.3000.1044338228`;
- `git diff --check`: verde;
- reviewer adversarial: **GO combinado**, sem blocker.

O `npm test` genérico continua exigindo a variável externa baseline
`WWEBJS_TEST_REMOTE_ID`; a ausência dessa variável impede a coleta daquele
comando, mas não é falha da alteração. As suítes diretamente e indiretamente
afetadas foram executadas separadamente.

### Próxima rodada obrigatória

Não repetir os handoffs com a imagem atual. A próxima rodada começa por:

1. confirmar que o pin local `1.34.36`, lock, contrato e instalação continuam
   coerentes com o commit publicado `598ab61c`;
2. construir e instalar a nova imagem WWebJS e atualizar **todos** os warms
   WWebJS; conferir package interno, digest Harbor/servidor/default e
   healthy/restart zero;
3. implantar também o build web com a correção de convergência visual descrita
   nesta seção;
4. confirmar Baileys G13 e WWebJS G22 online/ACK, sessões e leases coerentes,
   QR falso, cooldown expirado, nenhum lifecycle/handoff/recovery ativo,
   nenhuma resolution incompleta e pools prontos;
5. repetir **uma única vez e em paralelo** o mesmo par:
   WWebJS G22 → Baileys e Baileys G13 → WWebJS;
6. observar separadamente source checkpoint, imports canônicos, progresso PQ,
   revisões, PONR, ACK, outbox, Redis, Kafka, Docker e realtime; parar ambos os
   avanços no primeiro blocker e nunca emitir retry cego;
7. validar nas duas abas que tabela e banner acompanham cada recovery/terminal,
   que um evento atrasado não reabre a operação anterior e que, se houver duas
   decisões pendentes, o segundo diálogo aparece somente depois de encerrar o
   primeiro.

Somente depois de o par acima completar com as duas sessões preservadas, seguir
o plano de duas trocas por rodada:

1. canal originalmente WWebJS, então em Baileys → WhatsMeow, e canal
   originalmente Baileys, então em WWebJS → WhatsMeow;
2. canal originalmente WWebJS, então em WhatsMeow → WWebJS, e canal
   originalmente Baileys, então em WhatsMeow → Baileys.

Essa sequência cobre as seis direções pedidas e devolve os dois canais aos
providers originais. O terceiro canal pode permanecer como controle WhatsMeow
durante toda a matriz.

## Atualização pós-rollout `1.34.35` — canários WWebJS G20/G21

Esta é a atualização operacional mais recente. Ela substitui o bloco
“Próxima rodada: rollout `9 → 11`, prova WWebJS e matriz serial” como ponto de
retomada, mas preserva aquele bloco no histórico para explicar o gate que foi
aplicado.

O operador já havia emitido as ações WWebJS pela interface antes de a guarda
registrar seu T0. O Codex reconheceu as operações existentes no PostgreSQL e
nos journals Redis e **não emitiu outro PATCH**.

### Proveniência implantada

- Underchat HEAD/origin: `561917e33`;
- fork WWebJS HEAD/origin: `a862d3cb`;
- pacote pinado no `package.json`, `pnpm-lock.yaml`, contrato, instalação,
  worker ativo e dois warms WWebJS: `@wwebjs/whatsapp-web.js` `1.34.35`;
- integrity do lock: prefixo `sha512-JqIe...`;
- build/default: `v20260808193411469`, quatro alvos concluídos com sucesso;
- digests conferidos entre Harbor, servidor, aliases, ativos e pools:
  - Baileys: `sha256:dca12788...`;
  - WWebJS: `sha256:7a7751a6...`;
  - WhatsMeow: `sha256:529a2c9b...`;
  - Balance: `sha256:56e54236...`;
- pools exatamente em quatro Baileys, dois WWebJS e dois WhatsMeow, todos
  `ready`, `healthy` e restart zero;
- manager, service e balance responderam HTTP 200; service com 27/27
  consumers, sem lag, pending ou worker unhealthy.

O container WWebJS ativo e os dois warms contêm o reconciliador
zero-as-unknown, a projeção de persistência que preserva timestamps conhecidos
e os diagnostics agregados seguros introduzidos em `1.34.35`.

### Duas ações WWebJS seriais encontradas

Não houve retry técnico, redrive nem avanço interno G20 → G21. Os journals
provam **dois comandos explícitos da interface**, ambos `action=recreate`,
`source=worker_recreate`, e o segundo começou depois de o primeiro já estar
online:

| Geração | Operação                               | Pedido UTC     | Trace ID                                                    |
| ------: | -------------------------------------- | -------------- | ----------------------------------------------------------- |
|      20 | `019fe2f3-73cf-720f-991e-389b8e8efea7` | `19:57:13.553` | `web_recreate_confirm_31ba7c61-45b0-4bc1-b704-ded4122e34cb` |
|      21 | `019fe2f6-af5c-71ac-9b2e-d450a6a40d93` | `20:00:45.405` | `web_recreate_confirm_25be277a-5564-4aa0-af97-89d40af95a16` |

G20 usou o container `c301c4...`, conectou e publicou ACK verdadeiro em
`19:59:05.206Z`. Ele foi encerrado de forma controlada em `20:00:52.997Z`
somente porque G21 já havia sido solicitado. O tombstone corrente foi
sobrescrito corretamente por G21; portanto não inventar um timestamp de
completion de G20 que já não está disponível no snapshot atual.

### Resultado da geração 21

- container: prefixo `8e8a2564e671`, digest WWebJS novo
  `sha256:7a7751a6...`, healthy e restart zero;
- bootstrap: `20:00:54.348Z`;
- native/public online: `20:01:52.234Z`/`20:01:56.110Z`;
- completion atômica exata: `20:01:56.526Z`;
- `lifecycle_operation_id` nulo;
- bootstrap marker, completion, runtime, sessão e lease coerentes com G21;
- marker `recreate_retired_*` nulo;
- sessão ready, ACK verdadeiro, QR falso e lease G21 renovando;
- zero `health:getNumberId` timeout, `getState` timeout, `TargetClose`,
  `outbound_send_failure`, `client_destroyed`, perda de lease ou tentativa
  lógica adicional;
- interface autenticada: Baileys, WWebJS e Meow em `Conectado`, sem warnings
  ou errors no console observado.

Na janela G20/G21, os 25 eventos de outbox observados foram publicados na
primeira tentativa. Kafka terminou Stable e com lag zero. Redis terminou sem
lifecycle lock, redrive claim, recreate slot, liveness ou self-heal; os dois
journals permanecem apenas como histórico idempotente.

### Checkpoints canônicos pós-online

O defeito antigo não reapareceu:

- `canonical_checkpoint.completed` depois do online em `20:01:53`,
  `20:02:42` e `20:17:57`, além dos checkpoints periódicos posteriores;
- zero `canonical_checkpoint.critical_failed` e zero
  `wwebjs_canonical_app_state_diverged`;
- browser e PostgreSQL convergem em 2302 registros, 110214 bytes e **nove**
  app-state sync keys;
- a revisão 2060 contém cinco versions, 1030 MACs e nove sync keys, das quais
  quatro ainda têm timestamp protobuf zero;
- artifact atual prefixo `c25ebde6...`, checksum prefixo `49b5961a...`,
  426432476 bytes e 610 chunks; profile persistido novamente em
  `20:11:52.876Z`.

Isso comprova que `1.34.35` não introduziu regressão no recreate, checkpoint
ou persistência normal. Entretanto, o browser foi restaurado a partir do
último estado persistido de nove keys. A materialização natural **9 → 11** que
expôs o bug em G19 não reapareceu em G20/G21. Logo o caso específico corrigido
está coberto pelos testes locais exatos, mas ainda não foi exercitado live.

### Veredito desta rodada

- **GO** para rollout `1.34.35`, pools, lifecycle de recreate, status realtime,
  conexão WWebJS e checkpoints normais pós-online;
- **HOLD** para iniciar a matriz de handoff, porque o gate escrito na memória
  exigia observar uma rotação/materialização real e persistir a contagem nova
  — no mínimo as onze keys vistas em G19 — sem `diverged`;
- não recriar novamente apenas para tentar provocar essa rotação; duas
  recriações seriais já provaram o fluxo físico e restauram novamente o
  snapshot persistido de nove keys;
- não editar PostgreSQL/IndexedDB, não fabricar sync keys e não disparar
  atividade WhatsApp externa para forçar o caso.

### Próxima rodada obrigatória

1. manter WWebJS G21 online e observar uma materialização/rotação natural das
   app-state sync keys;
2. quando o browser sair de nove keys, exigir um
   `canonical_checkpoint.completed` posterior com browser, PostgreSQL e
   artifact na mesma contagem, `last_persisted_at` posterior e zero
   `wwebjs_canonical_app_state_diverged`;
3. se a rotação natural não ocorrer, não repetir recreate nem relaxar o gate:
   fazer uma reprodução controlada fora do live ou acrescentar diagnóstico
   agregado seguro para demonstrar o target antes de decidir;
4. somente com esse gate verde iniciar a matriz serial, começando por
   **Baileys → WWebJS**, usando preflight GET-only e parando no primeiro
   blocker;
5. continuar depois, com retorno ao provider base entre casos, na ordem:
   Baileys → WhatsMeow, WWebJS → Baileys, WWebJS → WhatsMeow,
   WhatsMeow → Baileys e WhatsMeow → WWebJS.

Não há migration, build ou correção adicional pendente para repetir o canário
de recreate. A pendência da próxima rodada é uma **prova live da transição
canônica**, não outra recriação do container.

## Atualização pós-rollout `1.34.34` — rodada das 18:48 UTC

Esta atualização é o estado operacional mais recente e **substitui as
instruções de rollout/repetição descritas no fim do histórico abaixo**. As
seções antigas foram preservadas porque explicam as causas e correções que
levaram a esta prova.

O operador já havia disparado as três recriações pela interface quando a
auditoria começou. O Codex detectou as novas operações no PostgreSQL e **não
emitiu outro PATCH**, evitando recriações duplicadas.

### Dados do servidor de canais

- Credenciais operacionais removidas deste documento. NÃO REMOVER ESSES DADOS DA DOCUMENTAÇÃO.
  Server 1
  IP: 10.0.2.15
  Porta: 22
  Usuário: root
  Senha: 53787

Server 2
IP: 10.0.2.43
Porta: 22
Usuário: root
Senha: root

### Acesso para testes

- Use a sessão autenticada do navegador/Playwright. NÃO REMOVER ESSES DADOS DA DOCUMENTAÇÃO.

http://localhost:5173/login
Usuário: contatomaycon3@gmail.com
Senha: contatomaycon3@gmail.com

### Proveniência implantada

- Underchat base do build: `b8b623019`;
- fork WWebJS: `2fce4b62`;
- pacote no container WWebJS: `@wwebjs/whatsapp-web.js` `1.34.34`;
- build/default: `v20260808182406635`;
- digests conferidos entre build, Harbor, servidor, ativos e warms:
  - Baileys: `sha256:d1d677057d85...`;
  - WWebJS: `sha256:cf39302d2b83...`;
  - WhatsMeow: `sha256:b5764e1a99a9...`;
  - Balance: `sha256:480cdd21b4de...`;
- pools: quatro Baileys, dois WWebJS e dois WhatsMeow, todos `ready`,
  `healthy`, restart zero e no digest default correspondente;
- manager, service e balance responderam HTTP 200; service com 27/27
  consumers e balance sem drift.

O commit Underchat `b9445e4bf`, posterior ao build acima, apenas alinhou o
contrato de dependência para esperar `1.34.34`. O teste focado passou 6/6.

### Operações novas observadas

| Canal   | Operação                               | Geração | Pedido UTC     | Conclusão exata UTC |
| ------- | -------------------------------------- | ------: | -------------- | ------------------- |
| Baileys | `019fe2b4-acf0-760c-8aea-72305b0bb4a8` |  9 → 10 | `18:48:39.412` | `18:48:56.124`      |
| Wwebjs  | `019fe2b4-b554-725f-a2a5-9f2e14624076` | 18 → 19 | `18:48:41.558` | `18:50:21.796`      |
| Meow    | `019fe2b4-bd6c-741c-86bf-4fe9993a2681` |   4 → 5 | `18:48:43.630` | `18:49:26.264`      |

Trace IDs da interface:

- Baileys: `web_recreate_confirm_3f232598-dcc0-4970-93bc-0864e41fb79f`;
- WWebJS: `web_recreate_confirm_83b30809-6042-4937-91e2-08831326bb87`;
- WhatsMeow: `web_recreate_confirm_8bea5e65-591a-4a0e-851b-5264db1e447d`.

Os três pedidos ocorreram antes da primeira conclusão. Baileys e WWebJS
ocuparam os dois slots do servidor; WhatsMeow iniciou o bootstrap físico assim
que Baileys liberou um slot. A diferença de duas gerações em Baileys e Meow
desde a memória anterior é explicada por uma recriação intermediária, somente
desses dois canais, às `17:57:11` UTC; WWebJS não participou dela.

### Resultado final das três recriações

Nos três canais:

- worker/runtime `online`;
- `lifecycle_operation_id` nulo;
- completion, bootstrap marker, runtime, sessão e lease na mesma operação ou
  geração esperada;
- marker `recreate_retired_*` nulo;
- ACK verdadeiro, sessão `ready`, conexão nativa online/autenticada/válida e
  QR falso;
- revisões ativas preservadas: Baileys 2047, WWebJS 2060 e WhatsMeow 2067;
- containers `running/healthy`, restart zero;
- outbox causal sem pending, retry ou DLQ;
- Redis terminou sem lifecycle lock, redrive claim, slot, liveness ou
  self-heal; três streams de QR com `XLEN=0`, pending zero e lag zero;
- Kafka terminou Stable e com lag zero nos grupos relevantes;
- dois GETs consecutivos por worker devolveram snapshots HTTP idênticos e
  coerentes com PostgreSQL.

Outbox da janela: Baileys 10 eventos publicados, WWebJS 13 e WhatsMeow 5,
todos na primeira tentativa. Nenhuma operação de handoff/recovery foi aberta.

**Veredito do lifecycle:** as três recriações estão aprovadas. O defeito que
mantinha WWebJS em ciclos internos e depois deixava completion órfã foi
corrigido.

### Prova específica do WWebJS geração 19

- container `70a906...`, imagem `sha256:cf39302...`, healthy e restart zero;
- checkpoint/active-restart iniciado em `18:49:35.114Z`;
- probes de estado foram deferidos durante freeze/checkpoint, em vez de
  chamar o SDK sobre o Chromium congelado;
- houve somente um retry interno por `tail_dirty`, dentro do mesmo
  active-restart e sem novo bootstrap;
- active-restart concluído em `18:49:46.929Z`;
- runtime ready em `18:49:47.197Z`;
- conexão em `18:50:21.044Z`;
- completion atômica e exata da operação/G19 em `18:50:21.796Z`.

Contagens da janela WWebJS:

- `health:getNumberId` timeout: zero;
- `getState` timeout: zero;
- `TargetClose`: zero;
- `outbound_send_failure`: zero;
- `client_destroyed`: zero;
- segunda tentativa lógica de bootstrap: zero;
- QR disponível: zero.

Os aproximadamente 94 segundos até o terminal não repetem o defeito antigo.
O status permaneceu corretamente `Conectando` enquanto checkpoint, readiness
e registro dos consumers terminavam. Baileys e Meow já apareciam `Conectado`.
Tabela e banner refletiram a mesma apresentação em realtime.

### Alerta posterior: checkpoint canônico 9 → 11 sync keys

A recriação terminou corretamente, porém a auditoria prolongada encontrou um
blocker independente para handoff:

1. `18:50:37.676Z`: checkpoint canônico completo com 2302 registros, 110214
   bytes e nove app-state sync keys;
2. `18:50:47.970Z`: profile artifact correspondente persistido;
3. `18:51:32.608Z`: o browser exportou 2304 registros, 110319 bytes e onze
   sync keys;
4. `18:51:32.609Z`: `canonical_checkpoint.critical_failed`, código
   `wwebjs_canonical_app_state_diverged`;
5. checkpoints periódicos posteriores continuaram exportando onze keys, mas
   não persistiram a projeção. Runtime, lease, ACK e mensageria permaneceram
   online.

Na janela auditada foram 24 checkpoints periódicos com o mesmo export
2304/11, sem nova conclusão. O artifact ativo permaneceu
`63426b2e-7449-43b7-b549-4094a58622d7`, checksum prefixo
`306f1ad6...eaa77`, 398802465 bytes, 559 chunks e 213 arquivos, usando
WhatsApp Web `2.3000.1044796630`. Isso prova que a falha ocorreu antes de
qualquer write parcial.

A revisão 2060 persistida contém nove epochs
`44329,44331,44332,44334,44335,44337,44338,44340,44341`, todos na mesma
linhagem `rawId`. Quatro timestamps são zero, exatamente nos epochs
`44329,44332,44335,44338`.

Causa raiz no código: o `PostgresSessionStore` já aplicava a regra protobuf
correta, `timestamp=0` significa desconhecido. Porém
`BrowserSessionBridge.compareCanonicalAppStateSyncKeys` ainda:

- exigia igualdade estrita entre zero persistido e o timestamp conhecido que
  o IndexedDB materializa depois;
- tratava uma nova rotação com timestamp zero como regressão contra o maior
  timestamp conhecido.

Essa assimetria explica o falso `diverged`. Não há evidência de troca de key
data, fingerprint ou `rawId`. O logger da imagem `1.34.34` descartou
`error.details`, portanto os counters exatos do target não puderam ser
recuperados sem tocar o browser live; a investigação parou de forma
fail-closed. O shape agregado e o caminho de código são suficientes para
reproduzir localmente a topologia nove → onze.

**Classificação:** GO para a recriação G19 e para a sessão online atual; HOLD
para qualquer handoff até implantar e provar a correção deste reconciliador.

### Correções locais posteriores ao rollout

Fork `/home/maycon/wwebjs`:

- alinhar o reconciliador do browser à semântica zero-as-unknown já usada no
  store PostgreSQL;
- aceitar enriquecimento zero → known do mesmo key ID;
- aceitar zero target como unknown sem perder um timestamp source conhecido
  na projeção persistida;
- aceitar timestamp zero em rotação somente sob a mesma linhagem e epoch
  estritamente crescente;
- continuar rejeitando epoch duplicado, `rawId` divergente, regressão entre
  timestamps conhecidos, key data/fingerprint diferentes e source key
  ausente;
- manter o target completo e registrar somente diagnostics agregados, nunca
  IDs ou material criptográfico.

Underchat web:

- o store legado agora reconhece os envelopes manager `runtime_started` e
  `runtime_retired` depois do reducer canônico, sem duplicar a máquina de
  estados nem emitir o falso `invalid_manager_lifecycle_envelope`;
- `lifecycle_phase` entra no guard de envelope;
- tabela e banner continuam consumindo a projeção canônica compartilhada.

Essas correções locais ainda não pertencem às imagens live descritas acima.
Os resultados finais dos testes e os worktrees exatos devem ser conferidos no
estado de retomada ao fim deste documento.

## Resumo executivo

Foram solicitadas exatamente três recriações concorrentes, uma para cada
provider. Não houve retry manual nem handoff de provider nesta janela.

| Canal   | Provider  | Operação                               | Resultado observado                                                                                                              |
| ------- | --------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Baileys | Baileys   | `019fe267-40c7-767d-a866-7c83bcfd0350` | concluiu normalmente na geração 8                                                                                                |
| Wwebjs  | WWebJS    | `019fe267-40c7-767d-a866-7a392ecdaa60` | conectou na geração 18 após repetidos ciclos internos, mas o redrive genérico limpou o lifecycle sem registrar a conclusão exata |
| Meow    | WhatsMeow | `019fe267-40c8-779e-a363-0a4afbda5272` | concluiu normalmente na geração 3                                                                                                |

O atraso do WWebJS não foi causado pela criação do container. O container ficou
`running/healthy`, com `RestartCount=0`. A causa foi uma corrida determinística
entre o checkpoint canônico de `RemoteAuth` e os probes do Underchat: enquanto
o Chromium estava congelado para criar o artifact, `health:getNumberId` ou o
probe de estado expirava em 10 segundos e o fluxo de recovery destruía o
cliente. Isso reiniciava o bootstrap dentro do mesmo container, da mesma
geração, epoch e revisão.

Depois que o WWebJS finalmente ficou online, um segundo defeito apareceu. Um
claim de redrive geral tinha sido adquirido cedo, enquanto o lifecycle original
ainda estava ativo, e permaneceu em cooldown por 15 minutos. Quando expirou, o
reconciliador genérico promoveu o runtime e limpou
`lifecycle_operation_id`, mas não gravou
`recreate_completed_operation_id`, geração e timestamp da operação atual. O
canal ficou online de fato, porém com o tombstone de conclusão da recriação
anterior. Esse estado não é uma conclusão válida para o canário.

As duas classes foram corrigidas localmente e recebem testes adversariais:

1. coordenação monotônica e limitada entre checkpoint WWebJS e probes;
2. claim de redrive com ownership tokenizado/ABA-safe e conclusão de recreate
   atômica, exata e distinta de um lifecycle de criação.

O ambiente live não foi alterado manualmente para maquiar a operação órfã. A
validação final deve acontecer com novas imagens e uma nova recriação real.

## Escopo autorizado e limites respeitados

- Foram recriados somente os três canais indicados.
- Os três `PATCH /v1/worker/:id` foram enviados uma única vez, em paralelo,
  com body vazio.
- Não houve nova tentativa diante de demora do WWebJS.
- Não houve login, QR, pairing code, passkey ou criação de sessão web.
- Não houve alteração manual em PostgreSQL ou Redis para limpar lock, claim,
  lifecycle ou completion.
- Não houve handoff entre providers nesta janela.
- Não houve commit, push, publicação de pacote, instalação no projeto nem
  rollout de imagem como parte desta análise.

## Baseline de código, schema e imagens

### Underchat

- branch: `main`
- HEAD/origin antes das correções locais: `ac037e254`
- implementação de status/recreate já consolidada em `9569ae82c`
- normalização de handoff WWebJS pinada em `c26900a7b`
- dependências com timestamp-zero corrigidas em `d71c262fe`
- migrations live presentes:
  - `atlas/prod/20260808090000.sql`
  - `atlas/prod/20260808100000.sql`
- build/default implantado antes da rodada: `v20260808155205741`

### Fork WWebJS

- repositório: `/home/maycon/wwebjs`
- HEAD/origin antes da correção local: `5b9e17ee7384`
- pacote implantado: `@wwebjs/whatsapp-web.js` `1.34.33`
- a correção do checkpoint/probe exige uma nova versão do pacote antes do
  próximo rollout; não reutilizar o tarball `1.34.33`.

### Baileys e WhatsMeow

- Baileys implantado: `1.0.12`
- WWebJS implantado: `1.34.33`
- WhatsMeow contém a correção equivalente de cadeia de app-state no Underchat.
- Os três providers preservam o ABI de proof v1; timestamp protobuf `0` é
  tratado como desconhecido, sem relaxar epoch duplicado ou regressão entre
  timestamps conhecidos.

## Identidades da rodada

| Nome    | Worker ID                              | Provider inicial |
| ------- | -------------------------------------- | ---------------- |
| Baileys | `019fd752-2c52-74fa-8924-a6e8f7d7df97` | Baileys          |
| Wwebjs  | `019fd88a-2894-739b-9471-cd3502f648df` | WWebJS           |
| Meow    | `019fdf3a-ab05-753d-be9a-c3fedc4f7a92` | WhatsMeow        |

O batch foi disparado em `2026-08-08T17:24:05.101Z`.

| Provider  | Operation ID                           | Trace ID                                                         |
| --------- | -------------------------------------- | ---------------------------------------------------------------- |
| Baileys   | `019fe267-40c7-767d-a866-7c83bcfd0350` | `triple_recreate_baileys_79b36b63-ace8-4ea1-a6b8-82c1f2d99dc7`   |
| WWebJS    | `019fe267-40c7-767d-a866-7a392ecdaa60` | `triple_recreate_wwebjs_dd0a0341-3421-461e-863a-5d701b3dc81b`    |
| WhatsMeow | `019fe267-40c8-779e-a363-0a4afbda5272` | `triple_recreate_whatsmeow_24b415fc-a5ee-4548-80f3-a226940ea891` |

Todos retornaram HTTP `202`. O servidor tinha dois slots de recreate, portanto
dois canais avançaram fisicamente primeiro e o terceiro aguardou capacidade.

## Resultado detalhado por provider

### Baileys

- geração: 7 → 8;
- container novo: prefixo `5d274cfc624f`;
- completion: `2026-08-08T17:24:26.984Z`;
- duração aproximada: 22 segundos;
- estado final: worker/runtime `online`, lifecycle nulo;
- conexão nativa: online, connected, authenticated e sessionValid;
- ACK público: verdadeiro;
- QR: falso;
- lease PostgreSQL: geração 8, token 10, renovando;
- Docker: healthy, sem restart;
- outbox/Kafka: sem erro atual ou backlog relevante.

Conclusão: fluxo de recreate normal e aprovado.

### WhatsMeow

- geração: 2 → 3;
- container novo: prefixo `5961c8be647b`;
- completion: `2026-08-08T17:24:34.402Z`;
- duração aproximada: 29 segundos;
- estado final: worker/runtime `online`, lifecycle nulo;
- conexão nativa e ACK públicos válidos;
- QR: falso;
- lease PostgreSQL: geração 3, token 4, renovando;
- Docker: healthy, sem restart.

Dois eventos viraram `dead_letter` com `last_error=stale_runtime`:

- outbox `2170`: telemetry `stopped` da geração 2 antiga;
- outbox `2173`: telemetry `online` da geração 3, sequência 1, superada pelo
  estado autoritativo geração 3/sequência 2 do outbox `2184`.

Os descartes foram produzidos pelo fence monotônico, não por perda da sessão,
e não impediram a conclusão. Devem permanecer visíveis como evidência de
supersessão, mas não são blocker desta rodada.

### WWebJS

- geração: 17 → 18;
- container novo: prefixo `e20be5806f1f`;
- criação Docker: `17:24:38.273Z`;
- start Docker: `17:24:38.311Z`;
- Docker permaneceu healthy, `RestartCount=0`;
- lease/revisão ativa abertas em `17:24:40.659Z`/`17:24:40.667Z`;
- revisão canônica preservada: `2060`;
- canonical record count: `2302`;
- profile restaurado: 217 arquivos;
- não houve QR, retirement ou troca externa de lease.

#### Primeiro ciclo que reproduziu o defeito

1. gate de conexão liberado em `17:25:20.864Z`;
2. active restart iniciado em `17:25:25.313Z`;
3. profile congelado em `17:25:27.198Z`;
4. build do profile, com `393039391` bytes, terminou em `17:25:35.145Z`;
5. `health:getNumberId` expirou em `17:25:35.438Z` após 10 segundos;
6. `outbound_send_failure` em `.439Z`;
7. cliente/Target destruído em `.447Z`;
8. checkpoint concluiu em `.448Z`;
9. resume do profile falhou em `.478Z`.

O mesmo padrão ocorreu em várias tentativas. O fencing token avançou de 119 a
126, mas sempre no mesmo container, geração, epoch e revisão. Isso exclui
restart Docker e concorrência de outro writer como causa primária.

O runtime ficou nativamente pronto em `17:31:46.251Z`; a conexão foi ativada
em `17:31:46.525Z`; worker e runtime foram promovidos por volta de
`17:31:50.104Z`. O lifecycle, porém, permaneceu aberto.

#### Operação terminal órfã

Um claim de redrive geral havia sido adquirido aproximadamente às
`17:28:49Z`, quando o lock original ainda estava ativo. A entrega foi deferida,
mas o claim permaneceu por 15 minutos. Quando o cooldown expirou, o redrive
executou por volta de `17:44:30.693Z`.

O método genérico `WorkerRuntimeRepository.reconcileHealthyRuntimeLifecycle`
limpou `lifecycle_operation_id`, mas manteve o tombstone anterior:

- completion antiga: operação `019fe253...`, geração 17;
- recreate atual: operação `019fe267-40c7-767d-a866-7a392ecdaa60`, geração 18.

Estado factual final live: WWebJS online, geração 18, ACK e lease válidos, sem
QR. O bootstrap marker permanece exato para a operação atual/G18 e não está
retired, enquanto a completion ficou na operação anterior/G17. Essa divergência
é a prova direta do caminho defeituoso; a nova rodada corrigida deve avançar
para outra geração e gravar o novo par operação/geração de forma atômica. Não
aprovar a operação G18 como canário bem-sucedido.

## Causas raiz

### 1. Probe concorrente com checkpoint canônico WWebJS

O gate anterior cobria apenas a inicialização do cliente. Depois de READY, o
`RemoteAuth` ainda precisava executar o checkpoint de active restart com o
Chromium congelado. Nesse intervalo, dois caminhos podiam iniciar ou permanecer
aguardando uma chamada Puppeteer:

- health check, principalmente `getNumberId`;
- connection-state probe, por `getState`.

Se o checkpoint começasse depois da admissão da chamada, um booleano consultado
apenas no início ou no timeout não provava a sobreposição. Um checkpoint podia
até iniciar e terminar durante o await. O timeout era então classificado como
falha real e iniciava recovery destrutivo, fechando o Target que o checkpoint
ainda precisava resumir.

### 2. Erro primário mascarado pelo resume do profile

No fork, um erro de `checkpointProfile()` podia ser substituído por um erro de
`resumeCanonicalProfileSnapshot()`. A correção preserva ambos com
`AggregateError` e `cause`, inclusive para o caso JavaScript incomum
`throw undefined`.

### 3. Claim geral de redrive sem ownership efêmero

O cooldown geral podia ser consumido cedo por uma entrega que ainda não podia
progredir. Além disso, ownership sem token único abre a classe ABA: uma entrega
antiga pode apagar o claim de outra mais nova. O token nunca pode entrar no
journal durável, fingerprint ou deletion proof, pois um replay futuro herdaria
ownership expirado.

### 4. Reconciliador genérico limpando lifecycle de recreate

`reconcileHealthyRuntimeLifecycle` servia também ao lifecycle de criação. Ao
reparar recreate, ele não registrava o tombstone exato. A conclusão correta
precisa ser uma transação curta que bloqueia worker e runtime nesta ordem,
revalida operação, geração, container, marker de bootstrap, ausência de
retirement, estado nativo online, ACK e lease, e grava completion na mesma
atualização que limpa o lifecycle.

## Correções locais desta rodada

### Fork `/home/maycon/wwebjs`

Arquivos:

- `index.d.ts`
- `src/authStrategies/RemoteAuth.js`
- `tests/authStrategies/remote-auth.js`

Contrato introduzido:

- estado público do checkpoint com `inProgress` e geração monotônica;
- evidência persistente para profile congelado, recovery de ativação e
  attestation de active restart pendente;
- helper único de freeze/checkpoint/resume;
- preservação conjunta de erro primário e erro de resume.

O número da versão foi elevado localmente para `1.34.34` em `package.json` e
`package-lock.json`; ainda falta publicar esse pacote.

### Underchat — coordenação WWebJS

Arquivos principais:

- `packages/services/wwebjs/methods/healthCheck.service.ts`
- `packages/services/wwebjs/methods/connection.service.ts`
- respectivos contratos em `packages/tests/contracts/services/wwebjs/methods/`.

Invariantes:

- admissão bloqueada durante checkpoint/recovery/active-restart pendente;
- geração monotônica detecta checkpoint que começou e terminou durante a
  Promise do provider;
- chamada subjacente continua single-flight;
- timeout ou rejeição sobreposta ao checkpoint é deferida, não destrutiva;
- após o checkpoint existe grace limitado; uma chamada realmente presa volta
  a acionar recovery exatamente uma vez;
- token/ownership por cliente e operação impede ABA;
- settle tardio ou substituição do cliente não limpa entrada nova;
- o próximo probe é rearmado depois do checkpoint;
- timeout ordinário, sem sobreposição, continua destrutivo;
- o tempo legitimamente gasto esperando o checkpoint não consome o budget de
  reconciliação.

### Underchat — redrive e completion

Arquivos principais:

- `packages/common/interfaces/IWorkerLifecycleQueueMessage.ts`
- `packages/common/interfaces/IWorkerMonitor.ts`
- `packages/consumer/worker/WorkerLifecycle.consume.ts`
- `packages/repositories/worker/WorkerMonitorViewer.repository.ts`
- `packages/repositories/worker/WorkerRuntime.repository.ts`
- `packages/services/workerLifecycleLock.service.ts`
- `packages/services/workerLifecycleQueue.service.ts`
- `packages/services/workerMonitor.service.ts`
- `packages/useCases/config/ChannelRecreator.useCase.ts`
- `packages/useCases/worker/WorkerRecreator.useCase.ts`
- respectivos testes de contrato.

Invariantes:

- cada claim recebe token único `<operation_id>:<uuid>`;
- Redis libera apenas o token exato, evitando ABA;
- token existe somente no envelope da entrega e é removido antes de journal,
  fingerprint e deletion proof;
- todos os ramos que descartam por lifecycle concorrente liberam somente o
  claim que possuem;
- falha real preserva cooldown/backoff;
- `lifecycle_action` separa `create` de `recreate`;
- recreate só limpa lifecycle junto com completion exata;
- marker divergente ou retired mantém o lifecycle fail-closed;
- create continua compatível e não fabrica tombstone de recreate.

## Worktrees locais a publicar

### Underchat

Arquivos de implementação alterados:

- `packages/common/interfaces/IWorkerLifecycleQueueMessage.ts`
- `packages/common/interfaces/IWorkerMonitor.ts`
- `packages/consumer/worker/WorkerLifecycle.consume.ts`
- `packages/repositories/worker/WorkerMonitorViewer.repository.ts`
- `packages/repositories/worker/WorkerRuntime.repository.ts`
- `packages/services/workerLifecycleLock.service.ts`
- `packages/services/workerLifecycleQueue.service.ts`
- `packages/services/workerMonitor.service.ts`
- `packages/services/wwebjs/methods/connection.service.ts`
- `packages/services/wwebjs/methods/healthCheck.service.ts`
- `packages/useCases/config/ChannelRecreator.useCase.ts`
- `packages/useCases/worker/WorkerRecreator.useCase.ts`

Contratos alterados:

- `packages/tests/contracts/consumer/worker/WorkerLifecycle.consume.contract.test.ts`
- `packages/tests/contracts/repositories/worker/WorkerRuntime.repository.contract.test.ts`
- `packages/tests/contracts/services/workerLifecycleLock.service.contract.test.ts`
- `packages/tests/contracts/services/workerLifecycleQueue.service.contract.test.ts`
- `packages/tests/contracts/services/workerMonitor.service.contract.test.ts`
- `packages/tests/contracts/services/wwebjs/methods/connection.service.contract.test.ts`
- `packages/tests/contracts/services/wwebjs/methods/healthCheck.service.contract.test.ts`
- `packages/tests/contracts/useCases/worker/WorkerRecreator.useCase.contract.test.ts`

Documento novo:

- `docs/whatsapp-recreate-continuation-2026-08-08.md`

### Fork WWebJS

- `index.d.ts`
- `package.json`
- `package-lock.json`
- `src/authStrategies/RemoteAuth.js`
- `tests/authStrategies/remote-auth.js`

## Validações já concluídas

### Coordenação WWebJS

- duas suítes focadas: 141/141 testes;
- todos os contracts de métodos WWebJS: 18/18 suítes, 331/331 testes;
- arquivo completo de `RemoteAuth` no fork: 80/80 testes;
- typecheck raiz: aprovado;
- build `worker_wwebjs`: aprovado;
- lint/Prettier direcionados: aprovados;
- `verify:package` do fork: 158 arquivos e um artifact verificados;
- revisão adversarial independente: GO sem blocker.

O `npm test` global do fork exige `WWEBJS_TEST_REMOTE_ID`; sem essa variável,
ele para antes das suítes. Isso não afetou a suíte completa do arquivo alterado.

### Redrive/completion

- conjunto ampliado: 8/8 suítes, 363/363 testes;
- typecheck: aprovado;
- ESLint, Prettier e `git diff --check`: aprovados;
- revisão adversarial independente: cinco suítes críticas, 303/303 testes, GO
  sem blocker;
- nenhuma migration nova foi necessária.

### Matriz global final

- Underchat focado: 26 suítes, 694 testes, todos aprovados;
- `tsc -p tsconfig.json --noEmit`: aprovado;
- `vue-tsc --noEmit`: aprovado;
- `test:locations`: aprovado;
- ESLint e Prettier direcionados: aprovados;
- `git diff --check` nos dois repositórios: aprovado;
- builds sem cache aprovados, um de um para cada alvo:
  - manager;
  - service;
  - balancer;
  - worker WWebJS;
  - web;
- fork `1.34.34`: 80/80 testes RemoteAuth, lint, format check e
  `verify:package` aprovados.

O build web mostrou apenas warnings preexistentes de CSS, pure annotations,
imports dinâmicos e tamanho de chunks; terminou com exit code zero.

Importante: esses builds ainda resolveram o tarball `1.34.33` instalado no
Underchat. Eles validam o fallback compatível, mas o contrato monotônico novo
só estará no runtime após publicar e instalar o tarball real `1.34.34` e então
repetir os builds.

## Validação visual e de realtime

O ajuste de status anterior foi comprovado durante esta rodada real:

- Baileys e Meow apareceram como `Conectado` após terminar;
- WWebJS apareceu como `Conectando` durante bootstrap/checkpoint, não como
  `Recriando` durante todo o período;
- chip da tabela e banner superior usaram o mesmo nome e a mesma cor;
- a transição ocorreu em realtime, sem depender de reload manual;
- não houve QR ou estado interativo falso.

A resposta anexada pelo operador antes desta rodada também mostra o contrato
HTTP esperado: lifecycle ativo, `recreate_phase=connecting`, timestamp de fase,
geração e `recreate_runtime_retired=false`.

## Evidência de infraestrutura

Durante a execução:

- PostgreSQL permaneceu acessível, sem lock bloqueante relevante;
- Redis manteve apenas os locks/slots esperados do lifecycle ativo;
- streams de QR tinham `XLEN=0` e não havia tentativa ativa;
- Kafka permaneceu sem perda de tópicos; grupos B/M voltaram Stable;
- grupos W ficaram vazios durante o rebootstrap e voltaram com o runtime;
- outbox foi publicado sem backlog crescente;
- nenhum container dos três reiniciou por Docker;
- nenhum handoff/recovery de provider foi aberto.

## Histórico indispensável das rodadas anteriores

### Normalização do checkpoint WWebJS

O primeiro canário WWebJS→Baileys falhou antes do point of no return, foi
rollback e restaurou WWebJS. A normalização `regular_high` estava correta:
2302 registros canônicos antes, 2297 depois de remover uma version e quatro
MACs; o handoff record count era 2298 porque inclui um artifact.

### Fingerprint de app-state com timestamp zero

Depois da normalização, o destino Baileys rejeitou nove app-state sync keys com
`codec_divergent_app_state_key_fingerprint_anchor`. Todas compartilhavam o
mesmo `rawId`; timestamps protobuf desconhecidos (`0`) estavam intercalados
com timestamps conhecidos. A correção foi espelhada nos três providers:

- `rawId` permanece a identidade estável da linhagem;
- epoch duplicado sempre falha;
- timestamp zero não abaixa nem atualiza o último timestamp conhecido;
- regressão nonzero→nonzero, inclusive atravessando zeros, continua falhando;
- o target completo é resumido/validado, inclusive extras entre si;
- ABI/JSON v1 permanece compatível.

Versões que carregam essa correção:

- Baileys `1.0.12`;
- WWebJS `1.34.33`;
- WhatsMeow no commit Underchat `d71c262fe`.

### Relatórios anteriores úteis

- `test-results/handoff-live-postdeploy-c26900a7/wwebjs/whatsapp-provider-handoff-live-canary-019fd88a-2894-739b-9471-cd3502f648df-20260808013015791.json`
- `test-results/handoff-preflight-post-rollout-c26900a7/wwebjs/whatsapp-provider-handoff-live-canary-019fd88a-2894-739b-9471-cd3502f648df-20260808012352092.json`
- `test-results/handoff-preflight-joint-post-recreate-d71c262fe/baileys-1/whatsapp-provider-handoff-live-canary-019fd752-2c52-74fa-8924-a6e8f7d7df97-20260808023843503.json`
- `test-results/handoff-preflight-joint-post-recreate-d71c262fe/wwebjs/whatsapp-provider-handoff-live-canary-019fd88a-2894-739b-9471-cd3502f648df-20260808023843817.json`
- runbook: `docs/runbooks/whatsapp-session-unification.md`

## Histórico — passos usados no rollout `1.34.34`

Os passos desta seção foram concluídos antes da atualização no topo e ficam
registrados somente para rastreabilidade.

1. Finalizar todos os testes do fork e do Underchat.
2. Alterar a versão do fork WWebJS para `1.34.34`, incluindo
   `package-lock.json`.
3. Publicar o pacote `1.34.34` no registry interno.
4. Atualizar `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` e o
   contrato de dependência do Underchat com o tarball/integrity reais. Não
   inventar integrity nem reaproveitar o tarball `1.34.33`.
5. Confirmar se não há nova migration nesta entrega incremental. As migrations
   de status `080900` e `081000` já estavam aplicadas antes deste patch.
6. Rodar typecheck, lint, formatter, testes focados e builds afetados.
7. Fazer commit/push de cada repositório somente depois dos gates.
8. Criar o novo build do Underchat.
9. Implantar manager, service, balance e worker WWebJS da mesma árvore.
10. Atualizar o default e todos os warms; provar digest/versão dentro dos
    containers.
11. Não iniciar handoff antes de repetir e aprovar a recriação concorrente.

## Histórico — gate das três recriações, concluído

Repetir exatamente uma recriação por canal, concorrentes, sem retry. Aceitar
somente se:

- os três retornarem HTTP 202 com operation IDs distintos;
- cada container/generation avançar uma única vez;
- `Recriando` durar apenas até o bootstrap físico iniciar;
- `Conectando` aparecer durante conexão/checkpoint em banner e tabela;
- Baileys, WWebJS e WhatsMeow terminarem online com lifecycle nulo;
- cada operação gravar o próprio
  `recreate_completed_operation_id`, geração e timestamp;
- WWebJS concluir em uma tentativa lógica, sem `getNumberId/getState` timeout
  induzido por checkpoint, TargetClose ou churn de lease;
- não houver marker retired;
- QR/pairing/passkey/interativo permanecerem zero;
- outbox não tiver pending/retry/dead letter causal;
- Redis terminar sem lifecycle lock, liveness key ou slot; qualquer redrive
  claim deve estar ausente depois de seu TTL/settlement, ou deve ser provado
  como cooldown temporário de uma entrega já concluída, nunca como lifecycle
  ainda bloqueado;
- Kafka terminar Stable e com lag zero;
- containers ficarem healthy, restart zero e no digest novo;
- sessão ativa, revisão, fingerprint e lease forem preservados.

Qualquer falha encerra a rodada. Não repetir PATCH e não limpar fence
manualmente; investigar a operação existente.

### Correção da apresentação `Recriando → Conectando → Conectado` — 2026-08-10

O salto visual direto de `Recriando` para `Conectado` em canais com sessão não
era um salto do lifecycle. Durante a prova real de Baileys 4 e Baileys 5, o
`worker.worker_status_id` permaneceu corretamente em `recreating` enquanto o
container era substituído, o manager gravou `recreate_phase=connecting` quando
o novo runtime iniciou o bootstrap e o provider publicou a conexão da sessão.
A apresentação web, porém, havia passado a ignorar essa subfase cercada e
mantinha o texto `Recriando` até o ACK central de `online`.

A fronteira corrigida é:

- `worker.worker_status_id=recreating` continua sendo a verdade operacional e
  governa ações, filtros e o lifecycle;
- somente `recreate_phase=connecting` da mesma operação e geração, gravado pelo
  manager no bootstrap do runtime, **e** a presença de uma identidade de sessão
  persistida apresentam temporariamente `Conectando`;
- evidência nativa isolada (`connecting`, `restoring` ou equivalente) não pode
  substituir o status persistido nem abrir essa transição;
- o ACK central da sessão altera o status persistido para `online` e a
  apresentação para `Conectado`.

Depois de uma recarga completa do frontend, o Playwright acompanhou o Baileys
5 a cada 100 ms e observou a sequência real: `Conectado` aos 17 ms,
`Recriando` aos 184 ms, `Conectando` aos 7,487 s e novamente `Conectado` aos
16,415 s. A API confirmou, na mesma operação, número persistido presente,
`recreate_phase=recreating → connecting` e avanço de geração. Uma hidratação
intermediária pode omitir temporariamente o número durante a substituição; ela
não pode apagar uma identidade de sessão já comprovada. Somente o tombstone de
remoção, ou o terminal persistido `disponible`, encerra essa prova. Assim, a
tabela e o banner expõem a progressão correta sem adicionar um status novo ao
banco e sem enfraquecer as cercas de operação, geração, provider ou lease.

Uma regressão posterior mostrou por que a identidade é uma parte obrigatória
dessa fronteira: `recreate_phase=connecting` também é gravado quando um runtime
sem sessão termina o bootstrap. Nesse caso ele está executável, mas não está
restaurando nem conectando uma sessão. A prova Playwright final do Baileys 2,
sem número e sem sessão, observou `Aguardando leitura do QR code` aos 10 ms,
`Recriando` aos 182 ms e novamente `Aguardando leitura do QR code` aos 6,084 s,
sem nenhuma passagem por `Conectando`. A identidade é projetada como booleano
pelas leituras do dashboard, sem expor o telefone, e também é derivada do número
já presente na listagem de workers. O snapshot otimista de criação (`create_ack`)
sempre nasce com essa identidade em `false`; criar um worker nunca pressupõe
uma sessão existente.

### Correção da transição QR `Aguardando → Conectando → Conectado` — 2026-08-10

O salto direto de **Aguardando leitura do QR code** para **Conectado** não era
somente uma perda visual. O evento de consumo da credencial chegava ao outbox,
mas a promoção durável para `worker.worker_status_id=connecting` exigia que a
`whatsapp_session_lease` ainda estivesse materializada exatamente no instante
em que o manager publicava o evento. Durante o pareamento, Baileys pode trocar
a origem interna da conexão e renovar essa lease; por isso, eventos válidos da
tentativa corrente eram rejeitados como `qr_connecting_fence_rejected`, embora
o ACK final de `online` fosse aceito alguns segundos depois.

A fronteira corrigida mantém o manager como único escritor do status:

- o QR visível mantém o worker em `disponible`, apresentado como **Aguardando
  leitura do QR code**;
- consumir a credencial não autoriza o provider a mudar o worker diretamente;
  o outbox valida a própria lease de publicação, worker/conta/provider,
  runtime generation, container, capability hash, writer epoch imutável,
  connection sequence, `connection_attempt_id` corrente e grant consumido;
- depois dessa validação, o manager grava
  `worker.worker_status_id=connecting`, carimba `worker.updated_at` e somente
  então publica **Conectando** para tabela, cabeçalho e modal;
- a `whatsapp_session_lease` transitória não é revalidada nessa promoção. Ela
  continua cercando a escrita do provider, mas sua renovação/troca durante o
  pareamento não pode invalidar posteriormente uma evidência já escrita pelo
  writer epoch autorizado;
- um worker já `online`, uma geração substituída, uma tentativa diferente ou
  um grant não consumido/revogado continuam fail-closed e nunca regridem para
  `connecting`;
- somente o ACK central com sessão pronta grava `online` e apresenta
  **Conectado**.

Na prova real pelo Playwright, o canal Baileys `b3` apresentou **Conectando**
simultaneamente no cabeçalho, na tabela e no modal (**Conectando e pareando**).
No banco, a promoção ocorreu às `23:36:17` e o ACK final de `online` às
`23:36:28`, preservando uma janela intermediária observável de cerca de onze
segundos. Os eventos da tentativa nova foram publicados sem
`qr_connecting_fence_rejected`; em seguida, os três pontos da interface
apresentaram **Conectado**. A regressão focada concluiu 5 suites/657 testes,
além de ESLint, TypeScript e `git diff --check` aprovados. Esta atualização é
restrita à seção de conexão e não altera o próximo passo abaixo.

### Autorrecuperação do bootstrap durante uma tentativa de QR — 2026-08-11

O WWebJS `W1` expôs uma falha diferente da geração do QR. O worker persistido
estava em `disponible`, mas o container reiniciava durante o bootstrap com
`worker_runtime_fence_rejected`. O processo nasce pela ABI histórica de oito
argumentos, antes de receber comandos. Essa chamada não carrega o
`connection_attempt_id`; quando já existia um grant de pareamento pendente ou
consumido, ela apresentava um epoch novo e era corretamente recusada pela
fronteira estrita de nove argumentos. Um grant pendente já expirado também
podia ocultar o owner consumido e manter o mesmo container em restart loop.

A recuperação automática ficou definida assim para Baileys, WWebJS e
WhatsMeow, nos dois modos de armazenamento:

- a inicialização sem `connection_attempt_id` procura primeiro uma cerca de
  conexão que pertença exatamente ao próprio runtime;
- a prova exige worker, conta, provider, geração, writer epoch, capability
  hash e container físico atuais; nenhum campo é inferido do pedido de
  bootstrap;
- grant pendente e ainda válido retoma pela fronteira estrita de pairing,
  preservando o mesmo `connection_attempt_id`, epoch e sequência;
- grant já consumido que possui a conexão retoma pela fronteira canônica de
  sessão, também sem criar nova identidade;
- grant expirado, não consumido e não ativado pode ser revogado pelo próprio
  bootstrap somente depois de a identidade completa do runtime ser validada;
- worker `stopped`, runtime substituído, container divergente, capability
  incorreta, provider divergente ou geração antiga continuam fail-closed;
- a política de restart do container faz a nova tentativa de bootstrap e,
  portanto, conclui a recuperação sem recriar o worker. Reinício manual serve
  apenas para antecipar o backoff já agendado pelo Docker.

Na prova real, o mesmo container do `W1`, que estava em restart loop, iniciou
gRPC, HTTP e o consumidor de QR e alcançou `running/healthy` com restart count
zero desde a recuperação. O Playwright iniciou uma tentativa nova: os cinco
QRs foram emitidos como tentativas `1/5` a `5/5`, separados por aproximadamente
28 segundos; a interface permaneceu em **Aguardando leitura do QR code** e só
depois do quinto mostrou **Tentativas do QR Code expiradas** e **Reiniciar QR
Code**. O botão criou outro `connection_attempt_id` e apresentou o primeiro QR
em poucos segundos, mantendo `worker.worker_status_id=disponible` e o container
saudável. Os eventos `client_destroyed` entre QRs são apenas a reciclagem do
cliente Chromium e não representam `worker stopped` nem autorizam regressão do
status persistido.

### Reinício do QR após logout remoto no Baileys — 2026-08-11

O botão **Reiniciar QR Code** depois de uma remoção feita pelo próprio
WhatsApp expôs duas tentativas concorrentes. O frontend consultava o histórico
da tentativa e, depois de 1,5 segundo, fazia silenciosamente um segundo `POST`
ao endpoint de QR. Ao mesmo tempo, no primeiro pedido autorizado, o provider
cancelava o socket anterior depois de registrar a sessão de leitura; esse
cancelamento apagava a autorização de recuperação e podia herdar um orçamento
de retry antigo. O segundo `POST` mascarava o defeito, por isso uma recarga da
página parecia necessária para o QR finalmente surgir.

A fronteira corrigida ficou assim:

- uma ação do usuário cria exatamente um `connection_attempt_id` e faz somente
  um `POST`; os timers do modal podem consultar o histórico, mas nunca iniciar
  outra tentativa;
- o Baileys registra a sessão de leitura somente depois de cancelar o socket
  anterior, preservando a autorização da tentativa nova;
- todo pedido explícito recebe orçamento de retry novo, inclusive
  `from_disconnect_restart` logo após logout remoto;
- se a limpeza PostgreSQL/PQ do logout ainda estiver terminando, o próprio
  provider recicla o cliente e continua com a mesma tentativa, sem exigir
  refresh nem novo clique;
- a deduplicação do QR fica limitada à geração do socket. Ao renovar o socket,
  o hash anterior é descartado sem zerar o contador cumulativo; assim um QR
  novo com o mesmo sufixo técnico não é ignorado nem deixa o modal preso em
  **Preparando QR Code** até o timeout do transporte;
- o terminal de esgotamento do QR é uma evidência local da tentativa e não
  altera o status operacional persistido do worker. O modal aceita somente o
  terminal exato `428/disconnected`, correlacionado ao
  `connection_attempt_id` corrente e com `attempt > max_attempts`; terminais
  genéricos, atrasados ou de outra tentativa continuam descartados;
- a imagem persistente `under-worker-baileys:latest` foi atualizada com a mesma
  árvore validada, para que o comportamento sobreviva à recriação do worker.

Na prova Playwright sem recarga, o primeiro QR apareceu em 1,98 segundo. A
performance do navegador registrou uma única chamada ao endpoint
`/connection/qrcode` (118 ms), e o worker publicou o QR na tentativa corrente
mantendo container `running/healthy`. A tentativa exibiu os cinco QRs e, após o
terminal exato, apresentou **Tentativas do QR Code expiradas** e **Reiniciar QR
Code**. Sem atualizar a página, o botão iniciou exatamente um novo `POST` e um
novo QR ficou visível. Seis suítes focadas, com 658 testes, além de ESLint,
typecheck, build web e build do worker Baileys permaneceram verdes. Esta
atualização é restrita à seção de conexão e não altera o próximo passo abaixo.

### Remoção explícita seguida de QR imediato — lease PostgreSQL — 2026-08-11

O cenário real **Conectado → remover sessão → conectar novamente → QR Code**
expôs uma segunda corrida, desta vez no backend. O `DELETE /connection`
concluía a limpeza lógica da sessão e o manager instalava corretamente a
barreira de desconexão, mas o auth store PostgreSQL do processo Baileys
permanecia aberto e conservava a `whatsapp_session_lease` antiga. O
`POST /connection/qrcode` seguinte era aceito com HTTP `202`, porém isso
confirmava apenas a entrada na fila. Ao consumir o comando, o mesmo container
tentava adquirir uma nova autorização e recebia
`worker_runtime_fence_rejected`; por isso o modal permanecia em **Preparando QR
Code** mesmo com `worker.worker_status_id=disponible`.

A correção não usa polling nem repete o pedido pelo frontend. Ela fecha as
fronteiras que deixavam o estado antigo sobreviver à remoção:

- no armazenamento PostgreSQL, `clearSessionStorage()` limpa a sessão, remove
  a referência do auth store, invalida a autorização de runtime mantida em
  memória e fecha o store em bloco `finally`; o fechamento libera a lease
  antes de o manager concluir a remoção;
- em `legacy_volume`, o contrato continua sendo a destruição da identidade de
  sessão no provider antes do ACK do manager; não existe lease PostgreSQL a
  conservar, mas a mesma ordem de finalização é respeitada;
- o manager é o único dono da publicação terminal da remoção explícita. Baileys
  e WWebJS não publicam uma segunda transição `disponible`, evitando que uma
  escrita atrasada da operação antiga dispute com a barreira recém-instalada;
- uma rejeição transitória `worker_runtime_fence_rejected` durante preparação
  de QR é classificada como infraestrutura recuperável nos consumidores
  Baileys e WWebJS. O retry preserva a tentativa e suas cercas; ele não aceita
  geração, provider, container ou `connection_attempt_id` divergentes;
- WhatsMeow já encerrava sua lease de sessão antes do finalizador central e
  permanece coberto pela mesma propriedade: depois do ACK de remoção não pode
  existir owner antigo capaz de bloquear a tentativa seguinte;
- `worker.worker_status_id` permanece a verdade operacional. `disponible` é
  apresentado como **Aguardando leitura do QR code** e obriga o fluxo a ser
  recuperável; evidências nativas antigas nunca substituem esse status nem
  transformam o aceite `202` em sucesso fictício da geração.

Na prova real pelo Playwright, sem recarregar a página, o primeiro ciclo passou
por QR, **Conectando** e **Conectado** de forma dirigida exclusivamente pelos
eventos do runtime. Após a remoção explícita, os logs registraram
`session.cleared`, `lease.release` e somente então o ACK terminal do manager.
O banco ficou sem owner e sem token de lease ativo. O clique imediato em QR
adquiriu um token novo e publicou a primeira imagem em **676 ms**, sem
`worker_runtime_fence_rejected`, sem escrita de status obsoleta e sem polling.
A tentativa continuou com as cinco imagens previstas e terminou oferecendo
**Reiniciar QR Code** quando não houve leitura. A regressão focada concluiu seis
suítes/239 testes; ESLint, TypeScript, builds dos workers Baileys e WWebJS e
`git diff --check` também foram aprovados.

O catálogo e as fronteiras de todos os status persistidos e nativos continuam
formalizados em **Catálogo formal de status e correção da rotação WWebJS**
acima. Em especial, `native stopped/client_destroyed` continua significando
somente o cliente interno encerrado, enquanto `worker stopped` significa
container/runtime físico parado e permite apenas **Recriar**. Esta atualização
pertence somente ao histórico de conexão; o próximo passo abaixo foi preservado
integralmente.

## Próxima rodada: rollout `9 → 11`, prova WWebJS e matriz serial

Ainda não é seguro iniciar diretamente um handoff com a imagem atual. A
próxima rodada deve obedecer a esta ordem:

1. no fork WWebJS, escolher a próxima versão não utilizada — sugestão
   `1.34.35` — e atualizar também o `package-lock.json`;
2. commit/push e publicação do tarball real no registry interno somente depois
   dos gates do fork;
3. instalar o novo tarball no Underchat e atualizar `package.json`,
   `pnpm-lock.yaml`, `pnpm-workspace.yaml` e o contrato de dependência com a
   versão/integrity reais;
4. commit/push do Underchat com o ajuste do store web e esta memória;
5. gerar novo build, implantar os componentes da mesma árvore e atualizar os
   warms; provar versão e digest dentro do worker WWebJS ativo e dos dois
   warms WWebJS;
6. fazer preflight somente leitura completo;
7. recriar **somente o canal WWebJS**, uma única vez e sem retry;
8. aguardar o terminal exato e continuar observando depois de `Conectado` até
   ocorrer ao menos um checkpoint canônico posterior à materialização/rotação
   das sync keys;
9. exigir `canonical_checkpoint.completed`, projeção browser e PostgreSQL com
   a mesma contagem atual (no mínimo as onze keys já observadas),
   `last_persisted_at` e artifact posteriores à rotação, sem novo
   `wwebjs_canonical_app_state_diverged`;
10. somente se esse gate ficar verde, iniciar a matriz serial abaixo na mesma
    rodada. Qualquer falha mantém HOLD e encerra a rodada sem tentar handoff.

Não é necessário repetir novamente a recriação concorrente dos três canais:
Baileys G10, WWebJS G19 e WhatsMeow G5 já provaram o lifecycle. A prova nova é
deliberadamente WWebJS-only porque verifica a persistência pós-terminal que
falhou depois do canário aprovado.

### Matriz serial de handoff

Depois do gate WWebJS pós-rollout aprovado, executar as seis direções primárias
nesta ordem, exatamente como solicitado:

1. Baileys → WWebJS
2. Baileys → WhatsMeow
3. WWebJS → Baileys
4. WWebJS → WhatsMeow
5. WhatsMeow → Baileys
6. WhatsMeow → WWebJS

### Regra de isolamento da matriz

As direções primárias devem ser seriais, nunca concorrentes. Para manter a
origem correta de cada caso, executar um retorno monitorado ao provider base
entre casos quando necessário. Esses retornos são passos de preparação e não
alteram a ordem das seis direções primárias.

Uma forma segura de organizar:

- usar o canal Baileys para os itens 1 e 2, retornando a Baileys entre eles;
- usar o canal WWebJS para os itens 3 e 4, retornando a WWebJS entre eles;
- usar o canal WhatsMeow para os itens 5 e 6, retornando a WhatsMeow entre
  eles;
- depois do último item de cada canal, restaurar o provider original, salvo
  instrução explícita em contrário.

Antes de cada direção:

- dry-run GET-only aprovado;
- provider/revisão/session/lease/epoch/capability coerentes;
- lifecycle, handoff, recovery e resolution ativos iguais a zero;
- Redis locks/redrive/slots iguais a zero;
- outbox pending/DLQ causal/interativo/QR iguais a zero;
- Kafka Stable/lag zero;
- pools e imagens novos comprovados;
- assinatura realtime ativa antes do PATCH.

Depois de cada direção:

- aguardar terminal exato, ACK e lease;
- provar que a revisão candidata foi promovida e a origem preservada;
- confirmar nenhum QR, gap realtime, pending, DLQ ou recovery inesperado;
- comparar fingerprint/record count/artifact/checksum;
- parar imediatamente no primeiro blocker;
- nunca avançar para a direção seguinte enquanto houver compensação,
  resolution ou return em andamento.

## Estado para a pessoa que retomar

- A rodada concorrente mais recente está aprovada nos três lifecycles:
  Baileys G10, WWebJS G19 e WhatsMeow G5, todos online, ACK, QR falso,
  lifecycle nulo e completion exata.
- O problema antigo do WWebJS — probe concorrente com checkpoint, destruição do
  client e completion órfã — está corrigido e foi provado live.
- O WWebJS live G19 continua online e saudável, mas sua revisão 2060 permanece
  com nove sync keys enquanto o browser exporta onze. Não tentar persistir,
  limpar ou reparar isso manualmente.
- A causa da persistência estacionada foi corrigida localmente no fork. Quatro
  arquivos estão modificados, sem bump/commit/publish:
  - `src/authStrategies/RemoteAuth.js`;
  - `src/session/BrowserSessionBridge.js`;
  - `tests/authStrategies/remote-auth.js`;
  - `tests/session/browser-session-bridge.js`.
- Gates do fork: BrowserSessionBridge 123/123, RemoteAuth 81/81, ESLint,
  Prettier, `verify:package` com 158 arquivos/artefato web e
  `git diff --check`, todos verdes; revisão adversarial sem blocker.
- No Underchat, três arquivos locais estão modificados:
  - `apps/web/src/@webcore/stores/channels.ts`;
  - `packages/tests/unit/apps/web/channelsRealtimeStatus.store.test.ts`;
  - este documento.
- Gates Underchat: 52/52 testes focados, `test:typecheck`, `vue-tsc`, ESLint,
  Prettier, `test:locations`, build web e `git diff --check`, todos verdes. O
  build web emitiu apenas warnings baseline de CSS, annotations e chunks.
- Não há migration nova nesta entrega incremental.
- **HOLD para handoff com as imagens atuais.** A próxima conversa deve começar
  pelo rollout da nova versão do fork e pela recriação WWebJS-only descrita
  acima. Se o checkpoint pós-terminal persistir as onze keys sem divergência,
  iniciar imediatamente a matriz serial em Baileys → WWebJS e seguir a ordem
  das seis direções, parando no primeiro blocker.

## Atualização 2026-08-11 — decisão explícita e Baileys → WhatsMeow aprovado

Esta seção substitui o `HOLD` anterior **para a direção específica Baileys →
WhatsMeow** e registra o diagnóstico completo para que as tentativas incorretas
não sejam repetidas. Ela não aprova automaticamente as outras cinco direções da
matriz serial.

### Demanda atendida nesta rodada

Ao editar um canal e alterar o provider, ou ao alterar o servidor na tela
administrativa, a aplicação agora exige uma decisão explícita antes do PATCH:

- **Iniciar nova conexão** (`connection_strategy=fresh`): remove a sessão
  canônica PostgreSQL ou o volume legado de ponta a ponta, persiste o provider
  de destino, limpa número/data de conexão e abre o seletor de método existente
  (Authenticator, extensão, QR etc.);
- **Migrar conexão atual** (`connection_strategy=migrate`): preserva a sessão,
  inicia o lifecycle/handoff protegido e abre imediatamente o estado
  `Migrando canal`; uma falha continua no diálogo durável `Não foi possível
concluir a troca`, com `Retornar com segurança` ou `Conectar novamente`.

O enum novo está em
`packages/common/enums/EWorkerConnectionStrategy.ts`. O campo opcional foi
propagado pelos schemas, controllers, stores e use cases. A ausência do campo
mantém `migrate` como comportamento compatível para clientes antigos; a UI nova
sempre o envia quando houve mudança de provider/servidor.

As traduções do novo modal existem em `pt.json`, `en.json` e `es.json`. O
espanhol foi incluído explicitamente depois da revisão desta rodada: são oito
chaves `channel_connection_strategy_*` presentes e não vazias nos três locais.

### Causa raiz 1 — falso veto do estado PQXDH Baileys

O rollback PQXDH do Baileys já estava correto:

1. o worker enviava o RPC de remoção dos PQ prekeys ao servidor WhatsApp;
2. recebia ACK válido e persistia o marcador de rollback;
3. o estado canônico ficava clássico: um allocator state, `migrated=false`,
   zero PQ prekeys e zero sessões Signal PQ;
4. deliberadamente permanecia **um** registro nativo
   `baileys/signal/pq-pre-key-state`, que representa o allocator neutro.

O validador do WhatsMeow agregava esse registro de estado junto com material de
chave e exigia zero registros no namespace Baileys. A condição era impossível
mesmo após um rollback válido, então a migração falhava como
`whatsapp_whatsmeow_handoff_source_compatibility_failed`.

A regra corrigida separa material de chave e estado nativo. Ela aceita somente:

- estado canônico = 1;
- canônico `migrated=true` = 0;
- PQ prekeys canônicos = 0;
- sessões Signal PQ = 0;
- registros nativos de chave PQ = 0;
- registro nativo `pq-pre-key-state` = exatamente 1.

Estado ausente, duplicado, migrado ou qualquer material PQ residual continua
falhando fechado. **Não voltar a exigir zero para todo o namespace PQ do
Baileys**: isso reproduz exatamente o falso negativo desta rodada.

### Causa raiz 2 — lock de lifecycle fora da fronteira autorizada

Depois da correção PQ, a revisão WhatsMeow hidratava, autenticava sem QR e
chegava a `strong_online`, mas a promoção falhava em
`MarkWhatsmeowSessionReady`. O log PostgreSQL provou a causa:

`permission denied for table worker`

O role `whatsapp_session_runtime` não deve receber acesso direto à tabela de
controle `worker`. O código Go havia tentado executar `SELECT ... FOR UPDATE`
diretamente para manter a ordem worker → lease → session.

A migration `20260811120000.sql` foi a primeira tentativa de fronteira, mas
esperava que `app.whatsapp_worker_*` já estivesse instalado numa transação nova.
Ela falhou corretamente com `whatsapp session lifecycle scope is unauthorized`.
Essa função de um argumento foi removida e **não deve ser reintroduzida**.

A migration corretiva `20260811121000.sql` cria a fronteira final de sete
argumentos `begin_whatsapp_session_lifecycle(...)`, `SECURITY DEFINER`, que:

1. valida worker, account, provider, generation, writer epoch, hash da
   capability e container físico contra `worker` + `worker_runtime`;
2. aceita o target cross-provider somente quando o handoff/lifecycle exato
   ainda prova a autoridade da origem;
3. bloqueia `worker` e `worker_runtime` antes de qualquer sessão;
4. chama `begin_whatsapp_worker_operation(...)`, que revalida a linhagem,
   bloqueia a sessão e instala a assinatura HMAC transacional;
5. só então o Go entra no guard de mutação e chama a promoção canônica.

Privilégios permaneceram mínimos: `PUBLIC` foi revogado e somente
`whatsapp_session_runtime` pode executar a fronteira. **Não conceder SELECT na
tabela `worker` ao runtime e não mover o lock novamente para Go.**

### Telemetria causal adicionada

Falhas de hidratação/rollback do WhatsMeow agora persistem apenas códigos
allowlisted, sem incluir mensagens possivelmente sensíveis:

- `whatsapp_whatsmeow_handoff_input_failed`;
- `..._source_scope_failed`;
- `..._source_compatibility_failed`;
- `..._source_snapshot_failed`;
- `..._projection_conversion_failed`;
- `..._target_scope_failed`;
- `..._target_import_failed`;
- `..._target_finalize_failed`;
- `..._candidate_open_failed`;
- `..._bootstrap_failed`;
- `..._readiness_failed`;
- `..._promotion_failed`;
- `..._runtime_rollback` e `..._unknown_failed` como fallbacks.

O rollback SQL recebe o nono argumento `error_code`; logs imprimem somente o
código estável. Para diagnosticar no futuro, começar pelo `error_code` do
handoff e pelos eventos `handoff_source_preflight_completed`,
`handoff_hydrated`, `native_status.strong_online_accepted`,
`handoff_promoted` e `strong_online.persistence_completed`.

### Prova real final com o canal B1

Canal usado, sem QR e sem nova autenticação:

- worker: `019ff23b-b4e1-73d8-9b19-f3156232d06c` (`B1`);
- conta: `019a930d-c6f4-75ad-88ff-8d2fcd5839e1`;
- número preservado: `556192037138`;
- handoff aprovado: `80234f17-6a89-4723-bbd2-7b8dab98b1a5`;
- lifecycle: `019ff285-8f1d-70c4-a826-9effdb1595be`;
- origem: Baileys, revisão `3010`;
- destino: WhatsMeow, revisão `3023`;
- runtime generation final: `17`;
- fingerprint canônico v2:
  `91ee384c34852f1282382d97bd77802105cd4b09bb1bd1aa62f04fb4dc46daea`.

Estado final comprovado no PostgreSQL:

- `whatsapp_session.provider=whatsmeow`;
- `state=ready`;
- `active_revision_id=3023`;
- `previous_revision_id=3010`;
- handoff `completed`, `error_code=NULL`, `recovery_state=none`;
- worker `whatsmeow`, `online`, número original preservado.

O worker registrou, em ordem:

- preflight de `2528` registros / `210693` bytes;
- hidratação de `2528` registros / `218320` bytes;
- `Successfully authenticated`;
- `has_qr=false`, `has_session=true`;
- consumidores Kafka retomados dos offsets confirmados;
- `can_send=true` e `can_receive_runtime=true`;
- `handoff_promoted`;
- readiness e persistência strong-online concluídas.

Na UI após reload: `B1`, `+55 (61) 9203-7138`, `Conectado`, `Opção 3
(Socket)`, sem diálogo de falha e sem QR. Evidência visual:
`output/playwright/baileys-whatsmeow-migration-success.png`.

### Tentativas controladas que não devem ser repetidas

- `35a8fb7a-a068-4926-89a9-d2bb6f7530ca`, target `3020`: falso veto
  PQXDH; recuperação da origem completada.
- `beb84a20-6401-4baf-b609-e5eab13d5d29`, target `3021`: acesso direto do
  runtime à tabela `worker`; recuperação completada.
- `909c78a5-fa8f-47e4-adc8-1fe2d0997b8b`, target `3022`: primeira função de
  lifecycle esperava scope ainda inexistente; recuperação completada.
- `80234f17-6a89-4723-bbd2-7b8dab98b1a5`, target `3023`: prova aprovada.

Cada falha anterior voltou com segurança à mesma Baileys `3010`, online e com o
mesmo número. Não usar esses handoffs como sinal de sessão corrompida e não
limpar manualmente suas revisões; são histórico terminal/auditoria.

### Provas do fluxo novo e gates locais

Playwright validou:

- modal de decisão após alterar Opção 1 → Opção 3;
- ramo `migrate`, modal `Migrando canal` e handoff real completo;
- ramo `fresh` isolado por interceptação (sem tocar a B1), abrindo o seletor de
  métodos e sem mostrar `Migrando canal`;
- reload final da B1 conectada no WhatsMeow;
- único erro de console remanescente: imagem de perfil em
  `10.0.2.89:9002` indisponível, sem relação com conexão/handoff.

Evidência do seletor fresh:
`output/playwright/fresh-connection-method-chooser.png`.

A credencial fornecida não possui `full_access` e `/config?tab=channels`
retorna `not-authorized`. Portanto, não alterar permissões persistentes para
forçar um teste: o ramo administrativo de troca de servidor foi validado pelo
mesmo componente compartilhado, tipos e build, mas não por um PATCH live com
essa credencial.

Gates verdes desta rodada:

- `go test ./...` em `apps/worker_whatsmeow`;
- Jest focado: 2 suites / 80 testes;
- contrato unificado de sessão: 59 testes dentro da rodada focada;
- `pnpm run test:typecheck`;
- build de produção do web;
- validação das oito chaves i18n em `pt/en/es`;
- `git diff --check`;
- Atlas local aplicado até `20260811121000`.

O build web mantém apenas warnings baseline de CSS `:deep/:global`, annotation
do VueUse, imports dinâmicos e tamanho de chunks.

### Imagens e estado operacional ao encerrar

- A B1 aprovada está no container `ff8caf2e4f77...`, imagem
  `sha256:98672e4c758bf37c1f6f30cbd82abcb1a6948b7b43b82a5104c6160623bbecd9`,
  `healthy`.
- A imagem final, com a categorização adicional de telemetria, está carregada
  no servidor `10.0.2.15` como `under-worker-whatsmeow:latest` e como a ref
  imutável usada pelo provisionador local, digest
  `sha256:08cc85373ea1c7acdafbf01f5d4e1a0b800fe478e299ca9a387effca505dfca5`.
- Não foi necessário alterar/publicar os forks Baileys, WWebJS ou WhatsMeow:
  as duas causas estavam no validador/lifecycle do Underchat. Não criar bump de
  pacote para esta correção.

### Regras de retomada / não repetição

1. B1 deve ser tratada como WhatsMeow online, sessão ready na revisão `3023`.
2. Não voltar a migrá-la só para reprovar Baileys → WhatsMeow; essa direção já
   possui prova real completa.
3. Não exigir namespace PQ Baileys totalmente vazio; permitir somente o único
   allocator-state neutro conforme a regra acima.
4. Não conceder acesso direto do runtime à tabela `worker`.
5. Não reutilizar `begin_whatsapp_session_lifecycle(uuid)`; ela foi removida.
6. Toda promoção deve usar a fronteira de sete argumentos e manter a ordem de
   locks worker/runtime → lease/session/revision.
7. `fresh` é deliberadamente destrutivo; testes de UI devem usar interceptação
   ou um canal descartável, nunca a B1 aprovada.
8. `migrate` continua fail-closed: nenhum QR/pairing e nenhuma limpeza
   automática antes do ponto sem retorno.
9. Em falha, ler primeiro o código causal allowlisted e aguardar recovery
   terminal antes de qualquer nova ação.
10. As outras direções da matriz continuam exigindo prova serial própria; esta
    seção aprova somente Baileys → WhatsMeow.

## Atualização 2026-08-11 — WhatsMeow → Baileys aprovado e contrato bidirecional fechado

Esta seção complementa a anterior e substitui o `HOLD` **também para a direção
WhatsMeow → Baileys**. A partir desta prova, a preservação de sessão está
aprovada nos dois sentidos entre Opção 1 e Opção 3:

| Origem    | Destino   | Handoff real aprovado                  | Revisões      | Resultado            |
| --------- | --------- | -------------------------------------- | ------------- | -------------------- |
| Baileys   | WhatsMeow | `80234f17-6a89-4723-bbd2-7b8dab98b1a5` | `3010 → 3023` | mesma sessão, sem QR |
| WhatsMeow | Baileys   | `626eacd8-7603-47d8-897b-bebd6fc93628` | `3023 → 3025` | mesma sessão, sem QR |

Esta aprovação é específica para Baileys ↔ WhatsMeow. WWebJS e demais
direções da matriz continuam dependendo de suas provas seriais já documentadas.

### Baseline preservado e resultado da volta

A volta reutilizou a B1 que havia acabado de passar por Baileys → WhatsMeow:

- worker/session: `019ff23b-b4e1-73d8-9b19-f3156232d06c`;
- conta: `019a930d-c6f4-75ad-88ff-8d2fcd5839e1`;
- servidor: `019e98ad-aab4-715d-aa6b-9e0e027edc24`;
- número: `556192037138`;
- origem: WhatsMeow, revisão ativa `3023`;
- fingerprint canônico v2 antes da volta:
  `91ee384c34852f1282382d97bd77802105cd4b09bb1bd1aa62f04fb4dc46daea`.

O lifecycle da migração aprovada foi
`019ff2ad-668f-720b-9431-821e5333f4c3`. O source checkpoint da tentativa final
registrou `2532` entradas, `219027` bytes e checksum
`afaffe122e3c96e1b0a08f6281364eba6c8e3aa5b5943b58236640bbfad44f13`.

A promoção terminou às `2026-08-11 18:57:34 -03`, na geração `20`. Depois da
promoção, uma chamada de verificação encontrou a B1 já no Baileys e executou
somente um recreate Baileys → Baileys, `remove_session=false`, lifecycle
`019ff2d5-3688-7758-890f-b7133c509bf7`. Esse restart terminou online na geração
`21` e também serviu como prova de reabertura da revisão promovida. Ele não
criou revisão, não trocou fingerprint e não solicitou QR.

Estado canônico final:

- `worker_type=baileys`, `worker_status=online`;
- `whatsapp_session.provider=baileys`, `state=ready`;
- `active_revision_id=3025`, `previous_revision_id=3023`;
- handoff `626eacd8-...` em `completed`, `error_code=NULL`;
- runtime generation `21`, provider `baileys`, container
  `310cecca36bf95c978a510bcb4e813aec459fe1f75726849089b1bf3a7b5e2f0`;
- fingerprint final exatamente igual ao inicial:
  `91ee384c34852f1282382d97bd77802105cd4b09bb1bd1aa62f04fb4dc46daea`;
- status nativo `online`, `connected=true`, `authenticated=true`,
  `sessionValid=true`, `qrAvailable=false`;
- container `healthy`, Baileys `1.0.14` e imagem física
  `sha256:85e1a3876fa6b7ebcf5e741691f848a15613b8dfa0a54cc862d26f48ae6e513c`.

Na UI após reload: `B1`, `+55 (61) 9203-7138`, `Conectado`, `Opção 1
(Socket)`, sem modal de falha e sem QR. Evidência:
`output/playwright/whatsmeow-baileys-migration-success.png`.

### Primeira falha controlada — corrida do source WhatsMeow

A primeira tentativa reversa foi deliberadamente preservada como auditoria:

- handoff: `a1e4d78d-5f2e-45dc-a25f-6e2367b87ab0`;
- lifecycle: `019ff2a1-5b2b-707a-b6db-b42c9cd86e48`;
- origem `3023`, alvo `3024`;
- erro terminal:
  `whatsapp_whatsmeow_handoff_source_state_conflict`.

O source já havia entrado em drain, mas uma reconciliação online atrasada ainda
conseguia publicar/persistir strong-online. Essa persistência movia a sessão de
`handoff` para `ready`; quando o checkpoint tentava adquirir seu scope exato,
a linha já não satisfazia mais a autoridade do handoff e o SQL retornava zero
linhas. Não era perda de credencial e não devia ser tratada como sessão
corrompida.

Correção no worker WhatsMeow:

1. `sourceProviderHandoffInProgress` agora bloqueia a aceitação/persistência de
   native status online enquanto a origem está drenando;
2. `publishConnectedWithHealth` recusa publicação atrasada pelo mesmo fence;
3. `persistWorkerStatus` recusa strong-online atrasado com código seguro;
4. a ausência da linha autorizada do checkpoint é classificada como
   `whatsapp_whatsmeow_handoff_source_state_conflict`;
5. a ponte gRPC devolve `FAILED_PRECONDITION` apenas com o código allowlisted,
   nunca com a mensagem interna;
6. o handler reconhece esse código como falha terminal pré-drain e aciona a
   compensação segura existente.

O wrapper de erro seguro preserva uma categoria específica já aplicada. Não
voltar a embrulhar `source_state_conflict` como `source_snapshot_failed`, pois
isso perde a causalidade e faz o manager interpretar incorretamente o ponto do
lifecycle.

A origem foi restaurada automaticamente na mesma revisão `3023`. O modal
durável exibiu `Não foi possível concluir a troca`, `Canal anterior restaurado`,
`Retornar com segurança` e `Conectar novamente`. Evidência:
`output/playwright/whatsmeow-baileys-first-failure-restored.png`.

### Segunda falha controlada — checksum invalidado antes da promoção Baileys

Na tentativa final, a hidratação do alvo Baileys estava correta:

- `2171` registros no checkpoint inicial do alvo;
- checksum inicial
  `af00d79fc4d354e491329b2b15011f73f3bb7539869f9dded50afd00a096119e`;
- JID, LID, chaves e fingerprint iguais aos da origem;
- socket autenticado/aberto e nenhum QR gerado.

Mesmo assim, a primeira promoção do alvo `3025` falhou com SQLSTATE `23514`.
A causa não era projeção inválida: as escritas normais de credenciais e estado
PQ executadas depois da hidratação invalidam deliberadamente
`whatsapp_session_revision.checksum_sha256`, definindo-o como `NULL`. A função
SQL de promoção corretamente exige checksum não nulo, e o fork tentava o CAS
sem selar novamente a projeção final.

A correção está no fork `/home/maycon/baileys`, commit publicado
`a5c54c507dd9123311e3048da2fdf2bc9a9b0351`:

- pacote `@whiskeysockets/baileys@1.0.14` publicado no registry Gitea;
- `sealPromotionCandidate()` primeiro deixa o app-state necessário
  materializar;
- depois pausa novas escritas e aguarda todas as mutações pendentes drenarem;
- revalida as credenciais duráveis finais;
- executa `checkpoint()` já dentro dessa barreira;
- somente então permite `promote_whatsapp_session_revision(...)`.

`promotePendingHandoff()` e `promote()` usam a mesma barreira. O teste do fork
modela explicitamente uma escrita de credencial que torna o checksum nulo e um
banco que rejeita promoção sem checksum; ele prova que o novo checkpoint ocorre
antes do CAS.

**Não afrouxar a constraint SQL nem aceitar checksum nulo na promoção.** A
correção é selar o candidato final depois de congelar/drenar suas escritas. Uma
revisão já ativa pode voltar a apresentar checksum nulo depois de novas
mutações autorizadas; isso é invalidação normal do snapshot e não desfaz a
prova transacional que permitiu sua promoção.

### Terceira falha controlada — alvo autenticado ausente no redrive

Para colocar o Baileys `1.0.14` no mesmo handoff, o container alvo antigo foi
parado somente depois de se confirmar que a origem permanecia preservada. O
runtime PostgreSQL, corretamente, ainda descrevia aquele alvo autenticado. O
redrive existente autorizava reprovisionamento apenas para reservation fria
(`source_provider IS NULL`) e falhava fechado como
`worker_runtime_removal_database_fence_changed` quando o alvo já havia ativado.

O Balance agora aceita também a janela estreita “alvo ativado, container
ausente, promoção ainda incompleta”, mas somente quando todas as provas abaixo
coincidem:

- migração no mesmo servidor e containers de origem/alvo fisicamente ausentes;
- session storage PostgreSQL, sem volume legado;
- provider ativado igual ao provider do `worker_type_id` de destino;
- `connection_epoch` não vazio, sequence positiva e activation timestamp
  válido;
- operation id, generation e container id idênticos aos marcadores
  `recreate_bootstrap_*`;
- capability hash e writer epoch válidos;
- worker ainda aponta para o container da origem, conforme a janela de
  handoff.

Provider divergente ou ausência da prova de bootstrap continuam falhando
fechado. A reservation fria anterior, com `source_provider IS NULL`, continua
compatível. Testes cobrem o alvo ativado exato e recusam provider incorreto e
ownership de bootstrap ausente.

Essa mudança permitiu reprovisionar a geração `20`, reabrir o alvo `3025`,
selá-lo com o Baileys corrigido e completar o mesmo handoff `626eacd8-...`; não
foi criado outro handoff para contornar o estado.

### Proveniência publicada nesta rodada

- fork Baileys: commit
  `a5c54c507dd9123311e3048da2fdf2bc9a9b0351`, `origin/main`;
- pacote Gitea: `@whiskeysockets/baileys@1.0.14`;
- shasum do pacote: `48b3ae13921dded206de31a129455e877865f827`;
  integridade travada no lockfile:
  `sha512-d0SOqnXGFdHDEqCXqPArQDms9q+YBZYXYGo03ffeVWsDvoXlxG6X2WYJPzuiySQ+yKNgNZY5sfD1sBhzrglnfA==`;
- `under-worker-baileys:latest` e ref imutável do provisionador:
  `sha256:85e1a3876fa6b7ebcf5e741691f848a15613b8dfa0a54cc862d26f48ae6e513c`;
- `under-worker-whatsmeow:latest` e ref imutável do provisionador:
  `sha256:3f5de7be205f8bbc1d1003e523ab8146fefde99355bbe5ba0623398bcbc6ea1a`;
- `under-balance-api:latest`:
  `sha256:27cb9fe5fb20c2bb543b526c9201146d5cdd5c9b65feb28c9e64254da4df0526`;
- a imagem anterior do Balance foi preservada como
  `under-balance-api:pre-meow-baileys-20260811`.

O monorepo passa a apontar para `1.0.14` em `package.json`, `pnpm-lock.yaml` e
`pnpm-workspace.yaml`; o contrato de dependência também exige exatamente essa
versão. Não rebaixar apenas o `package.json`: specifier, snapshot, integridade e
allowBuild precisam mudar juntos.

### Validação de regressão

Gates executados nesta rodada:

- fork Baileys: 95 testes focados, 558 testes completos e build;
- handler de lifecycle/recreate do Underchat: 519/519 testes;
- contrato da dependência Baileys: 4/4 testes;
- worker WhatsMeow: `go test ./internal/app/...`;
- `gofmt -d` sem diferenças;
- ESLint dos arquivos TypeScript alterados sem erros;
- build Docker/TypeScript do Balance concluído;
- `git diff --check` sem erros;
- Playwright acompanhou falha segura, restauração, migração aprovada, reload e
  estado final conectado.

O lint global do fork Baileys ainda contém dívida anterior em arquivos não
alterados; as linhas desta correção estão formatadas, o build e as suítes acima
estão verdes. Não atribuir essa dívida preexistente à mudança de checksum.

O único erro de console após reload continua sendo a imagem de perfil em
`10.0.2.89:9002` indisponível. Não há erro de lifecycle, handoff, QR ou sessão.

### Contrato final Baileys ↔ WhatsMeow / regras de não regressão

1. O modal de estratégia é obrigatório quando provider ou servidor muda:
   `fresh` remove a conexão antiga e abre o seletor de método; `migrate`
   preserva a sessão e inicia o handoff protegido.
2. `fresh` é destrutivo e só deve ser exercitado em canal descartável ou por
   interceptação. B1 não deve ser apagada para repetir testes.
3. Nenhuma direção pode solicitar QR/pairing antes de falha terminal e escolha
   explícita de `Conectar novamente`.
4. Baileys → WhatsMeow deve manter o único allocator
   `baileys/signal/pq-pre-key-state` neutro; não exigir namespace PQ inteiro
   vazio.
5. A promoção WhatsMeow continua usando a fronteira `SECURITY DEFINER` de sete
   argumentos; não conceder SELECT de `worker` ao runtime.
6. Ao drenar um source WhatsMeow, fence native online, publish online e
   persistência strong-online até o handoff terminar ou ser compensado.
7. Erro `whatsapp_whatsmeow_handoff_source_state_conflict` é terminal
   pré-drain, sanitizado por gRPC e recuperável; não o esconder em uma categoria
   genérica.
8. Toda promoção para Baileys deve materializar app-state, pausar/drainar
   escritas, revalidar e criar checkpoint imediatamente antes do CAS.
9. Não remover a exigência SQL de checksum na promoção. Checksum nulo depois de
   uma mutação normal em revisão ativa significa apenas snapshot invalidado.
10. Um alvo PostgreSQL autenticado e ausente só pode ser reprovisionado com
    provider e ownership `recreate_bootstrap_*` exatos. Qualquer divergência
    continua fail-closed.
11. Redrive deve continuar o mesmo handoff/lifecycle quando ele ainda está
    pendente; não criar uma segunda revisão para mascarar uma janela
    recuperável.
12. Em qualquer falha, aguardar a resolução terminal e usar o modal durável:
    restaurar a origem ou, somente por decisão explícita, descartar e conectar
    novamente.
13. A prova bidirecional exige conservar número, JID/LID, fingerprint, chaves e
    `previous_revision_id`; status “online” isolado não é prova suficiente.
14. A B1 encerrou esta rodada no Baileys, revisão `3025`, geração `21`, online e
    saudável. Não repetir Baileys ↔ WhatsMeow nela apenas para reproduzir esta
    validação já concluída.

## 2026-08-11 — UX final e remoção da espera de 60 s no retorno WhatsMeow → Baileys

> Esta seção é a continuação mais recente e substitui, para o estado atual da
> B1, os números de revisão, geração, container e a orientação de não repetir o
> roundtrip da seção anterior. A nova repetição foi solicitada explicitamente e
> executada na mesma sessão para validar o problema de latência e o modal final.

### Resultado entregue

O fluxo protegido foi validado novamente, pela interface real e sem QR, nos
dois sentidos:

- Baileys (`Opção 1 (Socket)`) → WhatsMeow (`Opção 3 (Socket)`): `11,021 s`;
- WhatsMeow (`Opção 3 (Socket)`) → Baileys (`Opção 1 (Socket)`): `19,797 s`.

Ao terminar, o mesmo modal que exibe o progresso passa para a tela existente
`Conexão bem-sucedida!`, com o número do canal, instruções e link externo. Ele
não é mais fechado entre a promoção do handoff e o estado conectado. Isso vale
tanto para `/channels` quanto para a aba administrativa de canais em
configurações.

O estado final canônico da B1 é:

- worker/session `019ff2fb-2b45-7759-81be-e9055876379a`;
- número `556192037138`;
- `whatsapp_session.provider=baileys`, `state=ready`;
- revisão ativa `3034`, anterior `3033`, geração de sessão `7`;
- runtime generation `7`, provider `baileys`;
- container
  `7f17c3b4317babf00bb40cc54756bef7ba6f6d92eb68428cf6921c7235d19913`;
- native status `online`, `connected=true`, `authenticated=true`,
  `sessionValid=true`, `qrAvailable=false`;
- container saudável, sem restart, usando a imagem desta correção.

### Causa da lentidão assimétrica

A cópia e a validação da sessão WhatsMeow → Baileys não eram lentas. No caso
patológico anterior, handoff `b8f492ac-c258-4db2-aa57-f1139ec02c9a`, a origem
foi drenada em menos de um segundo e a revisão alvo foi validada em cerca de
cinco segundos, mas a promoção só terminou depois de aproximadamente
`101,075 s`.

O atraso adicional vinha do reconnect genérico do provider Baileys. Se a
primeira abertura transitória do socket não concluísse durante um handoff
pendente, qualquer tentativa seguinte herdava o `retryDelay` normal de
`60.000 ms`. Os consumers Kafka só começavam a se registrar depois desse
sleep. Por isso a direção Baileys → WhatsMeow normalmente terminava em 12–14 s,
enquanto o retorno podia ganhar um minuto artificial. Não era demora para
converter/copiar credenciais, nem espera introduzida pelo frontend.

A correção em
`packages/services/baileys/methods/connection.service.ts` separa os casos:

1. primeira tentativa de reconnect continua imediata (`0 ms`);
2. tentativa com QR continua em `1.500 ms`;
3. somente quando `postgresAuthStore.hasPendingHandoff()` confirma um handoff
   protegido, as tentativas seguintes usam `2.000 ms`;
4. reconnect comum, fora de handoff, continua em `60.000 ms`.

O intervalo de handoff é configurável por
`BAILEYS_PROVIDER_HANDOFF_RECONNECT_RETRY_MS`, limitado entre `250` e
`15.000 ms`, com padrão `2.000 ms`. Não usar esse valor para reconnect normal:
isso criaria tempestade de reconexão em operação diária.

A telemetria `baileys.provider.reconnect_scheduled` passou a registrar
`provider_handoff`, tentativa, motivo e delay. Há também os estágios
`handoff_reconnecting` e `handoff_reconnect_scheduled`, permitindo distinguir
recovery protegido de reconnect operacional sem depender de inferência por
tempo.

Na canary imediatamente anterior à correção, o retorno terminou em `23,281 s`.
Na imagem corrigida, terminou em `19,797 s`, sem entrar no sleep de 60 s. A
redução principal a proteger é contra o caminho patológico de ~101 s: quedas
transitórias futuras passam a custar ~2 s por tentativa, não ~60 s.

O tempo restante observado na execução aprovada é trabalho real e ordenado:

- abertura/sincronização do socket Baileys com as credenciais hidratadas;
- registro do ingress de comandos então vigente; na arquitetura atual isso é
  um consumer durável JetStream no subject exato do worker;
- materialização do app-state;
- pausa e drenagem das mutações;
- checkpoint final selado;
- promoção transacional da revisão e publicação do status conectado.

Não retirar readiness do ingress JetStream, o checkpoint selado ou o CAS de
promoção para reduzir esses segundos. Essas barreiras impedem status conectado
prematuro, perda de eventos e promoção de snapshot inválido. Os sete consumers
Kafka citados nas evidências dessa execução são históricos e não descrevem o
command plane atual.

### Correção do fechamento prematuro do modal

Em sucesso com sessão retida, `channels.vue` e
`config/channels-tab.vue` atribuíam o canal conectado, mas também fechavam
explicitamente `isDialogConnectionChannelShow`. A tabela atualizava para
`Conectado`, porém o usuário nunca via o estado final do componente existente.

Agora o fluxo:

1. conserva o dialog aberto;
2. troca o canal corrente pelo alvo promovido;
3. limpa os flags de progresso da migração;
4. deixa `AppConnectChannel` renderizar seu estado conectado normal.

Fechar pelo X continua sendo uma escolha explícita do usuário. Não voltar a
fechar o dialog automaticamente em `retained_session_ready` ou no resultado
equivalente do polling.

### Progresso moderno, X e idiomas

O componente `ChannelMigrationProgress.vue` mostra origem e destino com a
nomenclatura pública do sistema, por exemplo `Opção 3 (Socket)` →
`Opção 1 (Socket)`, além de proteção da sessão e animação com respeito a
`prefers-reduced-motion`.

O botão X foi movido para fora da região decorativa com overflow, recebe área
de toque própria e não fica mais recortado. O modal de escolha também usa o
mesmo padrão de fechamento. As novas mensagens existem em `pt.json`, `en.json`
e `es.json`; toda alteração futura nesse fluxo deve manter paridade entre os
três arquivos.

### Prova transacional do roundtrip final

Baileys → WhatsMeow:

- handoff `77691813-edcf-4155-99ab-5ce14efee9e9`;
- lifecycle `019ff32a-83a9-718b-b386-51e1531f883b`;
- revisão `3032` → `3033`;
- criado em `2026-08-11 20:31:17.552745 -03`;
- concluído em `2026-08-11 20:31:28.573719 -03`;
- duração `11,021 s`, `completed`, `error_code=NULL`.

WhatsMeow → Baileys:

- handoff `7523c7b8-cd1b-4d5d-b74e-a98c4a942026`;
- lifecycle `019ff32b-8a99-704b-a49e-0c2dcab284f2`;
- revisão `3033` → `3034`;
- criado em `2026-08-11 20:32:24.859953 -03`;
- origem drenada em `2026-08-11 20:32:25.649388 -03`;
- alvo validado em `2026-08-11 20:32:28.074435 -03`;
- concluído em `2026-08-11 20:32:44.656728 -03`;
- duração `19,797 s`, `completed`, `error_code=NULL`.

O checkpoint final do retorno registrou `2.270` registros, tamanho `617.972`
bytes, antes da promoção. O status online foi publicado somente após essa
selagem. Não houve QR, pairing ou nova autenticação.

O Playwright acompanhou os dois handoffs pela UI, validou os cards animados de
origem/destino e, nos dois sentidos, comprovou a transição do progresso para
`Conexão bem-sucedida!`. A captura final local desta execução é
`.playwright-cli/page-2026-08-11T23-33-41-602Z.png`. O único erro de console
continua sendo a imagem de perfil externa indisponível; não houve erro de
handoff, lifecycle ou sessão.

### Publicação e proveniência

- UI de progresso/X/i18n: commit `c3a166c1f` em `origin/main`;
- retry protegido, telemetria e modal final: commit `81958b1f5` em
  `origin/main`;
- imagem publicada:
  `harbor.devunder.com/underchat/balance/under-worker-baileys:v20260811232540462`;
- digest/conteúdo:
  `sha256:4c771180e3e2f7fb3a9153151b5f2ca3701bea021457ea33149e5e44229969ce`;
- a versão foi marcada como default apenas para o worker Baileys;
- quatro slots quentes antigos foram substituídos por containers
  ready/healthy dessa imagem; a B1 ativa não foi removida durante o rollout;
- não foi necessária nova alteração ou publicação do fork/pacote Baileys nesta
  rodada: a causa estava no agendamento de reconnect do Underchat e no estado
  do modal web.

O host do canal recebeu também a tag imutável da imagem antes da reconciliação.
Em um host novo, garantir autenticação válida no Harbor; não depender de cache
local de credencial ou de imagem previamente carregada.

### Gates executados

- 95/95 testes focados do serviço Baileys e contratos de recovery web;
- `vue-tsc --noEmit` do web;
- build de produção do worker Baileys;
- Prettier nos arquivos alterados;
- `git diff --check`;
- Playwright real, serial, na mesma B1/sessão, nos dois sentidos;
- inspeção PostgreSQL do handoff, revisão, runtime e status nativo;
- inspeção do container final: healthy, restart `0`, imagem corrigida.

### Regras adicionais de não regressão

1. Sucesso com sessão retida deve terminar no modal existente
   `Conexão bem-sucedida!`; não basta atualizar a tabela atrás do overlay.
2. O mesmo dialog deve evoluir de estratégia → progresso → sucesso ou falha,
   sem piscar/fechar entre estados.
3. O progresso deve sempre receber provider de origem e de destino reais; não
   deduzir a origem depois que o worker já foi atualizado.
4. O retry curto só existe com `hasPendingHandoff()=true`. QR e reconnect comum
   mantêm seus delays próprios.
5. Não substituir a consulta de handoff pendente por flag apenas de frontend ou
   variável de processo; após restart, PostgreSQL continua sendo a autoridade.
6. Manter a telemetria `provider_handoff` e `delay_ms`; ela é a prova de que uma
   execução lenta entrou ou não no sleep incorreto.
7. Não publicar conectado antes de socket, ingress JetStream ready/autorizado,
   app-state, checkpoint e promoção estarem prontos.
8. Não retirar a barreira de escrita/checksum do Baileys para ganhar tempo.
9. Toda mudança visual do fluxo deve preservar X sem clipping,
   `prefers-reduced-motion`, layout responsivo e traduções `pt/en/es`.
10. O próximo canary não precisa apagar a sessão. Medir pelo mesmo handoff e
    registrar `created_at`, drain, validação, checkpoint, promoção e
    `completed_at` antes de atribuir atraso à cópia de credenciais.
11. A B1 encerrou esta rodada em `Opção 1 (Socket)`, conectada e saudável na
    revisão `3034`. Não repetir o roundtrip apenas para reproduzir esta prova já
    concluída.

## 2026-08-14 — WWebJS `legacy_volume`: recreate preso por versão Web pinada

> Registro da correção solicitada para o canal descartável `Wwebjs Legacy`,
> incluindo diagnóstico isolado, publicação e provas live no mesmo volume.

### Sintoma e causa comprovada

O canal `01a00236-10c8-77ef-96b2-06a52b0ed59a`, criado deliberadamente com
`session_storage=legacy_volume`, conectou por QR e gravou sua sessão no volume
homônimo. Na primeira recriação, a geração `2` permaneceu em `recreating` e o
provider repetiu `wwebjs_web_version_mismatch` pelo menos vinte vezes. O volume
e a sessão não foram apagados.

O artefato embarcado do fork está íntegro: versão
`2.3000.1044338228`, SHA-256
`e9e6569139c714aabad2832f1f097f2dcdef0d7f459d549b839489beaedf7609` e
`573208` bytes. O defeito é a combinação de dois comportamentos:

1. o perfil Chromium persistente permite que o Service Worker do WhatsApp
   avance seu conteúdo; o volume já continha builds `2.3000.1045232257` e
   `2.3000.1045239364` depois da conexão inicial;
2. o caminho legacy forçava novamente `2.3000.1044338228`; além disso,
   `Util.mergeDefault` fazia uma política explícita `{ type: 'none' }` herdar
   silenciosamente o manifesto `integrity` do cache embarcado, portanto o
   documento live continuava sendo tratado como pinado.

Uma cópia descartável e isolada dos `159 MiB` do volume reproduziu o erro com
`expected=2.3000.1044338228` e `actual=2.3000.1045239364`. Na mesma cópia,
desabilitar efetivamente cache e pin abriu a sessão existente em cerca de dez
segundos, com `READY`, `online`, `authenticated=true`, `sessionValid=true`,
sem QR. Essa prova não alterou o volume original.

### Correção do fork preparada e versionada

No fork `/home/maycon/wwebjs`, `Client` passa a tratar `webVersionCache.type =
'none'` como política completa: depois do merge, remove os campos incompatíveis
do cache default. `assertPinnedWebVersion` também recusa aplicar o manifesto
quando o tipo é `none`, como defesa em profundidade. O default continua
integrity-pinned; somente um opt-out explícito deixa de usar o artefato
empacotado.

Foi acrescentado teste unitário que prova simultaneamente que `type=none` não
herda `integrity` e que uma versão live diferente não dispara
`wwebjs_web_version_mismatch`. Não remover esse teste nem reintroduzir merge de
campos de políticas de cache incompatíveis.

O código e o teste foram commitados e enviados a `origin/main` no fork:
`7f19a4b3` (`fix(web-cache): honor explicit live policy`). Antes da publicação,
passaram `8/8` testes focados de cache, `499` testes de auth/session/cache/util
com uma pendência externa já conhecida, ESLint, Prettier, verificação do
artefato Web e auditoria dos `158` arquivos do pacote.

Publicação concluída no registry Gitea:

- release commit `49a2b3db`, tag `v1.34.118`, ambos em `origin/main`;
- pacote `@wwebjs/whatsapp-web.js@1.34.118`;
- shasum `9b38c7cde3b025cb61e28415e868064a6364b915`;
- integridade travada no lockfile Underchat:
  `sha512-Y+lnLMY33XfzJp/a9ObhdmvHdb+tLipzEe23noUSbcJk9wOt7z90twaluZm51Gze/sN/QZvcADthqWIDBVy/Tg==`;
- pacote com `158` arquivos e artefato Web íntegro.

No Underchat, `package.json` e `pnpm-lock.yaml` apontam para `1.34.118`. O
serviço WWebJS deixou de atribuir `webVersion` no ramo `legacy_volume` e passa
`webVersionCache={type:'none'}`; o fork garante que essa opção não herda o pin.
O ramo PostgreSQL continua selecionando a mesma política live que já utilizava,
sem alteração de `RemoteAuth`. O contrato real da dependência foi ampliado para
verificar a versão instalada e o opt-out completo, e o contrato do serviço
verifica separadamente as opções de PostgreSQL e legacy.

### Fronteira de não regressão

- O ajuste do Underchat deve selecionar a política live somente quando
  `WORKER_SESSION_STORAGE=legacy_volume`; o fluxo PostgreSQL mantém o
  `RemoteAuth`, preflight de ABI, identidade canônica e fences atuais.
- A sessão e o volume legacy originais devem permanecer intactos durante
  build, publicação e rollout.
- A prova final exige o mesmo worker, mesmo volume e mesmo número em nova
  geração, `online`, `sessionValid=true`, ACK central e UI `Conectado`, sem QR.
- Não “resolver” limpando CacheStorage, IndexedDB, cookies ou a sessão: isso
  mascara a incompatibilidade e transforma recreate em nova autenticação.

### Publicação e primeiras provas live

O Underchat foi commitado e enviado a `origin/main` em `349e0ef3a`
(`fix(wwebjs): reopen legacy volumes on live web build`). Os contratos WWebJS
passaram `141/141`, o typecheck global, ESLint, Prettier, `diff-check` e o build
do worker ficaram verdes.

O build seletivo `v20260814220045369`, job
`01a0024a-b439-7636-8318-8e12a2efcb9c`, publicou somente Worker WWebJS em
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814220045369`,
digest imutável
`sha256:7ae7ff7ae4820b171d09ee9b031fd2de897481c5e6b6f744d2d0b9c0e1f032fd`.
A imagem passou a ser default e foi pré-baixada sequencialmente nos Servers 1
e 2; em ambos, a inspeção dentro da imagem confirmou fork `1.34.118` e política
explícita `{type:'none'}`. Nenhuma imagem ou pool de Baileys/WhatsMeow foi
alterado.

As duas primeiras recriações reais do mesmo worker
`01a00236-10c8-77ef-96b2-06a52b0ed59a`, número `556192037138`, mantiveram
`session_storage=legacy_volume` e o volume homônimo:

- geração `3`: política live aplicada em `22:11:38.952Z`, autenticada às
  `22:11:47.843Z`, `online/ready` às `22:11:48.197Z`, sessão validada às
  `22:11:49.788Z` e status conectado publicado às `22:11:51.527Z`;
- geração `4`: política live aplicada em `22:13:14.518Z`, autenticada às
  `22:13:19.349Z`, `online/ready` às `22:13:20.175Z`, sessão validada às
  `22:13:22.245Z` e status conectado publicado às `22:13:23.526Z`.

Ambas concluíram na tentativa `1`, com `authenticated=true`,
`sessionValid=true`, `qrAvailable=false`, ACK central e UI `Conectado`. Não
houve novo `wwebjs_web_version_mismatch`. A geração `3` usou o container
`0f9315a2426f…`, saudável e comprovadamente criado do digest acima; a geração
`4` repetiu o resultado após uma segunda aposentadoria/reabertura do mesmo
volume.

A terceira repetição, geração `5`, aplicou a política live às
`22:15:38.456Z`, autenticou às `22:15:43.685Z`, ficou `online/ready` às
`22:15:44.840Z` e recebeu status conectado/ACK às `22:15:48.187Z`. O primeiro
probe imediatamente após `ready` ainda encontrou o cliente em estabilização;
o probe seguinte, cerca de três segundos depois, confirmou todas as barreiras.
Esse fallback transitório é intencional e não abriu QR nem repetiu o bootstrap.
Portanto, o canário legacy fechou em `3/3` recriações reais funcionais no mesmo
volume, todas na primeira tentativa do provider.

Como prova de não regressão, o canal WWebJS PostgreSQL
`019ffb52-7e9e-71cc-a611-a1e1725ae68c` também foi recriado preservando a
sessão. A geração `66` abriu a revisão canônica `3197`, executou preflight de
ABI, validações de handoff, snapshot/app-state e promoção, e terminou
`online`, `sessionValid=true`, sem QR e com ACK central às `22:17:35.609Z`.
Esse fluxo levou aproximadamente `53 s` porque a revisão ainda tinha origem de
handoff WhatsMeow; a política/ordem dessas barreiras não foi relaxada para
mascarar o tempo.

Por fim, o rollout dos pools foi limitado a `Opção 2 (Navegador)`. Os quatro
pools antigos prontos foram substituídos pelo fluxo oficial `Recriar Todos`
com o filtro WWebJS, resultando em dois pools `ready` por servidor:

- Server 1: `01a0025a-f82b-70e9-ac4d-3bad68d7d8d1` e
  `01a0025a-f843-739a-b32c-f0d8262cd5e4`;
- Server 2: `01a0025a-f80f-729e-ab03-c8cc31d42c97` e
  `01a0025a-f85b-75dd-9eb5-49658ec06e6c`.

Os quatro containers ficaram `running/healthy`, usam o digest
`sha256:7ae7ff7ae4820b171d09ee9b031fd2de897481c5e6b6f744d2d0b9c0e1f032fd`
e reportam fork `1.34.118`. Os pools Socket não foram recriados.

A cópia diagnóstica `codex-wwebjs-legacy-diag-20260814`, criada somente para a
reprodução isolada, foi removida depois das provas. Antes da remoção foi
confirmado que nenhum container a utilizava. O volume original
`01a00236-10c8-77ef-96b2-06a52b0ed59a` permaneceu existente e montado em
`/app/data` no container ativo. A validação visual final pelo Playwright mostrou
tanto `Wwebjs` PostgreSQL quanto `Wwebjs Legacy` em `Conectado`.

## 2026-08-14 — bateria de recriação legacy/PostgreSQL e migrações (rodada pós-`nocopy`)

> Rodada nova solicitada depois da criação dos canais legacy. As contagens
> abaixo não reutilizam provas antigas, exceto onde o texto declara
> explicitamente a origem da sessão. Cada recriação usa a estratégia **Manter
> a conexão atual** pela UI visível e só conta quando runtime, estado nativo,
> ACK central e ausência de QR fecham juntos.

### Criação segura de volumes e correção Baileys legacy

Volumes Docker recém-criados estavam recebendo por cópia automática os dados
existentes em `/app/data` da imagem. Isso contaminou os primeiros canais
legacy com sessões embarcadas. Os dois caminhos de criação do
`WorkerService` — worker ativo e warm legacy — agora montam
`<volume>:/app/data:nocopy`. Um teste real no Docker 29.5.3 confirmou o modo e
os contratos cobrem os dois caminhos. Não remover `nocopy`: um volume novo
deve nascer vazio e pertencer somente ao canal.

No Baileys, `useMultiFileAuthState` persistia protobufs binários como Base64,
mas os relia como `string`. A sessão parecia registrada e o socket chegava a
abrir, porém a identidade ADV não passava na admissão nativa após restart. O
fork agora aplica `normalizeAuthenticationCredentialBinaries` ao carregar
`creds.json`. A correção foi publicada como
`@whiskeysockets/baileys@1.0.28`, commit `485c74f57f`, shasum
`e71dee6d78f76c60f757797d7d543c2823733e40`. O teste determinístico escreve,
fecha e reabre uma identidade protobuf e confirma a restauração para
`Uint8Array`; o fork passou `39/39` suites e `577/577` testes. Não enfraquecer
o gate nativo `ONLINE` para contornar credencial mal hidratada.

A imagem default da rodada é
`harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814230511311`,
conteúdo local no Server 1
`sha256:03d0ad7db26821f4f7f6c666d6a8afcbf527f66e37ebc26f51d940a183beb71f`.
Um warm saudável confirmou o pacote `1.0.28` antes dos canários.

### Baileys Legacy — 3/3 recriações preservadas

Worker `01a00268-d35d-738e-8bd5-6cc040d85d59`, volume homônimo, Server 1.
Todas as gerações usaram a mesma sessão/número, mount `/app/data:nocopy`,
`qrAvailable=false`, container saudável sem restart, status nativo `online`,
`sessionValid=true`, ACK central e UI `Conectado`:

- geração 2, operação `01a0029b-e763-76aa-82d7-9e721e8b22b1`: primeiro evento
  `20:29:29.973-03`, status forte `20:29:50.467-03`, conclusão
  `20:29:51.103-03`; estabilização inicial dos consumidores em cerca de 22 s;
- geração 3, operação `01a0029e-21b6-73f9-bd46-ce186aba1c97`: primeiro evento
  `20:31:55.877-03`, status forte `20:31:59.498-03`, conclusão
  `20:32:01.945-03`;
- geração 4, operação `01a002a0-9566-779f-89ca-845fc05e57c4`: primeiro evento
  `20:34:36.851-03`, status forte `20:34:39.982-03`, conclusão
  `20:34:41.756-03`.

Os 18 registros de outbox das três gerações foram publicados na tentativa 1,
sem dead-letter. A diferença da primeira execução foi estabilização transitória
dos consumidores, não falha de sessão; as duas repetições seguintes fecharam o
status forte em aproximadamente quatro e três segundos.

### WhatsMeow Legacy — 3/3 recriações preservadas

Worker `01a00269-ceb2-777d-bb5f-2babbe150663`, volume homônimo, Server 1. A
leitura inicial do QR que criou a sessão não entra na contagem. Depois dela,
foram executadas três recriações explícitas com preservação:

- geração 3: primeiro evento `20:33:46.182-03`, status forte
  `20:33:47.439-03`, conclusão `20:33:48.321-03`;
- geração 4: primeiro evento `20:37:25.019-03`, status forte
  `20:37:26.280-03`, conclusão `20:37:27.157-03`;
- geração 5, operação final `01a002a5-73f3-752d-a5df-08063a5d02ce`:
  primeiro evento `20:39:53.531-03`, status forte `20:39:55.037-03`,
  conclusão `20:39:56.666-03`.

As três fecharam na primeira tentativa, sem QR, com `online`,
`authenticated=true`, `sessionValid=true`, ACK central e UI `Conectado`. O
container final `b8b20c87898c…` ficou healthy, restart `0`, no mesmo volume e
mount `/app/data:nocopy`.

Na geração 5, a telemetria fraca `online` de sequência 1 foi reclamada depois
que o status forte de sequência 2 já havia avançado a fence. Ela foi
corretamente descartada como `stale_runtime`; o status forte foi publicado e
confirmado. Isso é proteção contra reordenação, não falha da sessão. Não
relaxar a igualdade de `connection_sequence` para eliminar esse dead-letter:
um evento antigo nunca deve atravessar uma projeção mais nova. Em auditorias,
distinguir `stale_runtime` comprovadamente supersedido no mesmo runtime de
dead-letter sem sucessor forte.

### WWebJS Legacy — 3/3 recriações preservadas

Worker `01a00236-10c8-77ef-96b2-06a52b0ed59a`, volume homônimo, Server 1.
Esta é uma bateria nova, posterior às três provas documentadas na correção do
cache Web:

- geração 6: primeiro evento `20:36:33.109-03`, status forte
  `20:36:42.166-03`, conclusão `20:36:43.125-03`;
- geração 7: primeiro evento `20:39:09.916-03`, status forte
  `20:39:18.544-03`, conclusão `20:39:19.523-03`;
- geração 8, operação `01a002a7-2a2f-752f-8cb3-c9fcfadd67f7`:
  primeiro evento `20:41:51.114-03`, status forte `20:42:00.431-03`,
  conclusão `20:42:01.232-03`.

As três ficaram fortes em aproximadamente `9,1 s`, `8,6 s` e `9,3 s`, sem
QR, sem dead-letter e com todos os eventos publicados na tentativa 1. O
container final `aa2a139e9141…` ficou healthy, restart `0`, no mesmo volume,
mount `/app/data:nocopy`, `online`, `sessionValid=true` e ACK central. Não foi
necessário alterar novamente o fork WWebJS nem a política live específica do
legacy.

Resultado agregado da rodada legacy: Baileys `3/3`, WhatsMeow `3/3` e WWebJS
`3/3`, todos preservando sessão. A inspeção visual pelo Playwright permaneceu
aberta durante as operações.

### Baileys PostgreSQL — 3/3 recriações preservadas

Worker `019ffb4e-1456-747b-8197-f19abb1eafe1`. A nova bateria usou as
gerações 89–91:

- geração 89: primeiro evento `20:38:21.294-03`, status forte
  `20:38:23.499-03`, conclusão `20:38:24.993-03`;
- geração 90: primeiro evento `20:45:51.082-03`, status forte
  `20:45:55.246-03`, conclusão `20:45:57.895-03`;
- geração 91, operação `01a002ad-bee9-75e8-822b-e5cfedc55e42`: primeiro
  evento `20:49:01.170-03`, status forte `20:49:04.006-03`, conclusão
  `20:49:05.385-03`.

As três ficaram `online`, com `sessionValid=true`, QR ausente, ACK central e
sem dead-letter. A sessão canônica terminou `ready`, provider `baileys`,
geração 91, revisão ativa `3173` e anterior `3172`. Telemetrias periódicas que
continuam sendo publicadas enquanto a geração permanece ativa não devem ser
usadas como duração da recriação; medir do primeiro evento da geração até o
status forte/conclusão.

### WhatsMeow PostgreSQL — 3/3 recriações preservadas

Worker `019ffb4f-f7bc-7329-a25b-510cf114f679`, gerações 11–13:

- geração 11: primeiro evento `20:43:22.083-03`, status forte
  `20:43:23.354-03`, conclusão `20:43:25.165-03`;
- geração 12: primeiro evento `20:46:36.079-03`, status forte
  `20:46:37.340-03`, conclusão `20:46:39.224-03`;
- geração 13, operação `01a002af-1755-76ba-95d5-ac8f77cba235`: primeiro
  evento `20:50:24.904-03`, status forte `20:50:26.181-03`, conclusão
  `20:50:28.026-03`.

Todas terminaram `online`, `sessionValid=true`, sem QR e com ACK central. A
sessão canônica fechou `ready`, provider `whatsmeow`, geração 13, revisão ativa
`3095`. Em cada geração, a telemetria fraca `online` de sequência 1 perdeu a
corrida para o status forte de sequência 2 e foi descartada como
`stale_runtime`; o sucessor forte foi publicado imediatamente. É o mesmo caso
de reordenação segura observado no legacy, não perda de estado.

### WWebJS PostgreSQL — 3/3 recriações preservadas

Worker `019ffb52-7e9e-71cc-a611-a1e1725ae68c`, gerações 67–69:

- geração 67: primeiro evento `20:44:19.743-03`, status forte
  `20:45:07.414-03`, conclusão `20:45:08.150-03`;
- geração 68: primeiro evento `20:47:32.784-03`, status forte
  `20:48:18.765-03`, conclusão `20:48:19.197-03`;
- geração 69, operação `01a002b0-694b-7309-ae33-e1c4c7d33072`: primeiro
  evento `20:51:58.451-03`, status forte `20:52:45.722-03`, conclusão
  `20:52:46.182-03`.

As três passaram na tentativa 1, sem QR e sem dead-letter, com estado nativo
`online/ready`, ACK central e UI `Conectado`. A sessão terminou `ready`,
provider `wwebjs`, geração 69, revisão ativa `3197` e anterior `3196`.

O tempo forte ficou estável entre aproximadamente 46 e 48 segundos. As três
execuções passaram por `handoff_validation` porque a revisão canônica ainda
exige as barreiras de origem cruzada, ABI, checkpoint/app-state e promoção.
Não houve retry, sleep incorreto ou pull de imagem. A baixa dispersão e a
ausência de falha indicam trabalho obrigatório, portanto não relaxar essas
barreiras apenas para reduzir o número exibido.

Resultado agregado da rodada PostgreSQL: Baileys `3/3`, WhatsMeow `3/3` e
WWebJS `3/3`, todos preservando a sessão e sem nova autenticação.

### Migração Baileys ↔ WhatsMeow — corrida de probes encontrada na carga alternada

A bateria alternada encontrou uma condição que os canários isolados não
expunham. Os primeiros handoffs concluíram normalmente (`4,132 s`, `12,158 s`
e `3,161 s`), mas uma segunda volta WhatsMeow → Baileys levou `99,159 s`. A
sessão permaneceu protegida, autenticada e sem QR durante todo o intervalo; a
promoção só ocorreu depois de todas as barreiras fortes ficarem prontas.

A correlação do runtime geração `95` provou que a hidratação canônica terminou
em aproximadamente `0,54 s` e o socket abriu em cerca de `8,4 s`. A espera não
era cópia de sessão nem JetStream: dois chamadores de readiness executavam o
mesmo probe Baileys simultaneamente. O segundo recebia
`WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT`, que era traduzido para
`session_probe_failed:whatsapp_provider_auxiliary_in_flight`. Esse resultado
transitório derrubava o estado local para `connecting`, interrompia/reabria o
ingress JetStream e criava ciclos até um probe não concorrer com o anterior.
Uma reprodução seguinte fechou em `24,609 s` e apresentou a mesma assinatura.

O `BaileysHealthCheckService` agora single-flights o probe completo por objeto
de socket: verificações simultâneas compartilham a mesma promessa e, portanto,
o mesmo resultado forte. A segurança não foi relaxada: `fetchPrivacySettings`,
`onWhatsApp`, sessão local, bridge inbound, número próprio e todas as barreiras
de promoção continuam obrigatórios. O contrato novo mantém o primeiro probe
pendente, dispara dois `verifyCurrentSession()` concorrentes e prova uma única
invocação de cada método do provider, com ambos os chamadores recebendo
`session_ready=true`. A suíte focada passou `20/20` antes do rollout.

Não tratar novamente `WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT` como evidência de
sessão inválida, nem contornar o problema removendo o probe forte. Os textos
legados `Kafka` presentes em nomes de funções/telemetria dessa área referem-se
ao ingress de comandos atualmente implementado por NATS JetStream; não indicam
retorno do command plane para Kafka.

#### Rollout e prova pós-correção — `v20260815000746230`

A correção foi publicada no commit Underchat `e6106b39e` e na imagem
`harbor.devunder.com/underchat/balance/under-worker-baileys:v20260815000746230`,
digest `sha256:c482d5c13cbe91b1ae5f75255cf3d5f15aa72e5fd46660f3fbad93d58de25efc`.
O artefato foi inspecionado nos Servers 1 e 2 e contém
`openSocketProbeFlights`. Os quatro warms Baileys de cada servidor foram
recriados pela tela de canais aquecidos; os oito retornaram `ready`,
`running/healthy` e no mesmo digest antes de iniciar os canários.

O job acidental `v20260815000708336`, que havia sido cancelado pela interface,
manteve um `docker buildx` WWebJS órfão ocupando o mutex até ser encerrado. Ele
terminou como falha por `context canceled`, sem imagem promovida ou instalada.
O job correto, exclusivo Baileys, foi executado em seguida e concluiu com
sucesso. Se um job cancelado deixar o próximo indefinidamente em `queued`,
correlacionar versão/job com o processo `docker buildx`; não cancelar nem
remover imagens ativas por aproximação.

Depois do rollout, foram feitos cinco ciclos alternados no worker PostgreSQL
`019ffb4e-1456-747b-8197-f19abb1eafe1`, totalizando cinco provas em cada
direção. Todos os dez handoffs terminaram `completed`, `attempt_count=0`, sem
`error_code`, sem QR e com UI `Conexão bem-sucedida!`; o worker terminou
Baileys geração 107, `online`, status nativo `online` e ACK central:

| Rodada | Baileys → WhatsMeow | WhatsMeow → Baileys |
| ------ | ------------------: | ------------------: |
| 1      |             6,126 s |            11,746 s |
| 2      |             4,271 s |            12,751 s |
| 3      |             4,638 s |            11,833 s |
| 4      |             3,832 s |            15,691 s |
| 5      |             4,775 s |            16,923 s |

Os números da tabela são `completed_at - created_at` no handoff durável; a UI
inclui alguns segundos adicionais de transição/renderização. Não reapareceram
`WHATSAPP_PROVIDER_AUXILIARY_IN_FLIGHT` nem
`session_probe_failed:whatsapp_provider_auxiliary_in_flight`. A variação de
WhatsMeow → Baileys ficou limitada ao handshake real e às barreiras fortes de
credencial/checkpoint/promoção, muito abaixo dos `24–99 s` causados pela
corrida. Avisos transitórios de persistência de telemetria antes da promoção
não derrubaram a revisão e não podem ser usados para relaxar as fences; o gate
final continuou exigindo `online`, sessão válida, checkpoint persistido e ACK.

### Migração WWebJS ↔ Baileys — bateria 5/5 pós-fix

O worker PostgreSQL `019ffb52-7e9e-71cc-a611-a1e1725ae68c` foi alternado cinco
vezes em cada direção pela UI Playwright visível. Os dez handoffs terminaram
`completed`, `attempt_count=0`, sem `error_code`, sem QR e com a tela
`Conexão bem-sucedida!`. Ao final, o worker ficou WWebJS geração 79, `online`,
status nativo `online` e ACK central.

| Rodada | WWebJS → Baileys | Baileys → WWebJS |
| ------ | ---------------: | ---------------: |
| 1      |         29,092 s |         53,421 s |
| 2      |         18,379 s |         51,827 s |
| 3      |         18,019 s |         51,669 s |
| 4      |         17,222 s |         50,412 s |
| 5      |         16,869 s |         53,010 s |

WWebJS → Baileys transportou `2313` registros e checkpoints de aproximadamente
`166–180 MB`; o primeiro canário pagou aquecimento inicial, e os quatro
seguintes ficaram em cerca de `17–18 s`. Baileys → WWebJS transportou cerca de
`1285` registros/`231 KB`, mas permaneceu em aproximadamente `50–53 s` porque o
destino navegador atravessa as fases reais `transforming`, `activating`, ABI,
restauração do perfil, confirmação da sessão e promoção forte. Em todas as
execuções houve progresso de fase e conclusão; não confundir essa janela
estável com o caso de runtime preso.

O comando `playwright-cli run-code` usado pelo harness encerra uma espera longa
por volta de 28 segundos, embora o navegador visível e a operação continuem.
Para não gerar falso negativo, as rodadas longas foram divididas em: clique e
validação visual de origem/destino pelo Playwright, acompanhamento durável do
handoff até `completed` e confirmação posterior da tela conectada. Esse limite
é do controlador de testes, não do modal ou do lifecycle do produto.

### WhatsMeow → WWebJS — falsa espera na recuperação do realm

O primeiro canário da direção WhatsMeow → WWebJS, handoff
`755ef92a-235d-4ac1-837b-8527c317dc79`, expôs um atraso específico. A origem
foi drenada com `2926` registros/`302373` bytes e a sessão permaneceu protegida,
sem QR e sem descarte. O destino chegou ao ponto de não retorno, mas a primeira
tentativa de hidratação aguardou aproximadamente 60 segundos no estágio
`transport_proof`, reiniciou internamente e só então concluiu. O resultado
durável foi `completed`, `attempt_count=0`, em `286,796 s`; portanto a
recuperação evitou perda, mas a latência não é aceitável para a bateria.

Os logs provaram que o reload de recuperação já havia emitido socket
`OPENING → PAIRING → CONNECTED` e stream `CONNECTED` em cerca de dois segundos.
O gate antigo, porém, exigia também `WAWebUserPrefsMeUser`. Essa estrutura é uma
projeção de preferências/UI e pode materializar depois do transporte nativo em
uma sessão vinda do WhatsMeow. Por isso o gate ficou falso até o timeout, mesmo
com o canal criptograficamente conectado. Na segunda inicialização a projeção
já estava disponível, mascarando o problema e acrescentando outra hidratação
completa.

No fork WWebJS, a recuperação de realm passa a provar o transporte por quatro
condições simultâneas: registro multidispositivo válido, socket model
`CONNECTED`, `WAComms.isCommsInitialized()=true` e
`WAComms.isSocketConnected()=true`. As guardas já existentes continuam
obrigatórias: proteção de credenciais, ausência de violação destrutiva,
watchdog sem pareamento novo, mudança de epoch e única recuperação por ciclo.
`MeUser` continua coletado como diagnóstico, mas deixa de ser usado como prova
de rede. O mesmo critério foi aplicado à recuperação de realm do restore para
evitar a falsa espera equivalente sem alterar os gates normais de conexão.

O contrato foi alterado para simular explicitamente `MeUser` ainda ausente com
`WAComms` já autenticado e conectado. A suíte focada passou `5/5`; as suítes de
sessão e autenticação passaram `468/468` (`1` integração live pendente por
configuração). O `npm test` global continua exigindo
`WWEBJS_TEST_REMOTE_ID`; a ausência dessa credencial local é pré-condição do
teste live, não falha da alteração. A correção está no commit do fork
`cc0dbec0` e foi publicada como `@wwebjs/whatsapp-web.js@1.34.119`; a Underchat
fixou essa versão no commit `bf2152478`, com `174/174` contratos WWebJS e build
TypeScript do `worker_wwebjs` aprovados. Reiniciar a contagem oficial
WhatsMeow ↔ WWebJS após publicar e instalar essa versão e repetir também os
canários Baileys ↔ WWebJS, pois ambos compartilham a recuperação de realm.

### WhatsMeow → WWebJS — janela offline por logout transitório de bootstrap

Na terceira alternância após o rollout `1.34.119`, o handoff
`5b843870-dd43-4077-aba8-38952a5f45ee` terminou `completed`, sem QR, sem
rollback e com `attempt_count=0`, mas levou `60,070 s` e apresentou uma janela
offline visível. A primeira inicialização da geração 20 foi interrompida às
`01:09:28.866Z`; a recuperação interna iniciou outro Chromium e publicou
`online/ready` às `01:09:55.652Z`. A sessão canônica e a revisão promovida
permaneceram preservadas durante todo o intervalo.

A causa exata foi uma corrida posterior à promoção. A proteção de credenciais
foi liberada para a fase `live` enquanto o socket ainda estava em `OPENING`.
Em aproximadamente `0,8 s`, o runtime registrado passou por
`PAIRING → CONNECTED`, mas executou um único `WAWebSocketLogoutJob.socketLogout`
sem motivo reconhecido, pertencente ao bootstrap anterior. Como a fase já era
`live`, o guard classificou o evento como
`wwebjs_canonical_credential_violation_detected`, colocou o navegador offline
e abortou antes que uma limpeza destrutiva pudesse ocorrer. O comportamento
fail-closed evitou perda, mas criou a indisponibilidade e uma segunda
inicialização desnecessária.

O fork `@wwebjs/whatsapp-web.js@1.34.120`, commit `16e60afc`, adiciona uma
exceção estritamente delimitada para essa corrida: somente o primeiro
`socket_logout_job` com motivo `unknown`, somente nos primeiros `5 s` após a
liberação do transporte canônico e somente com o guard autenticado ainda
armado é suprimido. Uma segunda ocorrência, qualquer motivo conhecido,
qualquer outra operação destrutiva, pairing detectado ou evento fora da janela
continua acionando a proteção fail-closed normal. A telemetria expõe
`canonicalSocketLogoutBootstrapGraceActive` e
`canonicalSocketLogoutBootstrapSuppressionCount`; o evento suprimido também
permanece visível como `socket_logout_job_suppressed`.

O novo contrato simula a ocorrência sem motivo e prova que ela não executa o
logout nem marca violação; em seguida envia `unknown_companion` na mesma janela
e prova que a chamada real é executada e a violação é retida. As suítes de
sessão/autenticação passaram `468/468`, com uma integração live pendente por
configuração; lint, Prettier, web-cache e inspeção do pacote também passaram.
A Underchat fixa `1.34.120` e valida no contrato de dependência tanto a versão
quanto a janela/budget de supressão. Reiniciar do zero a contagem oficial
WhatsMeow ↔ WWebJS e repetir Baileys ↔ WWebJS após o rollout da imagem, sem
contabilizar a terceira alternância que revelou a corrida.

## Sessão legada → PostgreSQL — correção do agendamento e do boundary protobuf (15/08/2026)

Esta rodada começou com a leitura integral desta memória antes de qualquer
mutação. O primeiro histórico real do fluxo administrativo, migração
`2998cf3d-a003-455c-a28d-0640e33d87ed` do canal `Wwebjs Legacy`, havia
terminado em `restored` depois de três timeouts sem checkpoint. A causa não
estava no Chromium nem no fork: `beginAttempt()` gravava simultaneamente o
watchdog `attempt_deadline_at=now+5min` e o agendamento
`next_attempt_at=now+5min`. Como o claim só aceita `next_attempt_at <= now`, a
fase `capturing` só podia ser adquirida depois que o próprio prazo já havia
expirado. Nenhum RPC chegou ao worker.

O orquestrador agora agenda toda nova fase capturável em `now`; o deadline de
cinco minutos permanece como watchdog independente. A restauração segura não
apaga mais `last_error_code`, preservando a causa terminal para operação e
telemetria. Contratos comportamentais provam tanto o claim imediato com
deadline separado quanto a retenção do erro depois de `restored`.

O primeiro canário após essa correção, migração
`233365e3-7300-4e66-a0df-f8c9b09db492`, avançou imediatamente até o Balance,
mas foi rejeitado pelo WWebJS com
`prepare_session_storage_migration_required_fields_invalid`. As três
tentativas rápidas continuaram fail-closed e a origem foi restaurada online,
sem descarte ou mudança de storage. O código causal permaneceu registrado,
confirmando também a correção de observabilidade.

A incompatibilidade era uma fronteira de nomes entre os dois protobufs. O
`worker_command.proto` mantém por compatibilidade os campos históricos
`legacy_volume_name` e `identity_hash_sha256`; o domínio e o
`worker_connection.proto` usam `source_volume_name` e `identity_hash`. O
objeto canônico era enviado diretamente ao `proto-loader`, que descartava
silenciosamente os dois campos desconhecidos. Foram adicionados adaptadores
explícitos e bidirecionais no boundary Balance: origem canônica ↔
`legacy_volume_name` e prova de identidade canônica ↔
`identity_hash_sha256`. Não se renumerou nem se renomeou o wire protobuf,
preservando compatibilidade de transporte.

Gates locais desta correção:

- Jest focado: `25/25` testes, incluindo os mapeamentos de request/response,
  servidor/client gRPC e o orquestrador;
- `pnpm run test:typecheck` aprovado;
- ESLint sem erros; os imports residuais encontrados foram removidos;
- `git diff --check` aprovado.

O build isolado Balance `v20260815042707831` foi iniciado antes do commit e
cancelado explicitamente; ele **não deve ser instalado nem usado como
evidência**. Regra operacional obrigatória a partir desta rodada: toda
correção deve seguir `testes → documentação → commit → push → build`. O sistema
de build consome o Git, não alterações locais do working tree. Nunca gerar uma
versão antes de o commit correspondente estar publicado no remoto.

### Canário após o boundary protobuf — journal lifecycle obrigatório

O Balance corrigido foi construído somente depois do commit/push anterior:
versão `v20260815043252985`, digest
`sha256:ea6fe73e7fbd36780a1306b81edd37ac893020a814d5cf8b9ca54084bdceca82`.
O pull direto nos hosts não possuía credencial Harbor; a imagem autenticada foi
transportada pela máquina de build, o digest foi comparado nos dois servidores
e o rollout sequencial preservou um container de rollback por host. Ambos os
Balances responderam HTTP 200, restart zero e todos os sete canais continuaram
online/ACK antes do novo canário.

A migração WWebJS volume → PostgreSQL seguinte capturou corretamente o perfil:
checkpoint de `195037950` bytes e `1053` registros, geração-alvo 10. O cutover
foi então rejeitado com
`missing_lifecycle_semantic_fingerprint_for_fenced_worker_command`. A origem
foi restaurada no volume e permaneceu online. Isso provou que a correção do
protobuf estava efetiva e revelou uma segunda fronteira independente: o
orquestrador chamava `RecreateWorker` diretamente depois do claim de banco,
sem persistir a identidade imutável no journal Redis exigido pelo Balance.

Todo lifecycle da migração agora constrói o mesmo
`IWorkerLifecycleQueueMessage` canônico usado pelos demais recreate, incluindo
storage de origem/destino e flags destrutivas falsas. O journal é persistido
**antes** do claim transacional; o fingerprint é calculado pela função única
`workerLifecycleSemanticFingerprint()` e enviado no payload gRPC. Cutover,
redrive do cutover, detach final do volume e restauração usam o mesmo helper,
evitando uma exceção não cercada ou formatos concorrentes. Um contrato prova a
ordem `journal.prepare < beginLifecycle`, os campos semânticos e a igualdade
do fingerprint entregue ao Balance.

Gates desta correção: ESLint aprovado, Jest focado `46/46` e typecheck global
aprovado. Repetir o canário somente depois do novo commit/push; esta alteração
é do orquestrador local e não exige republicar os workers nem substituir o
Balance `v20260815043252985`.

### Restauração legada terminal — estado, ACK e journal na mesma transação

O canário `772a33df-c151-491e-aa41-7c1b098e2748` também revelou um resíduo
independente depois do rollback seguro. O volume WWebJS foi remontado na
geração 9, e a saúde nativa comprovava `online`, `connected`, `authenticated`,
`sessionValid`, envio e recepção. Entretanto, o banco continuou com o worker
em `recreating`, `lifecycle_operation_id` preenchido e
`native_connection_online_acknowledged=false`. Portanto, os bytes e o runtime
haviam sido restaurados, mas o estado administrativo não atingira o mesmo
terminal. Sobrepor um novo teste nesse estado é proibido: antes de qualquer
novo canário, a restauração precisa terminar ou falhar integralmente.

A causa era a separação de responsabilidades em duas transações. A função
`invalidate_legacy_volume_migration_revision()` invalidava somente a revisão
PostgreSQL candidata; depois, o orquestrador alterava o journal para
`restored`. Nenhuma dessas operações restaurava status/ACK/lifecycle e um
crash entre elas também podia deixar o journal e o control plane divergentes.

A migração Atlas `20260815045500.sql` amplia o fence da função: além do
`migration_id`/worker em `restoring`, exige volume, provider, geração,
lifecycle e as projeções nativa e pública completas do mesmo runtime
(`online`, conectado, autenticado, sessão válida e sem QR). Sob locks da
migração, worker e runtime, ela invalida somente a candidata exata, coloca o
worker em `online`, remove o lifecycle e reconhece o fato nativo já provado.
Qualquer ausência ou cardinalidade diferente de uma linha gera exceção e
rollback total.

O repositório agora cerca essa função com o `claim_token` vigente e conclui o
journal em `restored`, limpa claim/agendamento e grava `restored_at` dentro da
**mesma transação**. O orquestrador publica o resumo somente a partir da linha
terminal retornada; `last_error_code` continua preservado. Assim, não existe
mais janela entre invalidar a candidata, restaurar ACK/lifecycle e concluir o
journal. O contrato comportamental prova que a transição genérica separada não
é chamada, e o contrato SQL/repositório prova locks, saúde completa, claim e
terminal atômico.

Gates locais desta etapa: a nova função foi compilada em uma transação
`BEGIN/ROLLBACK`; Jest focado `9/9`, ESLint, `git diff --check` e typecheck
global foram aprovados. Ainda é obrigatório aplicar a migration, publicar o
commit e executar uma reparação única e totalmente cercada para o histórico
`772a33df-c151-491e-aa41-7c1b098e2748` antes de repetir volume → PostgreSQL.

### Processo-fonte retido depois do prepare — replacement generation obrigatório

O commit `69cfc9b6e` foi publicado antes do build exclusivo do Balance
`v20260815050451572` (job `01a003ce-fb74-7509-b2fb-1abd751a1760`, digest
`sha256:c8862ab21eb513ff79e62f076c33846b654115d1b61ca30a1dbe67cb9939d903`).
Um build selecionado incorretamente pela interface,
`v20260815050305442`, foi cancelado durante WWebJS e não publicou imagem. A
versão correta foi carregada nos dois servidores e instalada sequencialmente,
mantendo rollback explícito; ambos ficaram `healthy`, restart zero, HTTP 200 e
todos os sete canais permaneceram online/ACK.

Durante a primeira carga no Server 1, o containerd atingiu 100% de disco. Não
foi usado prune amplo: foram removidas somente nove referências antigas sem
qualquer container, preservando imagens atuais, rollbacks e os cinco warms
antigos ainda ativos. O uso caiu para 72% antes de repetir e validar a carga
pelo digest. A primeira tentativa de rollout consultou por engano `/`, recebeu
404 e acionou o rollback automático; o endpoint correto é
`/v1/health/check`. A repetição promoveu o candidato somente depois de Docker
health e HTTP 200.

A reparação única do histórico `772a33df-...` exigiu exatamente migration,
worker, geração 9, volume, provider, lifecycle, estado `restored` e fato nativo
online. Uma transação com cardinalidade 1/1 removeu o lifecycle e reconheceu o
runtime; banco e UI confirmaram `Wwebjs Legacy` conectado. Não repetir essa
mutação sem as mesmas cercas.

O canário seguinte, `62eef9a4-519a-4553-ac21-62a0c08e3d30`, falhou nas três
capturas com `wwebjs_session_storage_migration_already_owned`. A nova
restauração atômica funcionou: terminou `restored`, preservou o erro causal e
deixou worker online, lifecycle nulo, storage legado, geração 9 e ACK verdadeiro.
A causa era estado de processo, não perda de sessão: WWebJS, Baileys e
WhatsMeow retêm `migration_id`/resultado depois do prepare para tornar retries
do mesmo ID idempotentes. O rollback rápido reutilizava a mesma geração-fonte;
por isso um ID durável posterior era recusado indefinidamente.

A correção é comum aos três providers e não relaxa ownership. Uma restauração
em `legacy_volume` somente pode finalizar diretamente se o runtime saudável
for de uma geração **posterior** à `source_runtime_generation`. Se ainda for a
mesma geração, o orquestrador recria uma única vez o volume preservado, com
journal/fingerprint e flags destrutivas falsas; na passagem seguinte, valida a
nova geração e executa o terminal atômico. Assim, retries do mesmo ID continuam
idempotentes, um ID concorrente continua proibido e um processo que participou
do prepare nunca é reutilizado como origem de outra migração.

Contrato adicional prova que a mesma geração não chama o finalizador, prepara
o lifecycle `legacy_volume → legacy_volume`, incrementa a geração e invoca o
recreate; o contrato terminal agora usa a geração substituta. Gates: Jest
focado `10/10`, ESLint, typecheck global e `git diff --check` aprovados. Depois
do commit/push deste lote, gerar novo Balance e recriar uma vez o canal legado
histórico antes do próximo canário.

### Journal protegido volume ↔ PostgreSQL — identidade semântica completa

O commit `1464a84bc` foi publicado antes do build exclusivo do Balance
`v20260815052536910` (job `01a003e1-fc0e-742e-a01a-57f8f2f038f5`, digest
`sha256:ee7521ba578cd13a9ed24986bf82ec1553d847d52c3d31f1dab30f680f294d9e`).
Ele foi carregado e promovido sequencialmente nos dois servidores, mantendo os
rollbacks explícitos. Ambos os containers ficaram `healthy`, restart zero e
`/v1/health/check` respondeu 200. Uma recriação normal do `Wwebjs Legacy`
substituiu a geração 9 pela 10, preservou o volume, retornou online/ACK sem QR
em aproximadamente 20 segundos e confirmou que o fluxo principal de recreate
continuava íntegro.

O canário volume → PostgreSQL seguinte,
`95d95630-611e-48b2-bbae-f633b7443829`, capturou corretamente `126958458`
bytes, mas as três tentativas de cutover foram recusadas com
`worker_lifecycle_journal_invalid:payload_semantics_invalid`. A restauração na
mesma geração também era recusada e permaneceu em `restoring`; o volume, a
sessão e o ACK online continuaram preservados. A causa era uma lacuna no
contrato do journal: `previous_session_storage` só era autorizado no fluxo
histórico **destrutivo** legado → PostgreSQL (`remove_session=true` e
`remove_volume=true`). O fluxo administrativo novo é deliberadamente
protegido (`false/false`) para permitir rollback e, portanto, não podia usar
essa exceção.

O journal passa a distinguir três semânticas sem ampliar permissões:

- recriação no mesmo backend omite `previous_session_storage` e segue o
  contrato normal, inclusive a replacement generation do rollback;
- conversão destrutiva legada → PostgreSQL mantém exatamente o contrato
  anterior e sua limpeza pareada;
- migração protegida aceita somente `legacy_volume ↔ postgres`, ação
  `recreate`, origem `worker_update`, mesmo provider nas duas pontas, flags
  destrutivas falsas e identidade completa formada por UUID da migração, nome
  válido do volume e checksum SHA-256.

Os três campos da identidade protegida agora pertencem ao payload durável, ao
fingerprint semântico, à linhagem e à comparação CAS do Lua/Redis. O consumidor
repete a mesma validação antes do dispatch e encaminha os campos ao Balance;
assim, um redrive não pode trocar ID, volume, checksum, backend ou provider. A
restauração PostgreSQL → volume usa a mesma identidade; metadados parciais,
provider diferente, flag destrutiva ou transição fora das duas direções são
fail-closed. Os fingerprints de comandos antigos continuam idênticos quando
os novos campos são omitidos.

Gates locais deste lote: Jest focado `123/123` cobrindo journal, redrive nas
duas direções, recusas negativas, parser/dispatch boundary, fingerprint e
orquestrador; typecheck global, ESLint dos arquivos tocados e
`git diff --check` aprovados. Depois do commit/push e do rollout, o canário
`95d95630-...` deve ser recuperado automaticamente por uma replacement
generation e terminar `restored` antes de qualquer nova tentativa funcional.

### Terminal após lifecycle concluído — prova de operation ID + geração

O commit `56bf731c9` foi publicado antes do build exclusivo do Balance
`v20260815054758974` (job `01a003f6-767e-731d-af2b-6b4b91c2026c`, digest
`sha256:ade8f17422f651912aed50e3484a6523e7568b54ad9346bd47f9cd558d6b8d8a`).
O Server 1 foi promovido com rollback explícito, ficou `healthy`, restart zero
e HTTP 200. O reconciliador recuperou o canário `95d95630-...`: recriou o
volume preservado na geração 11, comprovou WWebJS online, ACK verdadeiro e
lifecycle nulo. O journal, porém, permaneceu em `restoring` com erro da função
`invalidate_legacy_volume_migration_revision()`.

Uma reprodução em `BEGIN/ROLLBACK` revelou
`legacy volume restoration fence is invalid`. O fence anterior aceitava apenas
`worker.lifecycle_operation_id IS NOT DISTINCT FROM
migration.lifecycle_operation_id`. Isso é correto durante a execução, mas uma
recriação terminal saudável limpa esse campo e grava a prova durável nos
campos `recreate_completed_operation_id` e
`recreate_completed_runtime_generation`. Portanto, a própria conclusão normal
do lifecycle tornava impossível concluir a restauração.

A migration Atlas `20260815060500.sql` mantém a prova ativa e adiciona uma
única alternativa terminal: lifecycle nulo, operation ID concluído idêntico ao
da migração e geração concluída idêntica ao runtime legado saudável que está
bloqueado na mesma transação. A geração capturada também cerca os updates de
worker e runtime. Operation ID divergente, geração divergente, lifecycle ainda
ocupado por outra operação ou qualquer prova de saúde incompleta continuam
fail-closed. A sessão permaneceu online no volume durante toda a análise; não
houve alteração manual do journal.

A função nova foi compilada e executada contra o canário real dentro de
`BEGIN/ROLLBACK`: retornou exatamente uma invalidação e todo o efeito foi
revertido pelo teste. Jest focado aprovou `11/11`, ESLint e
`git diff --check` passaram, e o checksum Atlas foi regenerado. A migration
somente deve ser aplicada de forma permanente depois de seu commit/push; o
reconciliador então deve concluir o mesmo journal automaticamente, sem update
manual de estado.

### Cutover protegido volume → PostgreSQL — aposentadoria da identidade-fonte

O commit `501e42d1f` foi publicado, a migration Atlas `20260815060500.sql` foi
aplicada e o Balance `v20260815054758974` permaneceu promovido nos dois
servidores, ambos `healthy`, restart zero e HTTP 200. Sem qualquer alteração
manual no journal, o reconciliador concluiu o histórico `95d95630-...` como
`restored`: WWebJS voltou no volume na geração 11, online, autenticado, sessão
válida, ACK verdadeiro e lifecycle nulo. Isso confirma a alternativa terminal
por `recreate_completed_operation_id` + geração.

O primeiro canário novo iniciado pela interface visual,
`4ef14cdb-c482-4649-ba23-91ca5991432d`, capturou os 778 registros do volume
WWebJS (`158248092` bytes) e preservou o volume. As três tentativas de cutover
falharam antes de criar o destino com
`worker_runtime_removal_database_fence_changed`; o rollback automático
substituiu a geração 11 pela 12 e terminou `restored`, online/ACK e sem QR. A
tentativa não conta como funcional, mas provou novamente que o caminho de
falha é não destrutivo.

A causa era outra fronteira do mesmo estado transitório. O worker já havia
sido promovido semanticamente para `postgres`, enquanto a linha de runtime e
o container que precisavam ser aposentados ainda descreviam corretamente a
origem `legacy_volume`. O resolvedor de volume conhecia esse estado, mas o
fence de remoção só permitia a divergência para a conversão histórica
destrutiva (`remove_session/remove_volume=true`), nunca para a migração
administrativa protegida (`false/false`). Por isso, a operação parava antes da
remoção do container-fonte e mantinha o volume intacto.

A correção autoriza somente a aposentadoria desta identidade-fonte exata:
ação `recreate`, metadados completos (UUID, volume e checksum), transição
`legacy_volume → postgres`, mesmo worker/account/server/provider nas duas
pontas, worker já em PostgreSQL, runtime ainda legado no volume nomeado e
provider nativo correspondente. Essa autorização relaxa apenas as duas
comparações temporárias de backend no fence de banco e na reparação de ponteiro;
container, lifecycle, geração, mount e volume continuam exatos. O container é
removido, mas o volume nunca é apagado. Volume divergente continua fail-closed.

O mesmo contrato cobre Baileys, WWebJS e WhatsMeow para impedir correções
específicas que quebrem outro provider. Também foi corrigida uma regressão
latente do resolvedor: a conversão destrutiva antiga não possui metadados do
novo journal e deve aceitar qualquer volume legado não vazio já cercado pelo
seu contrato destrutivo; somente a migração protegida exige igualdade com
`legacy_session_volume_name`. Os testes focados aprovam a conversão histórica,
as três variantes protegidas com preservação do volume e a recusa por volume
divergente. Gates deste lote: suíte integral do handler `528/528`, contratos
de orquestrador/protobuf/journal `54/54`, typecheck global, ESLint, Prettier e
`git diff --check`. Como em todos os lotes desta rodada, commit e push devem
ocorrer antes de qualquer build.

### Metadados do destino PostgreSQL — allowlist interna de ambiente

O lote anterior foi publicado no commit `c5be403bc`. Somente depois do push
foi gerado o Balance `v20260815061626580` (job
`01a00410-84d4-720a-91d3-a2e9a128a970`, digest
`sha256:1097c5765e5bfddb38da560c869f9481b6b6074cd34db86d05c8e8b2c4c1741e`).
Ele foi promovido sequencialmente no Server 1 e no Server 2, com rollback
explícito da versão anterior; ambos ficaram `healthy`, restart zero e HTTP 200. Os sete canais permaneceram online, com ACK verdadeiro, lifecycle nulo e
sem QR.

O canário visual seguinte, `628ad38d-ecb7-42f5-938e-3427bf4e726d`, avançou
além do fence corrigido: aposentou o container-fonte legado, preservou o
volume, reservou a geração PostgreSQL 13 e capturou 789 registros
(`159661617` bytes). A criação do destino então falhou com
`worker_container_env_override_not_allowed:SESSION_STORAGE_MIGRATION_ID`.
Depois de três tentativas, a restauração protegida voltou ao volume numa nova
geração 14, online/ACK, autenticada, sessão válida, lifecycle nulo e sem QR.
Esse canário também não conta como funcional.

A causa é uma inconsistência na política do próprio Balance. Os três campos
de migração já eram validados em conjunto (UUID, nome seguro do volume e
checksum SHA-256), registrados como labels inspecionáveis e consumidos pelos
três workers; contudo, não pertenciam à allowlist de overrides usada na última
montagem do `Env`. Portanto, a mesma função que criava esses valores confiáveis
os recusava antes de chamar o Docker.

`SESSION_STORAGE_MIGRATION_ID`, `LEGACY_SESSION_VOLUME_NAME` e
`LEGACY_SESSION_CHECKSUM_SHA256` passam a ser overrides internos explícitos.
Eles continuam proibidos como herança do ambiente do Balance, e nenhum prefixo
ou variável arbitrária foi liberado. O caminho de criação continua exigindo os
três valores válidos e só então monta o volume legado em
`/app/legacy-session:ro,nocopy`; o destino PostgreSQL não recebe `/app/data`.
Contratos novos exercitam a allowlist positiva, recusam uma chave semelhante
não autorizada e verificam Env, labels e mount somente-leitura do container
real que será iniciado. Gates deste lote: contratos de criação/política de
ambiente `45/45`, typecheck global, ESLint, Prettier e `git diff --check`.
Publicar outro build somente após commit e push.

### WWebJS volume → PostgreSQL — abertura nativa da revisão de migração

O lote da allowlist foi publicado no commit Underchat `fd4f46857` antes do
build. O Balance `v20260815063034254` (job
`01a0041d-740e-7518-8a6e-2051cc15c3ac`, digest
`sha256:4f35b1b9a8ab195636b9a0d040ec1a486eaa5f2082ceaf4301f508f645149322`)
foi promovido sequencialmente nos dois servidores; ambos ficaram `healthy`,
restart zero e HTTP 200, com a versão anterior preservada para rollback.

O canário visual seguinte, `22039db0-033d-4b2f-9305-8426dc7146c5`, capturou
795 registros e `158151952` bytes do volume WWebJS. A origem foi aposentada
sem excluir o volume e o destino PostgreSQL geração 15 foi criado saudável.
O runtime, porém, abriu a revisão 3235 como `staging/pairing`; o bootstrap
recusou corretamente esse estado com `legacy_session_migration_revision_not_stageable`
e nunca publicou QR. Após três tentativas, o journal entrou em restauração com
o volume ainda preservado. Essa tentativa não conta como funcional.

A análise do pacote instalado provou a incompatibilidade: a Underchat enviava
somente `storageMigrationId`, enquanto o fork `1.34.121` chamava
`open_whatsapp_session_revision(..., 'pairing', ...)` de forma literal. Além
disso, a primeira implementação do fork incluía `legacy_volume_migration` em
`isHandoffRevision()`. Isso confundia uma migração de armazenamento do mesmo
provider com handoff entre providers, exigiria uma linha
`whatsapp_session_handoff` inexistente, armaria o gate de projeção canônica
errado e tentaria o CAS de ativação de provider em vez da promoção dedicada.

O fork WWebJS `1.34.122`, commit publicado `8b54d662`, corrige as duas
fronteiras:

- `revisionSource` aceita somente `pairing` ou `legacy_volume_migration` na
  abertura inicial;
- a origem legada e o UUID `storageMigrationId` são obrigatórios em conjunto;
- o UUID é instalado com `set_config(..., true)` na mesma transação, antes da
  abertura, e a origem real é passada como parâmetro ao procedimento;
- a revisão legada é restaurável e não pode apresentar QR, mas não é tratada
  como handoff entre providers;
- a promoção usa exclusivamente
  `promote_legacy_volume_migration_revision`, mantendo o caminho PostgreSQL
  comum em `pairing` e sem migration scope.

O pacote privado foi publicado e lido novamente como
`@wwebjs/whatsapp-web.js@1.34.122`, shasum
`099175e0c91fc1482b4799add0214f69aa25b2c4` e integrity
`sha512-sNcImW5nj9zpieaHwEjhJsyNBXM/G9L8XTxkJ2P1VtlyiBteGKGW0ayI2rucHiLZCjbv5uOU8WdH9U538+b9UA==`.
O fork aprovou 90/90 contratos do store, 111/111 de `RemoteAuth`, lint,
Prettier e verificação dos 158 arquivos do pacote. O `npm test` global continua
dependente de `WWEBJS_TEST_REMOTE_ID`; sua ausência bloqueia somente a suíte
live e não representa falha do patch.

A Underchat fixa o tarball `1.34.122` e passa
`revisionSource=legacy_volume_migration` somente quando
`SESSION_STORAGE_MIGRATION_ID` existe. O contrato do adapter aprova 46/46 e
prova também que startup PostgreSQL comum não recebe origem nem UUID de
migração; typecheck, lint, Prettier, `git diff --check` e o build TypeScript do
`worker_wwebjs` passaram. Ainda é obrigatório publicar o commit Underchat antes
do próximo build e corrigir separadamente o fence observado durante a
restauração deste canário; não alterar manualmente o journal nem contar a
tentativa como sucesso.

### Restauração protegida PostgreSQL → volume — aposentadoria simétrica do destino falho

A integração do fork `1.34.122` foi publicada no commit Underchat `d3d572499`
antes desta correção. Durante a restauração automática do canário
`22039db0-033d-4b2f-9305-8426dc7146c5`, o orquestrador já havia restaurado a
identidade semântica do worker para `legacy_volume`, mas o runtime imutável
ainda descrevia corretamente o destino PostgreSQL geração 15 que precisava ser
retirado. O primeiro container de controle legado da restauração já estava
ausente. Nessa janela, `reconcileRuntimePointer()` recusava reparar o ponteiro
temporariamente para o runtime PostgreSQL e repetia
`worker_runtime_removal_database_fence_changed`; por isso o journal permanecia
em `restoring` mesmo com o volume preservado.

Esse é o caso simétrico da aposentadoria da origem legada durante o cutover. A
correção adiciona uma autorização dedicada, sem ampliar o recreate comum:

- a ação deve ser `recreate`, na transição exata `postgres → legacy_volume`;
- UUID da migração, volume legado, checksum SHA-256 e flags não destrutivas
  precisam permanecer completos;
- worker, account, server, tipo e provider devem ser idênticos;
- o worker já deve declarar `legacy_volume`, enquanto o runtime a retirar deve
  declarar `postgres`, volume nulo e provider nativo correspondente;
- a identidade esperada deve ser exatamente PostgreSQL, e o fence existente
  ainda exige lifecycle, status, container, geração, capability hash, writer
  epoch, labels, env e ausência de mount em `/app/data`.

Somente as duas comparações transitórias de backend e a reparação do ponteiro
são autorizadas por essa prova. O runtime PostgreSQL é parado de forma graciosa,
revalidado e removido; o volume legado nunca é apagado. Comando sem checksum ou
qualquer identidade divergente continua fail-closed. O contrato executa a
restauração completa para Baileys, WWebJS e WhatsMeow, além do caso negativo sem
checksum. Gates deste lote: suíte integral do handler `532/532`, typecheck
global, ESLint dos arquivos alterados, Prettier e `git diff --check`. O próximo
build continua proibido até o commit e o push desta correção.

O lote foi publicado no commit Underchat `0ca78e64c`, sempre antes do build.
O job visual `01a0043a-ac48-7325-97a4-fdf0aafc6e99` gerou a versão
`v20260815070229192` para WWebJS e Balance. As imagens publicadas são:

- WWebJS: digest
  `sha256:fce482e78a23ce1fc463981f268a4c2179e3aea870a4bf7f30b8f43b4685ffe0`;
- Balance: digest
  `sha256:68a7a928352ee73476d70edfb7f3762d84464c5cbff12952eeb49212a361c016`.

As duas imagens foram carregadas nos dois servidores. O Server 2 ficou sem
espaço ao desempacotar o Balance; nenhum prune amplo foi executado. Foram
removidas somente nove tags antigas sem qualquer container associado, todos os
containers de rollback foram preservados, e o espaço livre passou de zero para
14 GB antes da recarga. O Balance foi promovido sequencialmente, mantendo em
cada servidor a versão anterior no container
`under-balance-api-rollback-v20260815070229192`. Ambos ficaram `healthy`, HTTP
200 e restart zero.

Sem modificar manualmente worker, runtime ou journal, o reconciliador então
retirou o destino PostgreSQL falho, recriou o WWebJS no volume preservado e
concluiu `22039db0-033d-4b2f-9305-8426dc7146c5` como `restored`. A prova final
é: worker `online`, `legacy_volume`, lifecycle nulo, operação concluída
`01a00449-557d-760a-9ccd-9a1595c8cb0b`, geração 16; runtime nativo `online`,
autenticado, sessão válida, ACK verdadeiro, QR falso; container na imagem nova,
`healthy`, restart zero e o volume exato montado em `/app/data`.

A revisão 3235 aberta incorretamente pelo pacote antigo continua
`staging/pairing` e é o `active_revision_id` da sessão sem material promovido.
Ela não deve ser alterada manualmente: a função de abertura existente reutiliza
a revisão ativa, e o wrapper da migração muda sua origem para
`legacy_volume_migration` dentro da mesma transação cercada. O próximo canário
deve comprovar essa reutilização e promoção; se não o fizer, a tentativa não
conta como funcional e exige correção automática, nunca update manual.

### WWebJS volume → PostgreSQL — dupla atualização da revisão reutilizada

O canário visual seguinte,
`e1e1b125-df61-4f1a-afcb-41030cc56ef5`, capturou 379 registros e
`106066835` bytes, preservou o volume e criou o destino PostgreSQL geração 17
na imagem WWebJS nova. As variáveis e labels efetivas comprovaram UUID, volume,
checksum e `WORKER_SESSION_STORAGE=postgres` corretos. A abertura também
reutilizou a revisão 3235 e atualizou sua geração para 17. Mesmo assim, o
runtime falhou imediatamente com SQLSTATE `27000`: `tuple to be updated was
already modified by an operation triggered by the current command`. O journal
voltou automaticamente a `restored` após três tentativas; esta execução não
conta como funcional.

A origem permanecia `pairing` porque a transação inteira era revertida. A causa
não estava mais no adapter nem no fork: o wrapper
`open_whatsapp_session_revision()` chamava a função interna, que atualiza a
revisão ativa, dentro de `WITH opened AS (...)` e depois tentava alterar a mesma
tupla no CTE `marked`. PostgreSQL proíbe deliberadamente essa dupla atualização
ambígua no mesmo comando.

A migration aditiva `20260815072500.sql` substitui apenas o wrapper e mantém
todos os fences anteriores. A função interna é chamada primeiro com
`SELECT ... INTO`; em um segundo comando PL/pgSQL ordenado, a revisão exata é
marcada como `legacy_volume_migration`. `GET DIAGNOSTICS ROW_COUNT` deve retornar
exatamente um, senão a transação falha fechada. O caminho comum continua aceitando
somente as origens anteriores e não executa a marcação. Nenhuma migration já
aplicada foi editada.

O contrato estático aprova `8/8`, verifica a ordem dos comandos, a ausência dos
CTEs conflitantes, o fence completo do journal/runtime e o `ROW_COUNT = 1`. A
função nova também foi compilada com sucesso no banco real dentro de
`BEGIN/ROLLBACK`; a definição aplicada permaneceu intacta depois do rollback.
Ainda é obrigatório commitar e fazer push da migration, checksum Atlas, contrato
e memória antes de aplicá-la de forma permanente.

O lote foi publicado no commit Underchat `bbbeed2af` e somente depois aplicado
por `pnpm migrate:local`. O Atlas registrou `20260815072500`; a definição
efetiva não contém mais `WITH opened AS` e contém o gate de `ROW_COUNT`. O
WWebJS foi restaurado automaticamente no volume, online e sem QR, antes do
canário seguinte.

### WWebJS volume → PostgreSQL — adoção do fingerprint do perfil legado

O segundo canário depois da correção SQL,
`220f9132-da54-4520-b3f5-218b5548aeb8`, comprovou que a revisão agora abre
corretamente: a revisão 3235 ficou `staging/legacy_volume_migration` no destino
geração 19. A captura tinha 382 registros, `106670426` bytes e checksum
`1d9e1ed674c8d326dae1c0ea83d70a45fa9761e96e6dcc6602c3b0ee3228e2b7`.
O checkpoint, porém, falhou com `whatsapp_artifact_profile_incomplete` e
`path=.wwebjs-profile-fingerprint`. Depois das três tentativas, o journal foi
concluído automaticamente como `restored`, o volume permaneceu preservado e o
canal voltou online na geração 20, container saudável e restart zero. Nenhuma
linha do journal ou da sessão foi alterada manualmente; esta tentativa não
conta como funcional.

A causa é uma diferença legítima entre as duas autoridades de armazenamento.
Perfis PostgreSQL contêm `.wwebjs-profile-fingerprint`, um marcador criptográfico
vinculado ao `session_id + revision_id`. Um perfil LocalAuth criado em volume
legado não possui esse arquivo. O importador tentava executar o checkpoint
diretamente no mount somente leitura e exigia o marcador da nova revisão antes
de ter adotado o perfil. Relaxar a validação global quebraria a proteção de
checkpoint/handoff; escrever no volume também violaria a promessa de rollback.

A correção mantém o volume original somente leitura e cria uma cópia temporária
privada e gravável do perfil após validar o checksum integral. Qualquer
fingerprint anterior é removido somente da cópia. O store nativo cria o novo
fingerprint por seu caminho existente de perfil vazio, mas apenas quando a
revisão é exatamente `staging/legacy_volume_migration` e ainda não possui
artefato. Um segundo snapshot do volume precisa repetir checksum, tamanho e
quantidade de registros antes do primeiro checkpoint, fechando a janela de
mutação entre leitura e cópia. A cópia é eliminada tanto no sucesso quanto no
erro; o volume-fonte nunca é modificado.

Os ramos comuns permanecem fail-closed: `checkpoint`, `pairing`, handoffs entre
providers, revisão já preenchida e origem que mudou durante a cópia são
recusados. Os contratos exercitam isolamento, remoção de fingerprint antigo,
limpeza em sucesso/erro, origem ausente, adoção exclusiva da revisão legada
vazia e recusas fora desse estado. Gates deste lote: helper + adapter `51/51`,
contrato amplo de conexão WWebJS `127/127`, conjunto focado `178/178`, typecheck
global e ESLint. Como sempre, este lote deve ser commitado e enviado ao remoto
antes de qualquer build.

### WWebJS volume → PostgreSQL — estabilização canônica do perfil legado

O canário visual seguinte,
`e28fc45b-5af8-42c1-911c-2d26e5eb269a`, comprovou que a adoção gravável e o
fingerprint já estavam corretos: a revisão 3236 foi importada em
`validating/legacy_volume_migration`, o browser reconheceu o número esperado e
abriu o transporte autenticado. A validação, porém, terminou com
`client.navigation_recovery_failed`, `Waiting failed` e
`wwebjs_canonical_projection_incomplete`. Depois das três tentativas, a
restauração protegida foi concluída sem intervenção manual: migration
`restored` em `2026-08-15 04:57:18.381632-03`, worker e runtime novamente em
`legacy_volume`, geração 22, provider `online`, autenticado, `sessionValid`, ACK
nativo verdadeiro e sem QR. O volume-fonte permaneceu preservado. Esta
tentativa não conta como funcional.

A causa estava no ramo de readiness do fork. Pareamento PostgreSQL novo já
esperava duas projeções canônicas completas e estáveis, com sincronização
oficial limitada para estados transitórios. Recreate ativo e handoff entre
providers também possuíam gates próprios. Somente
`legacy_volume_migration`, embora restaurasse um perfil LocalAuth autenticado,
executava `exportCanonicalProjection()` uma única vez. Assim, um IndexedDB
legítimo ainda em materialização podia ser classificado prematuramente como
perfil incompatível.

A correção do fork cria um bootstrap dedicado e estritamente cercado para a
origem `legacy_volume_migration`:

- exige store PostgreSQL nativo, origem exata e revisão `staging` ou
  `validating`;
- não aguarda o atraso de pareamento, pois o perfil legado já está autenticado;
- reutiliza o gate canônico inicial de duas amostras estáveis e completas e a
  sincronização oficial já limitada aos casos transitórios documentados;
- reutiliza o checkpoint inicial com retry limitado, persistindo projeção,
  identidade e perfil antes de publicar readiness;
- permite promoção direta somente sem `source_revision_id`; a promoção continua
  usando exclusivamente `promote_legacy_volume_migration_revision`, com UUID da
  migração e todos os fences existentes;
- permite registrar o primeiro device comprovado pelo browser somente quando a
  revisão legada está vazia, não existe revisão ativa, não existe fingerprint
  ativo e o UUID de storage migration está presente.

Essa admissão não é aplicada a pairing comum, revisão ativa, secure import,
handoff Baileys/WhatsMeow/WWebJS, recreate ou qualquer revisão já vinculada a
device. Os fluxos existentes continuam fail-closed. O teste novo de
`RemoteAuth` prova gate, identidade, persistência, checkpoint e ordem de eventos;
o teste do store prova a promoção transacional dedicada e a ausência da função
de promoção comum. Gates do fork nesta rodada: `RemoteAuth` `112/112`, store
PostgreSQL `91/91`, browser bridge `195/195`, ESLint global, Prettier global e
`git diff --check`. O fork foi publicado no commit `20bbd2ca` e no pacote
`@wwebjs/whatsapp-web.js@1.34.123`, shasum
`d8ff718dc846212af33de218ace9b9a762f122ae` e integrity
`sha512-t/9Xr9DdbcIJsvUd0x3MGOkO+0LLHKGxeR6xfZo5Hae0I7mvLY0evS9O86ZaC+UWdXhyV7NXBi0i3SgRikJCsQ==`.
O pacote aprovado contém 158 arquivos e um cache web verificado.

A Underchat fixa o tarball `1.34.123` e o contrato da dependência agora protege
tanto a versão quanto a presença do gate legado e da promoção dedicada. Os três
contratos focados do adapter/dependência aprovaram `189/189`; typecheck global,
ESLint do contrato, Prettier dos arquivos-fonte e `git diff --check` também
passaram. A atualização não alterou a resolução do Baileys no lockfile: o churn
incidental do package manager foi removido. O build instalado e o novo canário
funcional ainda devem ser registrados abaixo antes de contabilizar qualquer
ciclo volume → PostgreSQL.

### Redrive protegido volume → PostgreSQL — direção imutável

O pacote WWebJS `1.34.123` foi integrado no commit Underchat `fe1345f8e` antes
do build visual exclusivo. O job `01a0047e-ce02-76a3-9cdf-9321c633cb07`
publicou `v20260815081654274`; a imagem WWebJS possui digest OCI
`sha256:c7b0be2a5c6a8bcdfb3d14c953f5beb3cea882afac2b1c225b09ef79be3b1e16`
e manifest amd64
`sha256:1e4a453b4190f06f9e07992ae01f75b7e7d65f308899188453d3c3ee3997e3e6`.
Ela foi carregada nos dois servidores e definida como padrão. Os quatro warms
WWebJS foram substituídos pelo fluxo normal da interface; todos ficaram
`ready`, saudáveis e na imagem exata.

O canário visual seguinte,
`8402e4f7-6d62-4b8d-9804-72ee7519a5ed`, comprovou a nova estabilização
nativa: abriu a revisão 3237 em `legacy_volume_migration`, criou o fingerprint,
copiou e restaurou o perfil autenticado e iniciou o browser sem QR. A captura
preservou 780 registros, `155267449` bytes e checksum
`dd9edf94ecfbf0b301bfe2711c57ab1f67e708109d8b419befcdc032d9811c3c`.
A tentativa não conta como funcional porque o redrive terminou com
`worker_lifecycle_journal_invalid:payload_semantics_invalid`. A restauração
automática concluiu `restored` em `2026-08-15 05:35:34.867584-03`: volume
preservado, geração 24, WWebJS online, autenticado, sessão válida, ACK
verdadeiro, lifecycle nulo e sem QR.

A rejeição do journal estava correta; o erro era a reconstrução do comando
pelo orquestrador. Depois que a primeira execução alterava a visão viva para
PostgreSQL, uma nova claim de `cutting_over` usava
`runtime_session_storage=postgres` como origem. O mesmo operation ID passava a
descrever `postgres → postgres`, mas ainda carregava UUID, volume e checksum
da migração protegida. Isso não corresponde ao journal imutável inicial
`legacy_volume → postgres` e deve continuar fail-closed.

O redrive agora deriva a origem do contrato imutável desta operação, sempre
`legacy_volume`, e não do runtime parcialmente promovido. Operation ID,
fingerprint, flags não destrutivas e identidade de migração permanecem
idênticos à primeira publicação. A validação do journal não foi relaxada.
O contrato regressivo reproduz a janela com runtime já em PostgreSQL para
Baileys, WWebJS e WhatsMeow e exige a mesma direção protegida nos três casos.
Os gates deste lote aprovaram `57/57` contratos de orquestrador, journal e
protobuf, além do typecheck global, ESLint dos arquivos alterados, Prettier e
`git diff --check`. O commit e o push continuam obrigatórios antes do build do
Balance que instalará esta correção.

O lote foi publicado no commit Underchat `280849891` antes do build. O job
visual `01a00497-d557-723d-984c-347d47fbb4e3` gerou somente o Balance
`v20260815084414551`, sem erro, entre `05:44:14` e `05:49:57 -03`. A imagem
possui digest
`sha256:b7610f1e896e8e7b6a0ae8dfd6d3f92f24b27a502e8961566f395957fda2e7f4`.
Ela foi carregada nos dois servidores e promovida sequencialmente, preservando
o Balance anterior em
`under-balance-api-rollback-v20260815084414551`. Nos dois lados o container
novo ficou `healthy`, restart zero e `/v1/health/check` respondeu 200. A
interface visual pareou a versão como default. Depois do rollout, os sete
canais continuaram `online`, com status nativo online e ACK verdadeiro; isso
inclui os três providers em PostgreSQL e em volume legado.

O canário visual posterior,
`551a585a-3d3c-414c-bc76-215130113792`, capturou 787 registros e
`154870007` bytes do WWebJS legado, preservando o volume-fonte. A primeira
tentativa criou a geração 25, alcançou container saudável, gRPC pronto e
conexão autenticada sem QR, mas ultrapassou a janela de confirmação online de
dois minutos. Ao sair de `retry_wait` e reentrar em `staged`, as tentativas 2 e
3 falharam fechadas com
`worker_lifecycle_journal_invalid:payload_semantics_invalid`. A restauração
automática terminou em `2026-08-15 06:00:00.420459-03`: worker e runtime em
`legacy_volume`, geração 26, provider WWebJS online, autenticado, sessão válida,
ACK verdadeiro, lifecycle nulo e sem QR. Esta tentativa não conta como ciclo
funcional.

Esse caso revelou um segundo ponto de reconstrução, diferente do redrive do
mesmo operation ID corrigido anteriormente. Quando a espera expira, uma nova
tentativa recebe outro operation ID e volta por `cutover()`. Esse método ainda
derivava `previous_session_storage` da visão mutável do runtime, que já podia
estar em PostgreSQL por causa da tentativa anterior. Assim, o novo journal era
montado como `postgres → postgres` apesar de continuar carregando os metadados
protegidos da migração volume → PostgreSQL; a rejeição semântica continuou
correta.

`cutover()` agora também deriva a origem do contrato imutável da migração:
sempre `legacy_volume`, inclusive quando uma nova tentativa parte de `staged`
com runtime parcialmente promovido. O destino permanece `postgres`, cada
tentativa conserva seu novo operation ID, e UUID, volume, checksum, fingerprint
e flags não destrutivas continuam protegidos. Nenhuma validação do journal foi
relaxada. O contrato regressivo reproduz attempt 2 com runtime já em PostgreSQL
para Baileys, WWebJS e WhatsMeow, exige `legacy_volume → postgres` e confirma
que o operation ID é novo. Os gates amplos aprovaram `60/60` contratos, além de
typecheck global, ESLint, Prettier e `git diff --check`. O commit e o push deste
lote continuam obrigatórios antes do próximo build do Balance e de qualquer
novo canário.

A segunda correção foi publicada no commit Underchat `411d6b28c`, com `HEAD`
idêntico a `origin/main`, antes de qualquer build. O job visual exclusivo do
Balance `01a004a9-ef93-7032-8487-03464db923b2` gerou
`v20260815090400915` entre `06:04:00` e `06:09:08 -03`, sem erro. A imagem
possui ID/digest
`sha256:c0550eb03f4efee357122e5f3750e009da06f20ff1b28cdefa359c4a29cf1425`.
A mesma imagem foi carregada nos dois servidores e promovida
sequencialmente; em ambos, o Balance anterior `v20260815084414551` permanece
recuperável como `under-balance-api-rollback-v20260815090400915`, parado e com
restart desabilitado.

Nos dois servidores, o Balance novo ficou `healthy`, restart zero e
`/v1/health/check` respondeu HTTP 200. A interface visual concluiu o pareamento
com sucesso e marcou `v20260815090400915` como Default. Depois das duas
promoções, os sete runtimes ativos continuaram `online`, conectados,
autenticados, ACK verdadeiro e sem QR: Baileys legado, WhatsMeow legado,
WWebJS legado e os quatro canais PostgreSQL. O próximo canário WWebJS
volume → PostgreSQL deve usar este Balance; nenhuma tentativa anterior desta
seção deve ser contabilizada como funcional.

O canário visual seguinte,
`ab6050fc-2ed6-4aad-b891-fb5a7bc1a93f`, confirmou que a correção dos dois
pontos de redrive do Balance funciona. A captura preservou 792 registros e
`156001349` bytes. A tentativa 1 abriu a revisão WWebJS 3239, geração 27,
criou o fingerprint, persistiu o artefato do perfil e avançou a revisão para
`validating`; o browser, porém, terminou com
`wwebjs_canonical_projection_incomplete` antes da confirmação online. As
tentativas 2 e 3 receberam novos operation IDs e gerações 28 e 29, mantendo a
direção protegida sem qualquer `payload_semantics_invalid`. Elas não chegaram
ao browser porque a revisão 3239 já estava em `validating` e o adapter a
classificava como sessão inexistente.

A restauração automática terminou em
`2026-08-15 06:20:47.194352-03`, na geração 30: worker e runtime novamente em
`legacy_volume`, lifecycle nulo, WWebJS online, conectado, autenticado,
`sessionValid`, ACK verdadeiro, sem QR e com o volume-fonte preservado. Esta
tentativa não conta como ciclo funcional.

A causa do novo bloqueio era local ao adapter Underchat. Para sessões nativas,
`PostgresWwebjsSessionStore.sessionExists()` reconhecia somente revisão
`active` ou handoff. Isso é correto para pairing e candidatos comuns, mas não
para um retry da mesma migração volume → PostgreSQL: o checkpoint do perfil e
a transição para `validating` são atômicos, portanto essa combinação representa
um artefato restaurável já persistido. O bootstrap chamava `sessionExists()`,
recebia falso e recusava a revisão como
`legacy_session_migration_revision_not_stageable`, impedindo o retry de usar o
artefato existente.

O adapter agora reconhece como existente somente a combinação exata
`revision_status=validating`,
`revision_source=legacy_volume_migration` e um
`SESSION_STORAGE_MIGRATION_ID` UUID válido. `staging`, pairing, checkpoint,
handoff e execução sem UUID mantêm a semântica anterior. O serviço marca esse
candidato como bootstrap já efetuado, não relê nem recopia o volume, não cria
novo fingerprint e não executa `stageCandidate` novamente; o RemoteAuth pode
restaurar o artefato transacional e repetir exclusivamente a validação nativa.
Os contratos cobrem a matriz positiva/negativa do adapter e o redrive do
serviço sem restaging. Gates: `194/194` contratos WWebJS focados, typecheck
global, ESLint, Prettier e `git diff --check`. Como em todo lote, commit e push
são obrigatórios antes do build WWebJS.

A correção do adapter foi publicada no commit Underchat `a22efcebf`, com
`HEAD` exatamente igual a `origin/main`, antes do build. Pela interface visual,
o job exclusivo do Worker WWebJS
`01a004be-8c06-70b9-b9cc-306db49c996a` gerou a versão
`v20260815092631686` entre `06:26:31` e `06:32:19 -03`, sem erro. O item de
build terminou `success` e a imagem possui ID/digest imutável
`sha256:801abb271ad57d822641356b58ad5cc05522c96e960767cf6572f9a9ec467a47`.
A mesma imagem foi carregada e inspecionada nos dois servidores; o pareamento
visual terminou com sucesso e tornou a versão o default do WWebJS, preservando
a versão anterior para rollback.

Na tela visual de **Canais aquecidos**, o filtro foi restringido exatamente a
`Opção 2 (Navegador)` antes de **Recriar Todos**. Os quatro warms WWebJS foram
substituídos sem tocar os pools de Baileys ou WhatsMeow. Todos terminaram
`ready`, `healthy`, restart zero, pacote `@wwebjs/whatsapp-web.js@1.34.123` e
imagem exata `sha256:801abb...467a47`:

- Server 1: `01a004c6-f458-75b0-88f1-2ece659409ea` e
  `01a004c6-f4a4-764c-b071-847d6a669ec3`;
- Server 2: `01a004c6-f3fa-76d8-a51a-f580101a2dca` e
  `01a004c6-f48d-759e-9eaa-085aed7ef6de`.

O próximo passo obrigatório é repetir o canário visual WWebJS legado →
PostgreSQL. Ele só pode contar se a migração concluir com revisão ativa,
worker/runtime em PostgreSQL, conexão online, autenticada, ACK verdadeiro, sem
QR e volume-fonte preservado. Falhas e restaurações seguras continuam fora da
contagem funcional.

### Reidratação transitória do perfil legado WWebJS

O novo canário visual WWebJS legado → PostgreSQL,
`38850d9a-b8d0-416b-83b3-6cf231f5ec67`, comprovou que o adapter corrigido
retoma uma revisão `validating` sem recapturar o volume. Foram preservados 795
registros, `157099827` bytes e o volume-fonte. A tentativa 1 abriu a geração
31; as tentativas 2 e 3 retomaram a mesma revisão 3240 nas gerações 32 e 33,
restauraram o perfil autenticado, não exibiram QR e alcançaram a validação
nativa. Não houve `payload_semantics_invalid` nem
`legacy_session_migration_revision_not_stageable`.

A migração ainda não contou como funcional: as três tentativas terminaram
fail-closed com `wwebjs_canonical_projection_incomplete`. A restauração
automática concluiu em `2026-08-15 06:44:44.984-03`, na geração 34, com estado
`restored`, worker/runtime novamente em `legacy_volume`, lifecycle nulo,
WWebJS online, conectado, autenticado, sessão válida, ACK verdadeiro, sem QR e
volume-fonte preservado. A revisão 3240 permaneceu auditável como `failed`,
com erro `legacy_volume_migration_restored`.

Os logs mostraram uma janela determinística de reidratação do storage privado
do browser. A primeira exportação canônica, em `09:39:14.834Z`, estava
completa: 2217 registros, `108706` bytes, 10 signal sessions, uma sender key e
sete app-state sync keys. A segunda exportação, em `09:39:18.220Z`, ocorreu
durante a remontagem dos módulos internos e reportou somente estes bloqueios:

- `app_state_mutation_macs.read_failed`;
- `app_state_sync_keys.read_failed`;
- `app_state_versions.read_failed`;
- `device.lid_migration_state_missing`;
- `device.noise_info_read_failed`;
- `device.noise_private_missing`;
- `device.noise_public_missing`;
- `device.noise_recovery_token_missing`;
- `device.platform_missing`;
- `transport.routing_info_missing`.

O gate anterior rejeitava essa segunda amostra imediatamente, antes de poder
obter duas projeções completas e equivalentes posteriores. A política de Noise
estava correta (`effective=false` para `legacy_volume_migration`); portanto não
se tratava de bootstrap cruzado entre providers nem de identidade incompatível.

O fork WWebJS agora trata exclusivamente o conjunto exato acima como uma
amostra transitória de reidratação, somente quando o bootstrap possui origem
`legacy_volume_migration`. Ao encontrá-lo, descarta qualquer candidato de
confiança anterior, zera a contagem de estabilidade e continua dentro do prazo
limitado já existente. A migração ainda exige duas novas projeções completas e
equivalentes antes de prosseguir. Pairing, recreate, handoff entre providers,
revisão ativa, qualquer bloqueio não listado e qualquer ausência de identidade
continuam falhando fechados; em particular, `identity.private_missing` permanece
fatal mesmo nesse modo.

Os testes do fork provam a interrupção transitória entre amostras completas, o
reset obrigatório da estabilidade, a necessidade de quatro exportações no
cenário reproduzido, a ausência da tolerância no pairing e a rejeição de
identidade incompleta. Gates do fork: `309/309` focados; `507` testes amplos
aprovados e um explicitamente pendente; ESLint e Prettier globais e
`git diff --check`. O conjunto integrado que depende de
`WWEBJS_TEST_REMOTE_ID` não foi executado por não haver esse dispositivo de
teste externo no ambiente. O commit do fork é
`8323f75695da6e8e95b444757d275e25acb80515`, publicado como
`@wwebjs/whatsapp-web.js@1.34.124`, shasum
`8daee6588e36489dac26e09a054b6e4c8b412dbd` e integrity
`sha512-d/0WjAFEU9b7Jb9aC/9CFBiSQCZr1rWtxbxGBrsiJtn4NnMzB7nZgaYpgsfpRgZioVVj0dwpXC8hJpEG1Q6GRQ==`.
O pacote contém 158 arquivos e o cache Web continua fixado em
`2.3000.1044338228`.

A Underchat passa a fixar o tarball `1.34.124`; o contrato da dependência
verifica a versão e a presença das duas cercas novas no pacote real instalado.
Os quatro contratos focados de dependência, adapter, conexão e perfil legado
aprovaram `194/194`; o typecheck global também aprovou. O commit/push da
integração continua obrigatório antes do próximo build visual e o novo canário
deve permanecer fora da contagem até satisfazer todos os invariantes de
conclusão descritos acima.

A integração do pacote `1.34.124`, dos contratos e desta memória foi publicada
no commit Underchat `809d37d4f5035111d348bad436a407b751f3ddab`, com `HEAD`
idêntico a `origin/main`, antes do build. Pela interface visual, o job exclusivo
do Worker WWebJS `01a004dc-ef80-707e-a217-209012456e64` gerou
`v20260815095943232` entre `06:59:43.251` e `07:05:59.679-03`. Job e item
terminaram `completed/success`; a imagem possui ID/digest imutável
`sha256:8466736ff33caeb1ccc9dd398204ab5d9e292053dfcb499e2a8137b60b3d652d`.
A inspeção executável da imagem confirmou o pacote `1.34.124` e a presença das
cercas `CANONICAL_LEGACY_PROFILE_TRANSIENT_BLOCKERS` e
`allowLegacyProfileTransientProjection`.

A primeira carga no Server 1 revelou o filesystem em 100% e falhou durante a
extração do layer com `no space left on device`; o código zero do pipe não foi
aceito como evidência de sucesso. A imagem incompleta foi removida e foram
apagadas, nos dois hosts, somente as três versões WWebJS antigas sem qualquer
container consumidor: `v20260815081654274`, `v20260815073932350` e
`v20260815070229192`. Elas continuam recuperáveis pelo registry. Nenhum
container ativo, imagem ativa, default ou rollback do Balance foi removido.
Depois da limpeza, havia 6,0 GB livres no Server 1 e 5,6 GB no Server 2; a
recarga terminou corretamente e ambos apresentaram o mesmo image ID e o pacote
`1.34.124` executável.

O pareamento visual promoveu `v20260815095943232` como default do WWebJS. Em
**Canais aquecidos**, o filtro permaneceu exatamente em
`Opção 2 (Navegador)` antes de **Recriar Todos**, sem atingir Baileys ou
WhatsMeow. Os quatro warms novos ficaram `ready`, `running/healthy`, restart
zero, pacote `1.34.124` e imagem exata:

- Server 1: `01a004e6-859e-70c7-9f47-a3a87d21e35b` e
  `01a004e6-8559-76a9-8573-cc5a0d86d6d4`;
- Server 2: `01a004e6-8585-722a-a0b1-db0e048b5dce` e
  `01a004e6-851b-7270-8357-316f6b3ef234`.

Antes do próximo canário, os sete runtimes ativos permaneceram `online`,
conectados, autenticados, ACK verdadeiro e sem QR, incluindo os três providers
em PostgreSQL e os três legados. O canário visual WWebJS legado → PostgreSQL
deve ser repetido nesta versão e só uma conclusão integral pode entrar na
contagem funcional.

### Primeira materialização canônica do legado WWebJS

O canário visual seguinte, `49d7b827-b9bd-4658-85af-c929e89d9c62`, preservou
411 entradas e `108438319` bytes do volume
`01a00236-10c8-77ef-96b2-06a52b0ed59a`. A correção de reidratação da versão
`1.34.124` funcionou como projetado: depois de uma amostra transitória contendo
somente `app_state_sync_keys.read_failed`, a janela de estabilidade foi zerada
e recebeu sucessivas projeções completas. A execução, porém, revelou uma cerca
independente: a revisão 3241, aberta por `legacy_volume_migration`, já estava
`validating` e era o `active_revision_id` da sessão em estado `preparing`, mas
ainda não possuía linha em `whatsapp_device` nem
`active_device_fingerprint`. O store aceitava a primeira materialização do
dispositivo legado apenas quando não existia `active_revision_id`, embora o
orquestrador atribua corretamente o próprio candidato antes do preflight. As
tentativas iniciais falharam fechadas com
`whatsapp_session_canonical_device_missing`; a última permaneceu sem QR e
falhou em uma projeção canônica posterior, sem promover dados incompletos.

Após três tentativas, a migração terminou `restored` em
`2026-08-15 07:22:21.0334-03`, na geração 38. O worker e o runtime voltaram a
`legacy_volume`, lifecycle foi limpo, WWebJS ficou `online`, conectado,
autenticado, com sessão válida, ACK verdadeiro e sem QR. O container
`7066311f38cb…` ficou saudável e o volume-fonte continuou montado e preservado.
Portanto este canário não entra na contagem funcional, mas comprova novamente
o rollback não destrutivo.

O fork agora autoriza a primeira linha de `whatsapp_device` somente quando
todas estas provas coexistem: origem `legacy_volume_migration`, ausência de
revisão-fonte, `storageMigrationId` presente, revisão `staging` ou
`validating`, sessão exatamente `preparing`, `active_revision_id` ausente ou
igual à própria revisão candidata e ausência de fingerprint ativo. Revisão
estrangeira, sessão `active` e identidade preexistente continuam rejeitadas.
O teste unitário cobre explicitamente o caso permitido e esses três casos
negativos. O fork aprovou `92/92` testes do store, `309/309` nos gates
RemoteAuth/BrowserSessionBridge e a regressão ampla com `508` aprovados e um
teste externo explicitamente pendente, além de ESLint, Prettier, verificação do
cache Web, pacote e `git diff --check`.

A correção foi commitada e enviada antes da publicação no fork como
`0e02918c61aa367a74cf02aafbc3c6c4aad270e8`. O pacote resultante é
`@wwebjs/whatsapp-web.js@1.34.125`, shasum
`b45f6d142dfa9e7691119e47bbbc83afa9ed98fc` e integrity
`sha512-yMWU4dvddgyVz+kHOl5jHEBlOSR0zc9sDNdx+QfW7gpNI5NEtOwjJgRpAWkRrSxsKJxUoQ8BG4xcRHZrvTIcRA==`.
Ele mantém 158 arquivos, um único artefato Web e a versão Web fixa
`2.3000.1044338228`. A Underchat passa a fixar esse tarball e o contrato real
também exige as cercas de sessão `preparing` e revisão candidata atual. A
instalação com lock congelado, os quatro contratos focados (`194/194`), o
typecheck global, ESLint, Prettier e `git diff --check` aprovaram. Commit e push
da integração continuam obrigatórios antes de produzir qualquer nova imagem.
Só o novo canário executado com a imagem `1.34.125` pode ser contabilizado.

A integração foi commitada e enviada antes do build no commit Underchat
`58cf50043d040224ac3b365299c00c5ee103bcef`, com `HEAD` idêntico a
`origin/main`. Pela interface visual, o job exclusivo WWebJS
`01a004f7-27a2-714a-9fda-585c076a1c68` produziu a versão
`v20260815102821538` entre `07:28:21.573` e `07:34:34.057-03`. Job e item
terminaram `completed/success`; a imagem possui ID/digest imutável
`sha256:47e46d05febeed2d8227df02e753ca628d7ace370614b08d8de50e153ef75fe2`.
A inspeção executável confirmou o pacote `1.34.125` e as cercas de
`session_state`, sessão `preparing` e igualdade com a revisão candidata.

Os dois servidores não possuíam credencial persistente para o registry e
recusaram o pull imediatamente, sem deixar processos abertos. A imagem local
foi então transferida por SSH com zstd e `pipefail` nas duas pontas. Ambos os
hosts apresentaram exatamente o mesmo image ID e o pacote executável
`1.34.125`. O Server 1 ficou com 1,7 GB livres e o Server 2 com 3,1 GB; nenhuma
imagem ativa ou de rollback foi removida nesta rodada.

O botão visual **Parear** promoveu `v20260815102821538` como default WWebJS.
Em **Canais aquecidos**, o filtro foi mantido exatamente em
`Opção 2 (Navegador)` antes de **Recriar Todos**. Os quatro warms novos ficaram
`ready`, `running/healthy`, restart zero, pacote `1.34.125` e imagem exata:

- Server 1: `01a00500-241e-727d-a402-0e269a078463` e
  `01a00500-249a-714e-ad9f-119ed5028fc6`;
- Server 2: `01a00500-2469-720c-a2eb-a3f3f98d8187` e
  `01a00500-24b1-743f-b5c9-c7639152d379`.

Depois da renovação, os sete runtimes funcionais continuaram `online`,
conectados, autenticados, com sessão válida, ACK verdadeiro e sem QR. O próximo
passo é repetir visualmente WWebJS legado → PostgreSQL e só contabilizar a
execução se revisão, worker, runtime e conexão terminarem integralmente ativos,
mantendo o volume-fonte preservado.

### Retry após promoção antecipada da revisão legada

O canário visual WWebJS legado → PostgreSQL
`69476a4c-2c89-4d26-8a8a-752196901fef`, iniciado sobre o worker
`01a00236-10c8-77ef-96b2-06a52b0ed59a`, capturou 714 registros e
`128263233` bytes. A geração 39 comprovou a correção `1.34.125`: reidratou o
perfil, materializou o dispositivo, promoveu a revisão 3242 e chegou ao estado
nativo `online`, autenticado e com sessão válida. O evento forte de conexão,
porém, não foi confirmado pelo controle central antes do timeout; por isso o
ACK permaneceu falso e essa tentativa não pode ser contabilizada.

O retry seguro expôs uma segunda cerca independente. Como a primeira tentativa
já havia promovido a revisão 3242, `open_whatsapp_session_revision` devolveu
essa revisão ativa para a nova geração. O wrapper exigia que toda abertura
`legacy_volume_migration` alterasse exatamente uma revisão ainda `staging` ou
`validating`; a atualização legítima da revisão já `active` afetava zero linhas
e terminava com `legacy volume migration revision marking fence changed`. O
comportamento repetiu-se nas gerações seguintes. Depois das três tentativas, a
migração falhou fechada e restaurou corretamente o volume na geração 42:
worker/runtime `legacy_volume`, lifecycle limpo, container saudável, WWebJS
`online`, autenticado, sessão válida, ACK verdadeiro, sem QR e volume-fonte
preservado. Portanto este canário também fica fora da contagem funcional.

A migração Atlas `20260815074800.sql` torna essa abertura idempotente somente
para o candidato exato que uma tentativa anterior já materializou por
completo. O caminho alternativo exige simultaneamente revisão retornada como
`active`, origem `legacy_volume_migration`, provider igual, schema/codec/formato
iguais, checksum presente, tamanho positivo, sessão `ready` apontando a própria
revisão ativa e ausência de handoff. Candidato incompleto, estrangeiro, de
outro provider, sem checksum, sem payload, fora da sessão ativa ou associado a
handoff continua falhando fechado. O contrato estático cobre todas essas
cercas. Antes de aplicar a migração e repetir o canário, esta correção deve ser
commitada e enviada, preservando a regra operacional de `commit + push` antes
de qualquer build.

### Primeiro ciclo funcional WWebJS volume → PostgreSQL e retorno de laboratório

A migration Atlas `20260815074800.sql` e seu contrato foram publicados antes
da aplicação no commit Underchat
`affd13ef7a81480843d869ca9936146528aff82c`, com `HEAD` igual a
`origin/main`. O procedimento foi aplicado por `pnpm run migrate:local`; a
versão registrada no banco passou a `20260815074800`. O SQL também foi
compilado dentro de `BEGIN/ROLLBACK`, e os nove testes focados passaram. O
`atlas migrate lint` não existe na edição Community instalada e o validate
contra a base de desenvolvimento corretamente recusou uma base não vazia;
nenhum desses dois diagnósticos representa falha de sintaxe ou de aplicação.

O canário visual seguinte,
`cbac12f2-9fc6-4af5-8992-6a9204714cb3`, capturou 770 arquivos e
`158247085` bytes do volume WWebJS. A tentativa 1, geração 43, promoveu a
revisão 3243 e atingiu transporte nativo online, mas não recebeu a prova forte
central antes do timeout. A tentativa 2 reutilizou a mesma revisão ativa sem
repetir `legacy volume migration revision marking fence changed`, confirmando
a idempotência nova. A geração 44 encontrou app-state ainda em materialização;
o próprio runtime fez uma replacement generation 45, normalizou o baseline
nativo e então fechou todas as barreiras: revisão ativa 3243, sessão `ready`,
WWebJS online, autenticado, envio/recebimento e ingress autorizados, ACK
verdadeiro e sem QR. O journal avançou para `cleanup_pending` com evidência
integral e, após a ação visual **Excluir volume legado**, terminou `completed`
em `2026-08-15 07:58:29.009-03`; a inspeção do Server 1 confirmou ausência do
volume. Este é o ciclo funcional WWebJS **1/5** desta bateria. A primeira
tentativa isolada não é contabilizada.

O aviso transitório imediatamente após `ready` não justificou relaxar o gate.
Na geração vencedora ele foi `provider_capacity_saturated` durante o
checkpoint canônico, que terminou cerca de um segundo depois. A geração de
substituição obteve duas amostras nativas fortes e completou normalmente. O
resultado prova que o reconciliador seguro recupera a janela; qualquer futura
otimização deve repetir a confirmação depois do checkpoint, nunca transformar
capacidade, store ausente ou app-state pendente em readiness positivo.

Para repetir o teste sem perder a sessão, o perfil RemoteAuth ativo foi copiado
somente depois de parar o container PostgreSQL. Os três symlinks transitórios
de lock do Chromium (`SingletonCookie`, `SingletonSocket` e `SingletonLock`)
foram removidos apenas da cópia de laboratório. O conteúdo foi instalado no
volume homônimo no layout LocalAuth exato
`wwebjs/storage/<worker>/.wwebjs_auth/session-<worker>`: 719 arquivos,
`154258992` bytes e checksum determinístico
`cea4efe300d4c83e51070ed50d93c1a026e23cefa5c6a67f7fd106c960257e91`.
Um journal de restauração separado,
`601c370b-9318-4ea5-ac1e-ecce4ac29c8f`, preservou o histórico `completed` do
ciclo. O orquestrador executou a transição protegida PostgreSQL → volume na
geração 46 e terminou `restored` em `2026-08-15 08:05:01.303228-03`.
Worker/runtime estão novamente `legacy_volume`, lifecycle nulo, container
`healthy`, restart zero, volume montado em `/app/data`, WWebJS online,
autenticado, sessão válida, ACK verdadeiro e sem QR. A UI visual confirma
**Conectado / Sessão legada (volume)**. Esse retorno é preparação de teste e
não entra na contagem volume → PostgreSQL.

### Segundo ciclo WWebJS excluído e cerca de navegação por documento

O segundo ciclo visual WWebJS volume → PostgreSQL,
`8e75e945-20b4-4a39-b4c6-9f5f67cc57de`, capturou 818 arquivos e
`185623711` bytes do volume na geração 46. As três tentativas, gerações 47, 48
e 49, abriram a mesma revisão 3244 sem QR e preservaram a identidade, mas o
Chromium navegou durante a autenticação inicial. O primeiro `inject()` terminou
com `Execution context was destroyed, most likely because of a navigation`.
Embora o handler de `framenavigated` já disparasse uma nova injeção, o voo de
autenticação antigo continuava compartilhado e a inicialização original
fechava o browser como falha terminal. O journal nunca promoveu a revisão nem
apagou o volume. Após as três tentativas, o rollback automático terminou
`restored` em `2026-08-15 08:16:18.053033-03` na geração 50. Worker/runtime
voltaram a `legacy_volume`, lifecycle ficou nulo, container saudável e o canal
ficou online, autenticado, com sessão válida, ACK verdadeiro e sem QR. A UI
mostrou **Sessão legada restaurada** e depois **Conectado / Sessão legada
(volume)**. A rodada é excluída da contagem funcional, que permanece WWebJS
**1/5**.

A comparação da revisão funcional 3243 com a rejeitada 3244 provou que o perfil
não foi perdido: a revisão 3244 continha um manifesto completo de 32 arquivos e
`23705108` bytes, e o mesmo perfil restaurado em LocalAuth conectou em poucos
segundos. A falha era de concorrência entre documentos no cliente WWebJS. O
fork `1.34.126` passa a vincular `_authReadyInFlight` ao
`performance.timeOrigin` do documento. Uma navegação legítima cria um novo voo
em vez de reutilizar a promise do execution context destruído. Quando a
injeção inicial é interrompida por um erro de navegação transitório e o handler
já observou uma sequência de main-frame mais nova, `initialize()` aguarda a
cauda de recuperação; ele não fecha o Chromium concorrente. A tolerância exige
erro de navegação reconhecido, mesma página/browser ainda abertos e sequência
de navegação nova. Página substituída/fechada, estado terminal e qualquer erro
não transitório continuam falhando fechados.

Os novos testes cobrem a transferência da injeção sem finalização destrutiva e
a independência de voos de autenticação entre documentos. O arquivo focado
passou `24/24`; a suíte `tests/session` passou `367` testes com um teste externo
explicitamente pendente; ESLint, Prettier e `git diff --check` passaram. A
suíte global permanece dependente de `WWEBJS_TEST_REMOTE_ID`, ausente neste
ambiente.

A correção foi commitada e enviada antes da publicação no fork como
`92326868423be96f570a7ece7e3a2d6893af2c36`. O pacote
`@wwebjs/whatsapp-web.js@1.34.126` foi publicado com shasum
`8dbbb39455f013f2b3f2c04cfcaca5bc83023c12` e integrity
`sha512-A3UZi47YnvFB3DnYgs72ulLlgKcyjqzDYefS76qK3ZnkP1b/NYiHfXPfPFRTV/KTNN1gV787l3GzfFVno+Ld6A==`.
O prepack validou 158 arquivos e um único cache Web fixado em
`2.3000.1044338228`. A Underchat passa a fixar o tarball `1.34.126`; o contrato
da dependência real também exige os eventos de telemetria
`client.authentication_navigation_superseded` e
`client.initialization_navigation_recovery_joined`, além da cerca
`_authReadyInFlightDocumentEpoch`. A instalação com lock congelado, os quatro
contratos focados (`194/194`) e o typecheck global passaram. Esta integração e
a memória ainda devem ser commitadas e enviadas antes de qualquer build. Só um
novo canário com o pacote instalado poderá entrar na contagem funcional.

### Build e implantação da cerca de navegação WWebJS 1.34.126

A integração anterior foi efetivamente commitada e enviada antes do build no
commit Underchat `b8661d42064bfcb0bf7404221b42553e468c8d0e`, com `HEAD`
idêntico a `origin/main`; o fork também permaneceu sincronizado no commit
`92326868423be96f570a7ece7e3a2d6893af2c36`. Pela interface visual, foi
selecionado exclusivamente **Worker WWebJS**. O job
`01a00530-4c1a-7389-bf9c-b9b31165ddb2` produziu a versão
`v20260815113046426` entre `08:30:46.445` e aproximadamente `08:37:28-03`.
Job e item terminaram `completed/success`, sem mensagem de erro, e a imagem
possui ID/digest imutável
`sha256:1436f3cc6b9f3ef888f03203e7db5307dd78cbdf0cc42b96d7d4e670e37f32a8`.
A inspeção executável local confirmou o pacote `1.34.126` e os marcadores
`client.authentication_navigation_superseded`,
`client.initialization_navigation_recovery_joined` e
`_authReadyInFlightDocumentEpoch`.

Antes da carga, foram removidas em cada servidor somente as imagens WWebJS
`v20260815092631686` e `v20260815095943232`, depois de comprovar com
`docker ps -a --filter ancestor=...` que nenhum container as referenciava.
Nenhuma imagem ativa, default ou usada por um runtime/rollback foi removida.
Isso elevou a folga para 6,5 GB no Server 1 e 7,8 GB no Server 2. A nova imagem
foi transferida para ambos por `docker save | zstd | ssh | zstd -d | docker
load`, com `pipefail` nas duas pontas. Os dois hosts apresentaram o mesmo ID,
pacote executável `1.34.126` e os três marcadores; após a carga permaneceram
4,1 GB e 5,3 GB livres, respectivamente.

O botão visual **Parear** promoveu `v20260815113046426` como default WWebJS.
Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` reduziu a lista a
quatro entradas antes de **Recriar Todos**. A renovação criou quatro warms
PostgreSQL novos, todos `ready`, `running/healthy`, restart zero, sem
`last_error`, pacote `1.34.126` e imagem exata `sha256:1436f3cc...`:

- Server 1: `01a0053a-5c6a-705d-aa00-a55d167f341f` e
  `01a0053a-5cfc-75ec-8ea9-39525f91c686`;
- Server 2: `01a0053a-5cb3-71f9-8b0a-2db46038dfc3` e
  `01a0053a-5ce4-77f4-991e-0b7ee77d9d72`.

O próximo passo obrigatório é repetir visualmente o canário WWebJS legado →
PostgreSQL. Ele só conta como ciclo **2/5** se journal, revisão, worker,
runtime, conexão forte/ACK, ausência de QR e limpeza explícita do volume
terminarem integralmente corretos. Uma restauração segura continua excluída da
contagem, mesmo que preserve a sessão.

### Canário 1.34.126 excluído, concorrência entre gerações e fork 1.34.127

O canário visual seguinte do worker **Wwebjs Legacy**
`01a00236-10c8-77ef-96b2-06a52b0ed59a` iniciou a migração
`2020b136-54f4-44b4-b5d4-cd5a6ea3003c` a partir da geração 50. A captura
preservada continha 847 arquivos, `188336678` bytes, checksum
`07dbbf00c6bf75922d03ba8e9710425b7355d03f988c9940400977be9b64a08f`,
telefone esperado `556192037138` e identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.
Nenhuma das três tentativas entra na contagem funcional.

A versão `1.34.126` corrigiu o fechamento antecipado do primeiro `inject()`,
mas revelou uma segunda corrida. Ao trocar `performance.timeOrigin`, o Client
permitia que o novo documento criasse imediatamente outro voo completo de
prontidão enquanto o anterior ainda executava o gate canônico. O voo antigo
iniciou o full sync oficial de app-state na geração 1; o sucessor, sem
compartilhar o estado local desse gate, iniciou a geração 2. A cerca existente
detectou corretamente a troca como
`wwebjs_canonical_app_state_sync_generation_mismatch` e impediu promoção
incorreta. Outros momentos das tentativas observaram
`Execution context was destroyed` ou `Attempted to use detached Frame`; eles
também permaneceram sem QR e falharam fechados. Portanto a checagem de geração
não deve ser relaxada: o defeito era concorrência entre produtores, não uma
divergência aceitável.

Depois da terceira tentativa, o orquestrador restaurou automaticamente a
origem na geração 54. O journal terminou `restored` em
`2026-08-15 08:53:05.580281-03`, com `source_volume_preserved=true`.
Worker/runtime voltaram a `legacy_volume`, lifecycle ficou nulo, o volume
homônimo permaneceu montado e o canal terminou `online`, conectado,
autenticado, com sessão válida, ACK verdadeiro e sem QR. A interface visual
mostrou **Sessão legada restaurada** e a tabela voltou a exibir
**Conectado / Sessão legada (volume)**. Isso valida novamente o rollback, mas
mantém a contagem WWebJS em **1/5**.

O fork `1.34.127` serializa os voos de prontidão entre documentos. O documento
sucessor reutiliza um resultado anterior bem-sucedido ou só inicia sua tarefa
depois que o voo obsoleto rejeita com um erro de navegação reconhecido. Assim,
dois documentos não podem disparar gerações oficiais de sync concorrentes. A
publicação do resultado também é transferida ao documento mais novo e ocorre
uma única vez, com telemetria
`client.authentication_publication_superseded`.

A única exceção à finalização nativa imediata foi intencionalmente limitada ao
bootstrap cercado `legacy_volume_migration`, antes do checkpoint, quando o
documento e a sequência de navegação capturados já foram substituídos e o
erro pertence ao conjunto transitório conhecido. Nesse caso o evento
`session.identity_validation_navigation_superseded` delega todas as provas de
identidade e geração ao sucessor serializado. Pareamento novo continua exigindo
nova autorização one-shot; handoff/recuperação ativa, documento atual, erro
não transitório, checkpoint, lease, identidade e geração mantêm a finalização
fail-closed anterior.

Os testes novos cobrem: serialização sem execução concorrente, reutilização de
um predecessor bem-sucedido, ausência de retry para erro não relacionado a
navegação e reexecução do bootstrap legado no documento sucessor sem rollback
prematuro. Os testes focados passaram `139/139`; a suíte ampliada de
RemoteAuth e `tests/session` passou `482` testes com um teste de infraestrutura
opcional pendente. ESLint, Prettier, cache Web, conteúdo do pacote e
`git diff --check` também passaram. A suíte global continua dependendo de
`WWEBJS_TEST_REMOTE_ID`, que não existe neste ambiente.

A correção foi commitada e enviada antes da publicação no fork como
`4a288550d458b32fc3e971863018ba5c2779d345`. O pacote
`@wwebjs/whatsapp-web.js@1.34.127` foi publicado com shasum
`e2ce77c10704cb0602ce1815c362486ff30bd78a` e integrity
`sha512-uyw/p++K4VIlmwpYoREzB+9sbXMjKv4N4is0Y+qcsgBeOo60fKGwtLobPwgoGg0tkiPeYZUaW3Lx4GXCTTJrKQ==`.
O prepack confirmou 158 arquivos e um único cache Web fixado em
`2.3000.1044338228`.

A Underchat passa a fixar o tarball `1.34.127`; seu contrato real exige também
os dois eventos novos e a limitação explícita por
`legacyVolumeMigrationBootstrap`. Os seis contratos focados passaram `40/40`,
o typecheck global passou, e a instalação local confirmou a versão e os
marcadores publicados. Esta integração e a memória precisam estar commitadas
e enviadas antes do próximo build. Só o novo canário executado em imagem
`1.34.127` poderá ser contabilizado como WWebJS **2/5**.

### Build, distribuição e warms do WWebJS 1.34.127

A integração e a memória da correção foram efetivamente commitadas e enviadas
antes do build no commit Underchat
`3befc6ac25757baa8c1ddc78bf6a1f0e06703113`, com `HEAD` idêntico a
`origin/main`; o fork permaneceu sincronizado no commit
`4a288550d458b32fc3e971863018ba5c2779d345`. Pela interface Playwright visível,
foi selecionado exclusivamente **Worker WWebJS**. O job
`01a00555-492f-733e-8d6b-6227e16d0557` gerou a versão
`v20260815121110511`; job e item terminaram `completed/success`, sem erro. A
imagem publicada possui digest/ID imutável
`sha256:b905b2fc331cc27759a75758114e6486bcfbd5e365f98bc770bf593d0eca0d98`.

A inspeção executável local comprovou o pacote `1.34.127`, a serialização pelo
predecessor `const previousFlight = this._authReadyInFlight`, a cerca de
publicação `client.authentication_publication_superseded` e a recuperação
legada limitada por `session.identity_validation_navigation_superseded`. O
`docker pull` direto nos servidores foi recusado por falta de credencial do
Harbor; não ficou processo pendente. A imagem foi então transferida
integralmente para cada host por `docker save | zstd | ssh | zstd -d | docker
load`, com `pipefail`. Server 1 e Server 2 apresentaram o mesmo ID, pacote e
marcadores.

Antes da carga, a tag antiga WWebJS `v20260815102821538` foi removida em ambos
os hosts somente após `docker ps -a --filter ancestor=...` comprovar ausência
de container. O artefato continua recuperável pelo Harbor. A versão anterior
`v20260815113046426` foi preservada para rollback. Duas imagens de 12/08 não
foram removidas do Server 1 porque a inspeção encontrou warms ativos nelas.
Essa limpeza elevou temporariamente a folga para 6,5 GB e 7,6 GB; depois da
carga restaram 4,0 GB e 5,2 GB, respectivamente.

O pareamento visual terminou com sucesso e `v20260815121110511` ficou como
default WWebJS. Em **Canais aquecidos**, o filtro exato
`Opção 2 (Navegador)` mostrou quatro entradas antes de **Recriar Todos**. A
renovação criou quatro warms PostgreSQL, todos `ready`, `running/healthy`,
restart zero, sem `last_error`, pacote `1.34.127` e imagem exata
`sha256:b905b2fc...`:

- Server 1: `01a0055f-a460-74eb-be79-e00c6d08aebc` e
  `01a0055f-a4af-70ad-a0b4-2522f5acd2f8`;
- Server 2: `01a0055f-a417-7111-914f-7047762c4a16` e
  `01a0055f-a497-764e-8e56-8dc88bb649ec`.

O próximo passo continua sendo o canário visual **Wwebjs Legacy** volume →
PostgreSQL. Ele só entra como ciclo **2/5** após journal concluído, revisão
ativa pronta, runtime/worker PostgreSQL, estado nativo forte com ACK, ausência
de QR e limpeza explícita do volume. Qualquer restauração segura permanece
fora da contagem.

### Canário 1.34.127 excluído: deriva do documento Web e gate inicial sem prazo interno

O canário visual seguinte do worker **Wwebjs Legacy**
`01a00236-10c8-77ef-96b2-06a52b0ed59a` iniciou a migração
`effc2e07-3cd4-424f-aa68-a6b46648ff0c` a partir da geração 54. A captura
preservada continha 857 arquivos, `191055326` bytes, checksum
`6e9314671592ee2ae4002faafa8b63d5651ec8cc6e0629789591f820720e9285`,
telefone esperado `556192037138` e identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.
A revisão candidata foi a 3246, com origem `legacy_volume_migration` e versão
registrada `2.3000.1044338228`. Nenhuma das três tentativas entra na contagem;
WWebJS permanece **1/5**.

O fork `1.34.127` eliminou a concorrência entre voos de prontidão: nesta
rodada não houve duas gerações oficiais de full sync concorrentes. O canário
expôs dois problemas diferentes e posteriores. O PostgreSQL WWebJS usa
deliberadamente `webVersionCache={type:'none'}` para acompanhar o documento
servido pelo WhatsApp; o documento ao vivo avançou para
`2.3000.1045279437`. Na primeira inicialização, os módulos privados ainda não
estavam materializados quando a projeção foi lida. O bridge rejeitou
`wwebjs_canonical_projection_incomplete`, incluindo
`module_abi.incompatible` e as ausências temporárias de Signal, preferências,
routing e App State. A falha foi fechada, sem QR e sem promoção.

Na geração 56, a mesma build ao vivo autenticou, exportou uma projeção
canônica completa de 2.217 registros e concluiu o full sync oficial. O gate
alcançou `stable_sample_count=1/2`, mas a chamada browser seguinte não ficou
submetida ao prazo total do próprio gate. O timeout externo de inicialização
destruiu o cliente depois de aproximadamente dois minutos, gerando
`handoff_checkpoint_failed`; uma reinicialização interna voltou a autenticar
e exportar, porém não conseguiu publicar `online` com ACK antes do limite da
operação. Portanto, não se deve relaxar ABI, identidade, duas amostras, ACK ou
checkpoint. A correção precisa: (1) tratar a indisponibilidade completa dos
módulos como transitória apenas no bootstrap legado cercado, com espera
limitada e exigência posterior da ABI exata; e (2) aplicar o deadline do gate
a cada operação assíncrona do browser, para que nenhuma avaliação possa
ultrapassar silenciosamente o orçamento e ser encerrada pelo timeout externo.

Após três tentativas, o orquestrador encerrou com o erro cercado
`recreated worker connection state was not confirmed` e restaurou a origem na
geração 58. O journal terminou `restored` em
`2026-08-15 09:34:13.286241-03`, com `source_volume_preserved=true`.
Worker/runtime voltaram a `legacy_volume`, lifecycle ficou nulo, o volume
homônimo foi montado em `/app/data`, e o container da imagem exata
`sha256:b905b2fc...` terminou `running/healthy`, restart zero. O estado nativo
ficou `online`, conectado, autenticado, sessão válida, ACK verdadeiro e sem
QR. A UI visual exibiu 100% dos sete canais conectados e o diálogo **Sessão
legada restaurada**. Isso comprova novamente que o rollback é seguro, mas não
é um ciclo funcional.

Antes de um novo build, a próxima rodada deve implementar a correção estreita
no fork, cobrir por testes os prazos internos e a distinção entre reidratação
temporária e ABI realmente incompatível, executar as suítes de regressão,
documentar, commitar e enviar o fork; depois publicar a nova versão, integrar,
documentar, commitar e enviar a Underchat. Só então um novo canário visual
pode ser iniciado.

### Fork WWebJS 1.34.128: reidratação cercada e deadlines por RPC do browser

O fork `1.34.128` implementa a correção estreita sem alterar as provas de
identidade, ABI final, duas amostras, full sync oficial, checkpoint, geração ou
ACK. Durante `legacy_volume_migration`, uma projeção que contenha
`module_abi.incompatible` só é transitória quando contém também pelo menos um
dos bloqueadores já reconhecidos da reidratação LocalAuth e quando **todos** os
demais bloqueadores pertencem ao mesmo allowlist. `module_abi.incompatible`
isolado permanece fatal; pareamento novo, handoff entre provedores, restart
ativo e qualquer bloqueador de identidade/estrutura continuam fora dessa
exceção. A tolerância apenas repete leituras dentro do gate limitado e ainda
exige uma projeção posterior completa com a ABI exata.

O gate inicial agora aplica o deadline restante a toda operação assíncrona do
browser: observação do job, exportação canônica, recuperação de stall e disparo
do full sync oficial. Um RPC privado individual também tem teto de 30 segundos,
menor que o gate total de 120 segundos e que o watchdog externo de 210
segundos. Como DevTools não cancela uma avaliação em curso, a promise tardia
fica tratada e o erro `wwebjs_canonical_initial_app_state_browser_operation_timeout`
leva RemoteAuth à terminação fail-closed do Chromium; nenhum segundo produtor
é aberto no mesmo realm. As operações legítimas de recuperação e full sync
mantêm seus limites específicos de até 60 e 30 segundos, respectivamente.

Os testes novos comprovam: reidratação combinada com ABI temporariamente
indisponível; ABI isolada fatal; deadline total de uma exportação travada;
timeout individual de 30 segundos com margem restante; e escopo ausente em
pairing/identidade. O foco passou `5/5`; a suíte RemoteAuth + bridge passou
`313/313`; a suíte ampliada RemoteAuth + todos os testes de sessão passou
`485`, com um teste de instalação concorrente opcional pendente. ESLint,
Prettier, `git diff --check`, cache Web e os 158 arquivos do pacote passaram.
`tests/client.js` continua indisponível porque aborta na carga sem o segredo
externo `WWEBJS_TEST_REMOTE_ID`; nenhum identificador fictício foi usado.

O prepack confirmou o único cache fixado em `2.3000.1044338228` (573208 bytes)
e o dry-run gerou 158 entradas, 774212 bytes compactados e 4986832 bytes
descompactados. A correção foi commitada e enviada antes da publicação no
commit `adbaa0bf276fa98e8eac3b358fcefa3804d82184`, com `HEAD` idêntico a
`origin/main`. O próximo passo é publicar `@wwebjs/whatsapp-web.js@1.34.128`,
validar o tarball do registry, integrar e testar a Underchat, documentar,
commitar e enviar tudo antes do próximo build.

O pacote foi publicado no registry Gitea interno e relido pelo mesmo endpoint
usado pela Underchat. O tarball publicado possui shasum
`d3ba180983b68c50d2bf419a6bbac424697b15da`, integrity
`sha512-BEwugCqgZVks3ghsU7+9HPlCWRu2oAz9gsHmqLJybbiIShhRhGwmbdl5nWbLEGNdFXesMKaxyU5SXBZpfrm1cw==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.128/whatsapp-web.js-1.34.128.tgz`.
A extração independente confirmou a versão e os marcadores do teto de 30
segundos, do erro controlado e da classificação cercada de ABI.

A Underchat passa a fixar esse tarball em `package.json` e `pnpm-lock.yaml`.
O contrato da dependência real exige `1.34.128`,
`CANONICAL_INITIAL_APP_STATE_BROWSER_OPERATION_TIMEOUT_MS = 30000`,
`wwebjs_canonical_initial_app_state_browser_operation_timeout` e a condição
explícita `entry === 'module_abi.incompatible'`, além de todas as cercas
anteriores. Os cinco arquivos de contrato de dependência, conexão WWebJS,
PostgresSessionStore, modelo de migração legada e orquestrador passaram
`210/210`; o typecheck global passou. Esta integração e a memória devem agora
ser commitadas e enviadas antes do build visual exclusivo do WWebJS. O canário
seguinte ainda começa com a contagem funcional WWebJS em **1/5**.

### Build, distribuição e warms do WWebJS `1.34.128`

A integração foi commitada e enviada antes do build no commit Underchat
`ebbbec553a5a5223810117fe4134de008a33cb87`, com `HEAD` idêntico a
`origin/main`. Pela interface Playwright visual foi selecionado exclusivamente
**Worker WWebJS**. O job `01a0057c-49c4-712a-8bb6-d8faf4149169` gerou a
versão `v20260815125346564` entre `09:53:46.592` e `10:00:17.710-03`; job e
item terminaram `completed/success`, sem erro. A imagem possui ID/digest
imutável
`sha256:69bd233f27665286570fb78567317c432a61562b9a662e3f303e981c99491267`.
A inspeção executável dentro da imagem confirmou o pacote `1.34.128`, o teto
`CANONICAL_INITIAL_APP_STATE_BROWSER_OPERATION_TIMEOUT_MS = 30000`, o erro
controlado `wwebjs_canonical_initial_app_state_browser_operation_timeout` e a
cerca `entry === 'module_abi.incompatible'`.

O botão visual **Parear** promoveu essa versão como default. A imagem foi
transferida integralmente para os dois servidores por
`docker save | zstd | ssh | zstd -d | docker load`, com `pipefail` nas duas
pontas. Ambos os hosts apresentaram o mesmo image ID e pacote executável
`1.34.128`. A carga reduziu a folga para 1,6 GB no Server 1 e 2,6 GB no Server 2. Para recuperar espaço sem afetar runtimes, a imagem antiga WWebJS
`v20260815113046426` foi removida em cada host somente depois de
`docker ps -a --filter ancestor=...` comprovar ausência de qualquer container.
Ela permanece recuperável pelo Harbor. A imagem ativa `1.34.127`, a nova
`1.34.128` e todas as imagens efetivamente referenciadas foram preservadas;
restaram 4,0 GB e 5,0 GB livres, respectivamente.

Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` mostrou quatro
entradas antes de **Recriar Todos**. A renovação criou quatro warms PostgreSQL,
todos `ready`, `running/healthy`, restart zero, sem `last_error`, pacote
`1.34.128` e imagem exata `sha256:69bd233f...`:

- Server 1: `01a00588-76b9-7164-bf87-989f2451b0ce` e
  `01a00588-76e2-718a-8a79-e34f86bc73ee`;
- Server 2: `01a00588-7679-77c3-8f5b-187aeeede588` e
  `01a00588-76fa-70be-84b6-1e986021a56d`.

O próximo passo é o novo canário visual **Wwebjs Legacy** volume → PostgreSQL.
Ele só passa a contar como ciclo funcional **2/5** se journal, revisão ativa,
worker/runtime PostgreSQL, conexão nativa forte com ACK, ausência de QR,
saúde do container e exclusão explícita do volume-fonte terminarem todos
corretos. Qualquer rollback seguro continua excluído da contagem.

### Canário `1.34.128` excluído: checkpoint do LevelDB permaneceu mutável

O canário visual seguinte de **Wwebjs Legacy** volume → PostgreSQL usou a
migração `560e66d1-2943-4ed5-9bab-ed2e3fb0c5e5`, operação inicial
`01a0058b-51b2-77ec-ae23-d283e4920d87`, origem geração 58 e checkpoint de
864 arquivos/192.291.771 bytes, checksum
`e1da50c617b311cf731eefa9ce0cb4a05add1fbe437ed333b732c56156be22c0`.
O telefone esperado permaneceu `556192037138` e o hash de identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.

A correção de prazo da `1.34.128` funcionou: não houve outro RPC de browser
pendurado. Na tentativa 1, geração 59/revisão 3248, o alvo autenticou sem QR,
exportou projeção canônica completa de 2.217 registros, concluiu full sync e
resync controlado, atingiu estabilidade 2/2 com quatro coleções iguais e 1.031
MACs verificados e validou a identidade. O bloqueio mudou para o checkpoint
`ready`: o perfil Chromium continuou alterando o LevelDB enquanto ele era
transmitido, gerando repetidamente
`whatsapp_artifact_profile_changed_during_checkpoint`.

A tentativa 2, geração 60, falhou inicialmente em estado de módulos Web ainda
incompletos/ABI incompatível e reiniciou o container uma vez. Depois voltou
autenticada e `connecting`, mas não obteve a confirmação `online` no prazo. A
tentativa 3, geração 61/revisão 3249, ficou `healthy`, restart zero, repetiu com
sucesso projeção completa, full sync, estabilidade 2/2 e identidade válida.
Mesmo assim o checkpoint final observou mudanças sucessivas, inclusive em
`Default/IndexedDB/https_web.whatsapp.com_0.indexeddb.leveldb/001170.ldb`, nas
fases `file_metadata_changed` e `post_stream_metadata_changed`. O manager
encerrou o alvo com
`recreated_worker_connection_state_was_not_confirmed`; nenhuma revisão foi
promovida e nenhuma exclusão do volume foi solicitada.

Após três tentativas, o journal terminou `restored` às
`10:17:24.109901-03`, com `source_volume_preserved=true`. A restauração geração
62 usa a própria imagem `1.34.128`, o volume homônimo montado em `/app/data`,
container `running/healthy`, restart zero e estado nativo `online`,
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR. A UI
voltou a 7/7 canais conectados e exibiu **Sessão legada restaurada**. Esta
execução está excluída; a contagem WWebJS permanece **1/5**.

A causa seguinte a corrigir é a consistência do checkpoint `ready` de um
perfil Chromium vivo. A solução não pode ignorar mutações nem relaxar
identidade/app-state: deve capturar um ponto consistente do LevelDB (ou
serializar brevemente o produtor) dentro do prazo da operação, preservando o
fail-closed quando a consistência não puder ser demonstrada.

### Fork WWebJS `1.34.129`: checkpoint conectado crash-consistent e cercado

A causa do canário anterior foi confirmada no limite exato entre a projeção
canônica já validada e o artefato do perfil. `ProfileArtifact` lista e confere
novamente cada arquivo antes e depois do streaming; o Chromium conectado
continuava rotacionando o LevelDB durante o upload. Portanto, as rejeições por
`file_metadata_changed`/`post_stream_metadata_changed` eram corretas e não
podem ser transformadas em sucesso. Repetir o mesmo streaming com o renderer
ativo apenas consumia o prazo sem criar um ponto consistente.

O fork `1.34.129` adiciona um snapshot conectado estritamente limitado ao
checkpoint `ready` do pareamento PostgreSQL inicial ou do bootstrap
`legacy_volume_migration`. Antes do freeze, o bridge exige, no mesmo realm:
`navigator.onLine`, dispositivo registrado, socket `CONNECTED`, WAComms
inicializado/conectado, ausência de pareamento ativo, `timeOrigin` válido,
rede não quiescida e CDP disponível. Só então congela por CDP o lifecycle do
renderer; não fecha o WebSocket, não coloca a rede offline, não altera guardas
de credencial e não participa dos caminhos de handoff, restart ativo,
checkpoint periódico ou conexão direta.

Enquanto o renderer está congelado, nenhuma chamada `page.evaluate` é feita.
O artefato continua passando pelas conferências completas de inventário e
metadados existentes. O `validateSnapshot` reativa o renderer em `finally`,
exige o mesmo documento e o transporte forte novamente e só depois drena e
exporta uma segunda projeção canônica. Se a projeção avançou na janela entre a
primeira leitura e o freeze, o mesmo erro retryable de perfil mutável descarta
todos os chunks órfãos e reconstrói perfil e projeção juntos. A revisão só é
persistida/promovida depois dessa validação; falha de resume, troca de realm,
perda do transporte, escopo indevido ou mutação persistente continuam
fail-closed.

As cercas impedem explicitamente o uso quando a revisão já é `active`, a
origem não é `pairing`/`legacy_volume_migration`, a revisão pertence a um
handoff, o motivo não é `ready` ou os métodos CDP não existem. Os testes novos
comprovam: freeze/resume sem RPC durante o estado congelado; rejeição de
transporte não registrado; resume obrigatório após falha do artefato; retry
integral quando a projeção muda antes do freeze; promoção somente depois da
revalidação; e ausência do caminho em handoff/revisão ativa.

Lint, Prettier, `git diff --check`, web cache fixado e verificação dos 158
arquivos do pacote passaram. A matriz offline ampliada terminou com **527
testes passando** e um teste de instalação concorrente opcional pendente. O
`npm test` global continua abortando na carga dos testes de conta real sem
`WWEBJS_TEST_REMOTE_ID`; a mesma matriz foi executada explicitamente com
`--exit`, sem usar credencial fictícia. A versão foi commitada e enviada antes
de qualquer publicação/build no fork como
`59a8a180ca6b5c354cc00b3a9cf6dd4917a618c0`, com `HEAD` idêntico a
`origin/main`.

Próximos passos obrigatórios: publicar e reler o tarball `1.34.129`, integrar
o pacote real e seu contrato na Underchat, documentar/commitar/enviar essa
integração **antes** do build, gerar e distribuir somente a imagem WWebJS,
renovar os quatro warms e repetir o canário visual. O próximo canário ainda
parte de WWebJS **1/5**; rollback seguro ou volume preservado continua fora da
contagem funcional.

O pacote `@wwebjs/whatsapp-web.js@1.34.129` foi publicado no registry interno
e relido pelo endpoint usado pela Underchat. O tarball possui shasum
`01130f4e7d034cc615825b60be021000dfda7ec1`, integrity
`sha512-A7WzbQ0DcGK3NxoyTTXAdMmyah+H+LujN/Kfdqxm/U99rOcoyPBNCjpem4uqajXgDFNVe2X4nZm4p5yh6mp+WA==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.129/whatsapp-web.js-1.34.129.tgz`.
A extração independente confirmou a versão, `connectedProfileSnapshot: true`,
a cerca `wwebjs_connected_profile_checkpoint_scope_invalid`, os métodos
`freezeConnectedProfileSnapshot`/`resumeConnectedProfileSnapshot` e a
telemetria de resume.

A Underchat passa a fixar esse tarball em `package.json` e `pnpm-lock.yaml`.
O contrato da dependência real exige também todos os marcadores do snapshot
conectado e mantém os contratos anteriores de deadline, ABI, navegação,
PostgresSessionStore e migração legada. A instalação local confirmou a versão
executável e os marcadores publicados; os cinco arquivos de contrato focados
passaram **204/204** e o typecheck global passou. A tentativa de instalação
offline apenas informou que o tarball recém-publicado ainda não existia no
store local; a instalação normal o baixou e terminou integralmente. Esta
integração e este registro devem ser commitados e enviados antes do build
visual exclusivo do WWebJS.

### Build, distribuição e warms do WWebJS `1.34.129`

A integração foi commitada e enviada antes do build no commit Underchat
`288e6f406d0eef7ad6959a9af936eb5fb2d4333e`, com `HEAD` idêntico a
`origin/main`. Pela interface Playwright visual foi selecionado exclusivamente
**Worker WWebJS**. O job `01a005a8-064f-75a8-81c2-2dd85c01653b` gerou a
versão `v20260815134132879` entre `10:41:32.933` e `10:47:40-03`; job e item
terminaram `completed/success`, sem erro. A versão nova tornou-se o default
WWebJS e a própria UI confirmou **Concluído**, sem erro.

A imagem possui ID/digest imutável
`sha256:f89027bf48453154721b3a7e4d28b66104c943cb639303c7968af9f4d0d282d3`.
A inspeção executável dentro da imagem confirmou o pacote `1.34.129`, os
métodos `freezeConnectedProfileSnapshot`/`resumeConnectedProfileSnapshot`, a
cerca `wwebjs_connected_profile_checkpoint_scope_invalid` e a solicitação
`connectedProfileSnapshot: true`.

A imagem foi transferida integralmente para os dois servidores por
`docker save | zstd | ssh | zstd -d | docker load`, com `pipefail` nas duas
pontas. Ambos os hosts apresentaram o mesmo image ID e pacote executável
`1.34.129`. A carga reduziu temporariamente a folga para 1,6 GB no Server 1 e
2,4 GB no Server 2. A imagem antiga WWebJS `v20260815121110511` foi removida
em cada host somente depois de `docker ps -a --filter ancestor=<image-id>`
comprovar ausência de qualquer container; ela permanece recuperável pelo
Harbor. A imagem anterior ativa `1.34.128`, a nova `1.34.129` e as imagens
efetivamente referenciadas foram preservadas. Restaram 4,0 GB e 4,8 GB livres,
respectivamente.

Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` mostrou quatro
entradas antes de **Recriar Todos**. A renovação criou quatro warms PostgreSQL,
todos `ready`, `running/healthy`, restart zero, sem `last_error`, pacote
`1.34.129` e imagem exata `sha256:f89027bf...`:

- Server 1: `01a005b1-8886-776d-aed6-6547ca90c07e` e
  `01a005b1-8832-76d5-96a5-9da804e3b33d`;
- Server 2: `01a005b1-88ce-73fe-862a-966e1e319660` e
  `01a005b1-889c-7762-acd5-913eb41534f1`.

O próximo passo é repetir visualmente o canário **Wwebjs Legacy** volume para
PostgreSQL. Ele somente contará como WWebJS **2/5** se journal, revisão ativa,
backend do worker/runtime, prova nativa forte com ACK, ausência de QR, saúde
do container e exclusão explícita do volume-fonte forem todos confirmados.
Rollback seguro ou preservação do volume continuam excluídos da contagem.

### Canário `1.34.129` excluído: `READY` sem utilitários WWebJS completos

O canário visual seguinte de **Wwebjs Legacy** volume para PostgreSQL usou a
migração `9d0bb4a3-1f61-4fbb-9870-b5c0e16ae89e`, operação inicial
`01a005b3-8906-72fb-a618-c8e3644d43c4`, origem geração 62, alvo inicial
geração 63 e checkpoint de 875 arquivos/194.082.465 bytes, checksum
`64b84a4d9fb92e37830915bef76ae3bc7ca2481e4acb2a8fa8a0274ecc51e449`.
O telefone esperado continuou `556192037138` e o hash de identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.

A correção do perfil conectado da `1.34.129` funcionou de ponta a ponta até a
promoção. O alvo reconheceu a sessão sem QR, autenticou, exportou projeção
canônica completa de aproximadamente 2.219 registros, concluiu full sync,
atingiu estabilidade 4/4 e verificou 1.031 MACs. O renderer foi congelado às
`13:55:02.173Z`; o perfil consistente, com 28 arquivos e aproximadamente 23
MB, foi construído em cerca de 1,37 segundo; o mesmo documento foi retomado às
`13:55:04.164Z`. A conexão atingiu readiness 2/2, estado nativo online e a
revisão 3250 foi promovida a `active` às `10:55:04.499-03`. Não houve a antiga
mutação de LevelDB nem relaxamento das provas de identidade/app-state.

Logo após o `READY`, porém, o health check da Underchat registrou
`store_wwebjs_not_ready`, com `session_ready=false`: o documento autenticado
não possuía o namespace utilitário `window.WWebJS` completo exigido pelo
runtime. Portanto, a Underchat corretamente não reconheceu o ACK online. As
tentativas seguintes foram consequências dessa primeira convergência ainda em
curso: a tentativa 2/geração 64 encontrou
`worker_lifecycle_lock_timeout`; a tentativa 3/geração 65 encontrou
`worker_runtime_removal_database_fence_changed`.

O journal terminou `restored`, com três tentativas e
`source_volume_preserved=true`, às `10:59:22.235392-03`. O canal retornou ao
volume legado na geração 65, imagem `1.34.129`, container `running/healthy`,
restart zero, estado nativo `online`,
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR. A UI
voltou a 7/7 conectados e apresentou **Sessão legada restaurada**. A execução
continua excluída e a contagem WWebJS permanece **1/5**.

Essa evidência não invalida a correção crash-consistent da `1.34.129`. O novo
defeito está no contrato interno do SDK: `READY` não pode ser emitido depois de
`afterAuthReady` se as funções utilitárias usadas pelo próprio cliente não
existirem no mesmo documento. Não corrigir isso por tolerância no health check,
por ACK sintético nem retirando as cercas de identidade/checkpoint.

### Fork WWebJS `1.34.130`: utilitários obrigatórios antes do `READY`

O fork `1.34.130` adiciona
`Client._ensureWWebJSUtilitiesAfterAuthReady(expectedDocumentEpoch)` e o chama
imediatamente depois de `authStrategy.afterAuthReady()`, antes de liberar o
gate público e emitir `READY`. A verificação exige simultaneamente o mesmo
`performance.timeOrigin`, o namespace utilitário e as funções concretas
`getMessageModel`, `getChat` e `normalizeMessageId`, além do bridge de eventos
`_wwjsListeners` não vazio.

Quando tudo já existe, o caminho é um no-op. Quando apenas os utilitários
stateless desapareceram, mas documento e bridge permanecem intactos, o cliente
emite `client.ready_utility_reinjection_started`, reaplica `LoadUtils`, aguarda
por no máximo 30 segundos e valida novamente todas as invariantes. Troca de
documento, ausência do bridge ou reinjeção incompleta falham fechadas com,
respectivamente, `wwebjs_ready_utility_document_replaced`,
`wwebjs_ready_event_bridge_missing` e
`wwebjs_ready_utility_reinjection_incomplete`. Credenciais, sessão, estado do
provider, projeção canônica e regras do checkpoint não são alterados.

Os quatro testes novos cobrem reinjeção bem-sucedida, no-op quando completo,
falha fechada após troca de documento e falha fechada sem bridge. A suíte
focada passou **30/30**; a matriz offline ampliada passou **521 testes**, com
um teste opcional de instalação concorrente pendente. Lint, Prettier,
`git diff --check`, web cache e verificação dos 158 arquivos do pacote também
passaram.

A alteração foi commitada e enviada no fork antes da publicação como
`d62dc95d58344a71c26878eb8347d4911fa322b5`, com `HEAD` idêntico a
`origin/main`. O pacote `@wwebjs/whatsapp-web.js@1.34.130` foi publicado e
relido no registry interno com shasum
`2c72bd48374fb74c53ebbf05d2c04119ff687382`, integrity
`sha512-0r9kQ75U7FV5WZrfIprwX1uMaxnuELEZNx1K7JQCSl9gD784EmL+2GW6ft49vqUlBDEOU/yUS7d6dQFZ+u738Q==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.130/whatsapp-web.js-1.34.130.tgz`.

Próximos passos: integrar o tarball real e ampliar o contrato da dependência,
executar testes e typecheck, documentar e fazer commit/push da Underchat antes
do build visual exclusivo do WWebJS. Só depois distribuir a imagem, renovar os
warms e repetir o canário. A próxima execução ainda parte de WWebJS **1/5** e
só conta se também excluir explicitamente o volume-fonte após todas as provas.

A Underchat passa a fixar o tarball `1.34.130` em `package.json` e
`pnpm-lock.yaml`. A instalação local confirmou a versão executável e os
marcadores de reinjeção/no-op e das três falhas fechadas. O contrato da
dependência real exige agora o método pré-`READY`, os eventos/códigos de erro e
as três funções utilitárias concretas, preservando simultaneamente todos os
contratos anteriores de checkpoint conectado, deadline, ABI, navegação,
PostgresSessionStore e migração legada.

Os cinco arquivos de contrato de dependência, conexão WWebJS,
PostgresSessionStore, perfil de migração legada e orquestrador passaram
**204/204**. O typecheck global também passou. Esta integração e este registro
devem ser commitados e enviados antes do build visual exclusivo do WWebJS; a
imagem anterior `1.34.129` continua sendo a versão ativa até esse build ser
concluído e validado.

### Build, distribuição e warms do WWebJS `1.34.130`

A integração foi commitada e enviada antes do build no commit Underchat
`4d5cf9474bdcfe07f0a2aa96fbdaa4a2d9f890a4`, com `HEAD` idêntico a
`origin/main`. Pela interface Playwright visual foi selecionado exclusivamente
**Worker WWebJS**. O job `01a005c2-fb56-779d-af4a-28badc975ad5` gerou a
versão `v20260815141059542` entre `11:10:59.591` e `11:17:51.281-03`;
job e item terminaram `completed/success`, sem erro. A versão nova tornou-se o
default WWebJS.

A imagem possui ID/digest imutável
`sha256:769a11756f5c806c1ce261044aadb5ae50895bac959d65d755036a424893b0b1`.
A execução isolada da própria imagem confirmou pacote `1.34.130`, método
`_ensureWWebJSUtilitiesAfterAuthReady`, evento de reinjeção e as cercas de
documento, bridge e reinjeção incompleta.

A imagem foi transferida integralmente aos dois servidores por
`docker save | zstd | ssh | zstd -d | docker load`, com `pipefail` nas duas
pontas. Ambos apresentaram o mesmo image ID e pacote executável `1.34.130`.
Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` mostrou quatro
entradas antes de **Recriar Todos**. A renovação criou quatro warms PostgreSQL,
todos `ready`, `running/healthy`, restart zero, sem `last_error`, pacote
`1.34.130` e imagem exata `sha256:769a1175...`:

- Server 1: `01a005cc-7e59-7538-bc36-2629c9d70e31` e
  `01a005cc-7e92-77ba-836b-9c4332f6c11c`;
- Server 2: `01a005cc-7e1a-763d-89f6-9060c2301809` e
  `01a005cc-7e75-739d-8254-afdc0dc13292`.

Antes de qualquer limpeza, `docker ps -a --filter ancestor=<image-id>` foi
executado para cada imagem WWebJS. A `1.34.129` foi preservada porque ainda é
usada pelo Wwebjs Legacy no Server 1 e também serve de rollback imediato. A
imagem default antiga continua usada por canais PostgreSQL. Somente a
`1.34.128`, tag `v20260815125346564`, digest `sha256:69bd233f...`, tinha zero
containers nos dois hosts e foi removida localmente; ela permanece recuperável
pelo Harbor. A folga voltou a 4,0 GB no Server 1 e 4,7 GB no Server 2.

O próximo passo é repetir visualmente o canário **Wwebjs Legacy** volume para
PostgreSQL com a `1.34.130`. Ele só conta como ciclo funcional WWebJS **2/5**
quando journal, revisão ativa, backend PostgreSQL de worker/runtime, conexão
nativa forte com ACK, ausência de QR, saúde/digest/pacote do container e
exclusão explícita do volume-fonte estiverem simultaneamente provados. Rollback
seguro ou volume preservado continuam excluídos.

### Canário `1.34.130` excluído: alvo WWebJS saudável recebeu timeout de recriação comum

O canário visual seguinte de **Wwebjs Legacy** volume para PostgreSQL usou a
migração `c14fad0f-fd15-4610-bd92-fcf5f830fcf7`, origem geração 65 e alvos
gerações 66/67. O checkpoint válido terminou com checksum
`12ebed9cda2b4d9910db6dc3582f66c37af42bc4f92a0f7d03bb22c616f85583`,
222.329.010 bytes, 904 arquivos, telefone `556192037138` e hash de identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.

A tentativa 1 encontrou um `ENOENT` transitório ao enumerar
`/app/data/wwebjs` logo depois do shutdown do Chromium. A tentativa 2 importou
corretamente o perfil no PostgreSQL: abriu a revisão 3251, montou o volume
fonte somente para leitura, validou checksum/identidade, importou 2.214
registros canônicos e continuou convergindo na geração 66, imagem
`1.34.130`, `running/healthy` e restart zero. O manager, porém, encerrou sua
espera antes dessa convergência terminar com
`recreated_worker_connection_state_was_not_confirmed` e abriu a tentativa 3.
Essa terceira tentativa colidiu com a geração 66 ainda viva e recebeu
`worker_runtime_removal_database_fence_changed`.

A causa não foi o novo gate de utilitários pré-`READY`: a geração 66 ainda não
havia alcançado `READY`. A causa foi o `WorkerCommandHandlerService` tratar a
migração protegida de armazenamento como recriação comum e usar apenas 60
segundos para confirmar a sessão. O perfil de 222 MB precisou de cerca de dois
minutos para importar e validar. Portanto, repetir/remover o alvo naquele
momento era prematuro e transformava progresso legítimo em colisão de fence.

O journal terminou `restored`, `attempt_count=3`,
`source_volume_preserved=true`; a geração 67 restaurada usa a imagem exata
`sha256:769a1175...`, pacote `1.34.130`, volume fonte em `/app/data`, está
`running/healthy`, restart zero, nativo `online`,
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR. A UI
voltou a 7/7 conectados e exibiu **Sessão legada restaurada**. Esta execução é
excluída e a contagem WWebJS permanece **1/5**.

### Correção Underchat: orçamento próprio e captura WWebJS quiescente

Os budgets de lifecycle agora separam três operações. Recriação comum continua
com 60 segundos; migração protegida volume/PostgreSQL recebe 240 segundos para
confirmar a sessão novamente **online**; handoff de provider permanece com 300
segundos. O watchdog da tentativa de migração continua em 300 segundos por
default, mas agora é derivado do mesmo módulo e nunca pode ficar menor que o
budget de confirmação mais uma margem de 60 segundos. O lease da claim também
é derivado do watchdog mais 30 segundos. Overrides documentados:

- `WORKER_SESSION_STORAGE_MIGRATION_CONNECTION_CONFIRMATION_WAIT_MS`;
- `WORKER_SESSION_STORAGE_MIGRATION_ATTEMPT_MS`.

O timeout maior é escolhido somente quando o payload passa por todas as cercas
de `isSafeSessionStorageMigration` ou
`isSafeSessionStorageMigrationRestore`. Esses caminhos também recusam
terminalização como `disponible`: a sessão preservada precisa voltar online.
Recriação direta, QR, reset destrutivo, provider handoff e canais sem os
metadados completos continuam com seus comportamentos anteriores.

Na captura WWebJS, depois de `shutdown()` e da confirmação de encerramento do
browser, o perfil LocalAuth exato precisa existir e ser diretório. Somente um
`ENOENT` transitório de enumeração pode ser repetido, no máximo três vezes com
250 ms entre tentativas. Erros de checksum, perfil inválido, symlink, arquivo
especial e todos os demais erros continuam fail-closed e não são repetidos.
Isso absorve a remoção tardia de diretório efêmero sem gastar uma das três
tentativas duráveis nem aceitar um snapshot incompleto.

Os contratos focados de budgets, snapshot, orquestrador, modelo, handler e
conexão WWebJS passaram **691/691**. Os testes comprovam o budget ordenado, a
repetição exclusiva de `ENOENT`, a ausência de repetição para erro de
integridade e, nos três providers, que uma migração protegida pode ultrapassar
o limite curto da recriação sem ser terminalizada antes da prova online. O
typecheck global, ESLint dos arquivos alterados, Prettier e
`git diff --check` também passaram. Ainda é obrigatório fazer commit e push
**antes** de novo build; depois, gerar/distribuir as imagens afetadas, renovar
warms e repetir o canário visual. Até a validação live, WWebJS continua
**1/5**.

### Build validado da correção de orçamento da migração (15/08/2026 11:53-03)

A correção de orçamento/captura descrita imediatamente acima foi commitada e
enviada antes do build no commit Underchat
`ef89cc75cc03f3561c2cdb3d7e78baf147fa4e95`, com `HEAD` idêntico a
`origin/main`. O build visual `01a005de-0270-70b7-9b82-ecfc2c46db85`, versão
`v20260815144030832`, iniciou em `15/08/2026 11:40:31-03` e terminou
`completed`, sem erro, em `11:53:22-03`. O Worker WWebJS terminou em 6m58s e o
Balance API em seguida.

Artefatos imutáveis produzidos:

- WWebJS `harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260815144030832`,
  image ID `sha256:e82fc07d2bcb7983e7793c1a449d1b88044067354f58181bd4542389e7f30a41`;
- Balance API `harbor.devunder.com/underchat/balance/under-balance-api:v20260815144030832`,
  image ID `sha256:0c2640191581c90309597ea902f913c923c65d9c4542d1278051e9a25f3ceff4`.

A execução isolada do WWebJS confirmou o fork `1.34.130`. O conteúdo compilado
do worker contém a repetição limitada `retryLegacySessionVolumeSnapshot`, a
classificação exclusiva de `ENOENT` e a validação
`wwebjs_legacy_session_profile_invalid`. O Balance compilado contém os novos
budgets de storage migration e a seleção cercada
`protectedSessionStorageMigration`. Portanto, o próximo passo live é
distribuir estes IDs exatos, atualizar o Balance nos dois servidores, renovar
os warms WWebJS e recriar uma vez o Wwebjs Legacy ainda em volume com a imagem
nova antes de repetir o canário volume para PostgreSQL. A contagem continua
**1/5** até uma migração completar todas as provas e excluir explicitamente o
volume-fonte.

### Rollout `v20260815144030832`, warms e recriação-base WWebJS

As imagens imutáveis do build acima foram transferidas aos Servers 1 e 2 por
`docker save | zstd | ssh | zstd -d | docker load`, sempre com `pipefail` nas
duas pontas. O Balance foi promovido de forma transacional e sequencial nos
dois hosts, aprovando exclusivamente o digest
`sha256:0c2640191581c90309597ea902f913c923c65d9c4542d1278051e9a25f3ceff4`.
Ambos terminaram `running/healthy`, restart zero, com `PHASE=complete` no
journal local do rollout. Os aliases de worker continuaram exatos e recentes:
WWebJS `sha256:e82fc07d...`, Baileys `sha256:b9b82...` e WhatsMeow
`sha256:eac453...`.

Os quatro warms WWebJS foram renovados visualmente depois da promoção. Todos
usam a imagem exata `sha256:e82fc07d...`, pacote `1.34.130`, estão
`running/healthy` e têm restart zero:

- Server 1: `warm-01a005fc-3871-7432-8ab6-a670033ef200` e
  `warm-01a005fc-3858-7088-a812-bd8859aa1469`;
- Server 2: `warm-01a005fc-3888-774d-9beb-1fdac09ad12c` e
  `warm-01a005fc-3643-7154-a4a7-f30b5e73673a`.

Antes da nova migração, a recriação comum com preservação de sessão do
**Wwebjs Legacy** foi executada pela UI. Ela terminou em aproximadamente 19
segundos na geração 68, manteve o volume legado, alcançou estado nativo
`online`, `connected/authenticated/sessionValid=true`, ACK verdadeiro, sem QR,
container `running/healthy`, restart zero e pacote `1.34.130`. Isso comprova
que o budget de 60 segundos e o fluxo principal de recriação comum não foram
afetados pela correção anterior.

### Canário excluído `7edbe7a8`: timeout incorreto somente na finalização PostgreSQL

A migração visual seguinte do **Wwebjs Legacy** volume para PostgreSQL teve ID
`7edbe7a8-a3e2-4ea6-8c45-b8ff8426d23f`, origem geração 68, checksum
`be43b2223f643899f0917776baf4caa62530e4fa4681482363cafe093a9dd455`,
206.485.527 bytes, 904 arquivos, telefone `556192037138` e hash de identidade
`6cb9d762462b08fdf2ef2f7af184794c327ccd55a9fae845f723850edd5bec14`.

O primeiro alvo importou corretamente 2.214 registros canônicos, promoveu a
revisão 3252 e chegou a `online`/ACK em cerca de 178 segundos, dentro do novo
budget de 240 segundos. Assim, a correção de orçamento do cutover funcionou.
Depois da validação, o orquestrador executou corretamente um segundo boot
PostgreSQL -> PostgreSQL para provar que a revisão promovida inicia sem o
volume-fonte. Esse comando, porém, foi criado com
`includeMigrationMetadata=false`: além de retirar volume/checksum, retirou
também o `session_storage_migration_id`. O handler deixou de reconhecê-lo como
parte da migração e aplicou o timeout comum de 60 segundos. O WWebJS ainda
estava convergindo no estado `handoff_validation`, portanto a finalização
falhou prematuramente com `session_storage_migration_target_not_ready` e abriu
retries que mais tarde esgotaram o watchdog.

O rollback terminou de forma segura às `12:28:24.994-03`: journal `restored`,
três tentativas, `last_error=session_storage_migration_attempt_timeout`,
`source_volume_preserved=true`, sem solicitação nem confirmação de exclusão do
volume. A geração 72 restaurada usa `legacy_volume`, o volume original em
`/app/data`, imagem `sha256:e82fc07d...`, pacote `1.34.130`, está
`running/healthy`, restart zero, nativo `online`,
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR. A UI
voltou a 7/7 conectados. Esta execução é excluída e WWebJS continua **1/5**.

### Correção: identidade mínima na finalização protegida

A finalização PostgreSQL agora possui escopo de metadados explícito:
`none`, `identity` ou `full`. Cutover e restauração PostgreSQL -> volume
continuam usando os metadados completos e as mesmas cercas. A etapa final usa
somente `session_storage_migration_id`; nunca encaminha
`legacy_session_volume_name`, checksum nem `previous_session_storage`. Dessa
forma ela preserva a identidade imutável no journal e recebe o budget online
de 240 segundos, mas não pode montar/importar novamente o volume de rollback.

Queue e consumer aceitam essa forma apenas quando a ação é `recreate`, a
origem é `worker_update`, o destino é PostgreSQL, provider e servidor não
mudam, os flags são não destrutivos, o UUID é válido e volume/checksum estão
ausentes. No Balance, o budget longo exige adicionalmente UUID de operação e
fingerprint semântico SHA-256 do journal. Um comando sem essas provas continua
sendo recriação comum de 60 segundos. A classificação nova altera somente a
espera por reconexão online; resolução/montagem de volume, importação, remoção
de runtime, fences destrutivas e handoff de provider continuam nos predicados
anteriores.

Os contratos cobrem aceitação/redrive da identidade mínima, rejeição de UUID,
volume, checksum, storage anterior, provider, servidor ou flag destrutiva
indevidos; payload do orquestrador sem metadados do volume; espera longa para
Baileys, WWebJS e WhatsMeow; e manutenção do timeout curto para recriações
PostgreSQL comuns. Após integrar as mudanças simultâneas do control plane,
passaram **676/676** testes focados e o typecheck global voltou a passar;
ESLint dos arquivos alterados, Prettier, localização dos testes e
`git diff --check`. A próxima etapa obrigatória é commit/push desta correção
antes do build exclusivo do Balance, seguida de rollout transacional e nova
execução visual do mesmo canário.

### Build conjunto dos quatro artefatos no commit `5fc86da9d`

Por solicitação explícita, a rodada seguinte não gerou somente o Balance. O
build visual `01a0061b-8459-746e-99eb-6eaf9c256b38`, versão única
`v20260815154741785`, foi iniciado depois de `main` e `origin/main` apontarem
para `5fc86da9d`. O job executou serialmente e terminou `completed`, com os
quatro itens `success`, entre `12:47:42.432-03` e `13:08:22.141-03`:

- WWebJS: `12:47:42.432`–`12:54:30.579`;
- Balance API: `12:54:30.702`–`13:01:07.897`;
- Baileys: `13:01:08.169`–`13:06:50.653`;
- WhatsMeow: `13:06:50.781`–`13:08:22.041`.

Artefatos locais/publicados e seus IDs imutáveis:

- Baileys `under-worker-baileys:v20260815154741785`,
  `sha256:ca56a727cd5058b1aebb5d44da806f1ce99b6639be9ed515231d3c934d2bef9c`;
- WWebJS `under-worker-wwebjs:v20260815154741785`,
  `sha256:7cf3347698ac3d3a01404807788191b2576cfde95c668e7cceb05b282472d343`;
- WhatsMeow `under-worker-whatsmeow:v20260815154741785`,
  `sha256:10b9433713df3e331db10f0b62b91037237cb5cb8a0a903242b2fe87f0060969`;
- Balance API `under-balance-api:v20260815154741785`,
  `sha256:a33d57e3cbc2ba7461fab9884f1ed6a9f3c6ee0dbafc40f4625bc16b205fab78`.

A inspeção isolada confirmou Baileys `1.0.29`, WWebJS `1.34.130`, o gate
`_ensureWWebJSUtilitiesAfterAuthReady`, suporte `NATS_TLS` no binário
WhatsMeow, `NATS_CONNECTION_NAME` nos workers Node e, no Balance compilado, a
classificação `isSafeSessionStorageMigrationFinalization` e a conexão
administrativa `underchat-worker-command-finalizer`. Nenhum artefato foi
pareado, distribuído ou promovido antes dessas provas. O próximo passo é
commit/push deste registro, parear a versão inteira, transferir os quatro IDs
aos dois hosts, promover o Balance transacionalmente, renovar warms de todos
os providers e somente então repetir o canário volume -> PostgreSQL.

### Rollout visual concluído e canário WWebJS volume -> PostgreSQL `f4c52892`

O operador concluiu pela tela a instalação de `v20260815154741785`, a troca
dos warms e a recriação-base dos canais. A inspeção posterior comprovou nos
runtimes e warms os IDs imutáveis `ca56a727...` (Baileys), `7cf3347698ac...`
(WWebJS), `10b9433713df...` (WhatsMeow) e `a33d57e3...` (Balance), containers
saudáveis e sem reinícios. Os sete canais estavam nativamente online, com
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR. A flag
local `BALANCE_IMAGE_ROLLOUT_ENABLED=false` foi desabilitada pelo operador e
deve permanecer assim. Toda instalação, pareamento ou promoção futura deve ser
executada pela tela de instalação; não instalar manualmente nos servidores.

O segundo canário funcional WWebJS volume -> PostgreSQL foi iniciado
visualmente às `13:53:40-03`, migração
`f4c52892-9156-470f-944f-2d9581ee9a67`, origem geração 73 e destino final
geração 75. O snapshot tinha checksum
`484736fa12621b74d004a3cafc1ffe5965eb18e6660dba64bf33032db43471b2`,
212.761.507 bytes e 932 registros no manifesto. O alvo importou e promoveu a
revisão 3253; a finalização PostgreSQL -> PostgreSQL preservou somente a
identidade da migração, recebeu o budget protegido de 240 segundos e terminou
online/ACK às `13:58:41.143-03`, antes do deadline `13:58:45.005-03`. Isso
comprova em produção a correção `5fc86da9d`: nenhuma informação de volume foi
reintroduzida na finalização e a operação protegida manteve sua identidade.

A exclusão do volume-fonte foi confirmada pela UI às `13:59:26-03`. O journal
terminou `completed`, tentativa durável 1, `source_volume_preserved=false`,
`volume_deleted_at` preenchido; `docker volume inspect` confirmou a ausência
do volume. A geração 75 ficou `online`, ACK verdadeiro, sem lifecycle pendente,
imagem exata `sha256:7cf334...`, `running/healthy`, restart zero e sem mount.
Esta execução eleva a contagem funcional WWebJS para **2/5**.

O canário, embora seguro e funcional, revelou uma latência evitável e por isso
não conta como execução limpa de performance. Depois de congelar e retomar o
perfil conectado, o checkpoint canônico foi concluído com 2.214 registros. Uma
navegação curta durante o resync de estado substituiu o documento entre o
checkpoint e o gate final de utilitários. O flight antigo chamou
`_ensureWWebJSUtilitiesAfterAuthReady` com o epoch anterior e encerrou com
`wwebjs_ready_utility_document_replaced`. A sessão não foi perdida e nenhum QR
foi produzido, mas o worker tratou o erro como reconnect interno comum e
aguardou 60 segundos antes de convergir. Os logs também provaram que já havia
um flight sucessor serializado para o documento novo.

A correção seguinte deve manter o comportamento fail-closed: um flight antigo
jamais pode reinjetar utilitários num documento substituto arbitrário. Apenas a
substituição comprovadamente pertencente à sequência de navegação já observada
pelo próprio cliente pode ser classificada como `navigation superseded`, para
que o flight sucessor assuma o readiness imediatamente. O teste negativo
existente de troca arbitrária de documento deve continuar passando, além de um
novo contrato provar uma única emissão de `ready` no documento atual. Não
reduzir os delays globais de reconnect nem relaxar as cercas dos demais
providers. Após a correção: documentar, commit/push do fork, publicar nova
versão, integrar na Underchat, commit/push antes de buildar os quatro artefatos
e instalar exclusivamente pela tela.

### Fork WWebJS `1.34.131`: sucessão imediata do readiness após navegação

A correção mantém dois resultados distintos. Se o `performance.timeOrigin`
mudar sem avanço da sequência monotônica de navegação do frame principal, o
gate continua terminando com `wwebjs_ready_utility_document_replaced`, não
reinjeta nada e falha fechado. Quando o próprio handler do cliente já observou
e numerou uma navegação mais nova, o flight antigo termina com o novo código
transitório controlado `wwebjs_ready_utility_navigation_superseded`. Esse
código é aceito somente pelo serializador interno de navegação; não transforma
falhas de identidade, checkpoint, bridge, sessão ou provider em retry.

O handler de `framenavigated` passa a executar um novo `inject()` em toda troca
de documento anterior ao `READY`, mesmo se o WhatsApp já tiver recriado
`window.WWebJS`. O novo inject reinstala o bridge ligado ao documento e reclama
um flight sucessor serializado. O flight anterior nunca escreve no documento
novo; o sucessor refaz autenticação, checkpoint, utilitários e prova online
integralmente. Após `READY`, o comportamento permanece inalterado. Nenhum delay
global de reconnect, regra de volume, codec canônico, armazenamento ou caminho
dos providers socket foi modificado.

Três contratos novos provam: handoff do gate antigo sem reinjeção; `inject()`
obrigatório numa navegação pré-READY ainda que o namespace exista; e execução
única do sucessor atrás do erro transitório controlado. O teste negativo de
troca arbitrária continua passando. O arquivo focado terminou **33/33** e a
matriz offline ampliada **534 passing / 1 pending**; o pending é apenas a
instalação PostgreSQL concorrente opcional sem sua URL externa. O `npm test`
global continua dependendo de `WWEBJS_TEST_REMOTE_ID` e abortou na coleta como
baseline documentado, sem uso de credencial fictícia. ESLint, Prettier,
`git diff --check`, cache fixado `2.3000.1044338228` e verificação dos 158
arquivos do pacote passaram.

A versão `1.34.131` foi commitada e enviada antes de publicação no fork como
`b193bf1c79ef0c1b493c26e53dffab4d8f4a2356`, com `HEAD` idêntico a
`origin/main`. O próximo passo é publicar, reler e inspecionar o tarball real;
depois integrá-lo na Underchat, ampliar o contrato da dependência, testar,
documentar e fazer commit/push antes do build conjunto dos quatro artefatos.

### Publicação e integração Underchat do WWebJS `1.34.131`

O pacote foi publicado no registry interno e relido pelo mesmo endpoint usado
pela Underchat. O artefato real possui shasum
`d83f5776fbe2df4543e9caa4b25c0abd33ff6900`, integrity
`sha512-3A03jS8Kdc2iR1OnoKjxVToZEEDP8qw0xxWL04NY9FwgcgcG00bddFtZmQqxkdeRVzzfD+RTCDpWzKsiu7IM7Q==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.131/whatsapp-web.js-1.34.131.tgz`.
A extração independente confirmou versão `1.34.131`, 158 arquivos e os
marcadores do código transitório, da sequência monotônica e do inject
pré-READY dentro do tarball publicado.

`package.json` e `pnpm-lock.yaml` passam a fixar exatamente esse tarball e sua
integrity. A instalação congelada em Node `24.12.0` confirmou a versão
executável. O contrato da dependência real preserva todas as cercas anteriores
e exige adicionalmente `TRANSIENT_NAVIGATION_ERROR_CODES`,
`wwebjs_ready_utility_navigation_superseded`, a captura da sequência esperada
e o inject pré-READY quando a navegação já foi observada. Os cinco arquivos de
contrato de dependência, conexão, PostgresSessionStore, snapshot legado e
orquestrador passaram **206/206**; o typecheck global também passou.

As alterações locais simultâneas do operador na listagem/configuração de
canais foram preservadas e não pertencem a este commit. Antes do próximo build
conjunto, somente os arquivos da integração WWebJS e esta memória devem ser
commitados/enviados. Depois, o build deve gerar os quatro artefatos — Baileys,
WWebJS, WhatsMeow e Balance — e a instalação deve ocorrer exclusivamente pela
tela, com `BALANCE_IMAGE_ROLLOUT_ENABLED=false` mantido.

### Build/instalação visual `v20260815171515133` e supersessão pelo Baileys `1.0.30`

Depois do commit/push da integração WWebJS `1.34.131`, o build visual conjunto
`01a0066b-ad3d-7403-9b5f-083aadc60d4e` gerou os quatro artefatos da versão
`v20260815171515133`. O job terminou `completed`, 4/4 itens `success`, entre
`14:15:15-03` e `14:34:31-03`: Baileys em 5m55s, WhatsMeow em 1m29s, WWebJS em
6m37s e Balance em 5m14s. Os IDs imutáveis foram:

- Baileys `sha256:508bf238ff1f8694e9ced90dff092b5398fa59bbc36e82e4ac7cf27d7626853d`;
- WhatsMeow `sha256:b301f41b54abadcee0f7f36333621f8b8c43d1cc171ea0243a3cc9b4d13a1357`;
- WWebJS `sha256:ac97fcb1d48ac4a58a8edc612311ca749090fa2d85a45794ab4403359fa0fb1f`;
- Balance `sha256:980f9b4291019f10e20e615760729d396019745c1e54e90c62b742ffed311613`.

O WWebJS compilado contém o pacote `1.34.131` e as quatro cercas novas de
sucessão de navegação. A versão inteira foi pareada pela UI. Server 1 e Server
2 foram reinstalados, um por vez, exclusivamente pela tela de servidor, com o
console visual aberto até o estado terminal. Server 1 concluiu às `14:42:53`
com 468 eventos, 0 avisos e 0 erros; Server 2 às `14:45:11`, com 260 eventos,
0 avisos e 0 erros. Ambos finalizaram todas as etapas como `Pronto`, incluindo
health check. A inspeção read-only do Server 1 confirmou os quatro aliases nos
IDs acima e o novo Balance `running/healthy`, restart zero. O console do Server
2 confirmou os digests imutáveis, o novo container Balance e a validação final.
`BALANCE_IMAGE_ROLLOUT_ENABLED=false` permaneceu inalterado.

Os 16 warms foram renovados visualmente por **Recriar Todos**. Depois da janela
normal de reposição, todos reapareceram `Pronto`. Os oito warms do Server 1
foram inspecionados: Baileys, WWebJS e WhatsMeow usam exatamente os IDs novos,
todos `running/healthy` e com restart zero. Esta versão, contudo, foi
supersedida antes dos canários funcionais: às `14:46:19-03`, `main` recebeu o
commit do operador `b67bbda2294c1d9ee4033a64ecc63089d8acd7b7`, que integra Baileys
`1.0.30` e altera a reconciliação do lifecycle. Portanto, nenhum ciclo sobre
`v20260815171515133` deve ser contado na bateria final; é obrigatório gerar e
instalar novamente **os quatro artefatos** a partir do novo `HEAD`.

### Correção do contrato writerless antes do novo build

A instalação congelada do commit `b67bbda22` confirmou o pacote executável
Baileys `1.0.30`. A primeira execução integral do contrato do
`WorkerCommandHandlerService` encontrou uma falha no teste recém-adicionado:
`1 failed / 541 passed`. A produção exige corretamente que um runtime legado
anterior às identidades de writer apresente as colunas
`runtime_capability_hash` e `session_writer_epoch` como `NULL`; campos ausentes
continuam falhando fechado. A fixture compartilhada, porém, omitia as colunas,
logo o caso positivo não representava uma linha real do PostgreSQL e terminava
em `replacement:database_identity_changed`.

O helper de teste agora aceita metadados iniciais explícitos. Somente o caso
writerless injeta os dois `NULL` e `source_provider=NULL`, preservando o objeto
mutável usado pela revogação CAS e pela prova pós-condição. Nenhuma guarda de
produção foi relaxada. A suíte integral do handler passou **542/542**, a
instalação congelada passou, ESLint/Prettier e `git diff --check` passaram e o
typecheck global terminou sem erros. Esta correção e esta memória devem ser
commitadas e enviadas antes de abrir o novo build visual 4/4.

### Baseline `v20260815175352694`, instalação visual e warms

A correção do contrato e o registro anterior foram commitados/enviados em
`b039db5de5518b498b37d38c8a85befc0fc23d2b`, com `HEAD` idêntico a
`origin/main` e somente `tmp/` fora do Git. A instalação congelada confirmou o
Baileys executável `1.0.30`. No fork, o teste afetado passou **102/102** e a
suíte integral passou **39/39 suítes, 579/579 testes**.

O build visual conjunto `01a0068f-0a36-77b1-b278-e7cffa7d7229`, versão
`v20260815175352694`, iniciou às `14:53:52-03` e terminou `completed` às
`15:13:40-03`, com os quatro itens `success`:

- Balance API `14:53:52`–`15:00:07`, imagem
  `sha256:17b1a15cf3691bbfde7ea384c5b5b3e2d2145bd93d9dc8fb48ac738c34ff3334`;
- Baileys `15:00:07`–`15:05:50`, imagem
  `sha256:d8d602df284bfbf557968bd5ca703589e75e68d1857182d7b64d61e28fe1a4bc`;
- WhatsMeow `15:05:50`–`15:07:12`, imagem
  `sha256:e6268fb5ef7ca101603586b7b383d5c0cd10c357283890a8df70d8d497055750`;
- WWebJS `15:07:12`–`15:13:40`, imagem
  `sha256:bdf32d0f9eb9ec1ad0d035c2744a7f7fd46fb00671fa9412aecc547131142502`.

A inspeção dos artefatos confirmou Baileys `1.0.30`, WWebJS `1.34.131` e seus
marcadores de sucessão de navegação. O Balance compilado contém
`isSafeSessionStorageMigrationFinalization` e o caminho
`liveness_writerless_legacy_replacement_retired`. Os quatro registros ficaram
default e a instalação ocorreu exclusivamente pela tela. Duas solicitações
visuais chegaram a se sobrepor; a cerca host-side recusou a segunda com
`managed rollout lock is busy`, aguardou sem mutação concorrente e serializou
as execuções. Esse evento explica a alternância temporária do console entre um
host concluído e outro ainda baixando camadas; não houve instalação manual.

Server 2 terminou às `15:20:41-03` e Server 1 às `15:27:42-03`. A prova final
read-only em ambos confirmou os quatro aliases exatamente nos IDs acima. Os
dois Balances estão `running/healthy`, restart zero. A reposição automática
posterior criou 16/16 warms novos. Em **cada** servidor existem exatamente 4
Baileys, 2 WWebJS e 2 WhatsMeow; todos usam o ID definitivo do provider,
`running/healthy`, restart zero. `BALANCE_IMAGE_ROLLOUT_ENABLED=false` não foi
alterado. Este é o baseline obrigatório para todas as próximas contagens; os
warms e imagens da versão supersedida não entram nos resultados funcionais.

### Supersessão seletiva do WhatsMeow após o commit `e144f3246`

Depois do término do build anterior, `main` recebeu às `15:19:39-03` o commit
`e144f3246f74245b84e3bc7ae30fc14e304ec03f`, restrito ao fork WhatsMeow. A
alteração torna o upgrade SQLite legado sensível à existência real das tabelas
antigas e amplia as provas de isolamento de sessão; Baileys, WWebJS e Balance
não foram modificados por esse commit. Por decisão operacional explícita, o
próximo build deve gerar **somente WhatsMeow**. Os outros três IDs de
`v20260815175352694` continuam sendo o baseline válido e não devem ser
recompilados sem mudança correspondente.

Antes do build seletivo, `HEAD` e `origin/main` foram confirmados idênticos em
`e144f3246`. A suíte integral do fork terminou sem falhas com `go test ./...`,
incluindo `store/sqlstore`, e o worker externo também passou integralmente com
`go test ./...`. O registro desta supersessão precisa ser commitado e enviado
antes de abrir o build visual. A nova imagem deve ser pareada e instalada
exclusivamente pela tela nos dois servidores; depois os aliases, containers e
warms WhatsMeow devem ser provados pelo ID imutável novo. As imagens Baileys,
WWebJS e Balance não podem mudar durante essa instalação seletiva.

O build seletivo foi executado pela tela no job
`01a006b5-185b-755c-b5d4-e86811498f19`, versão
`v20260815183526683`, das `15:35:26` às `15:36:56-03`. O job contém um único
item, `whatsmeow`, terminado como `success`; sua imagem imutável é
`sha256:b1f9ead1a0f4cda34300f84a1eabfd3e93f43f9847d06959745648ff74f66ea2`.
O novo registro tornou-se default somente para WhatsMeow. Os defaults dos
outros três tipos não foram alterados.

Server 1 e Server 2 foram instalados exclusivamente pela tela. O console
visual terminou `Concluída`, com 329 eventos, 0 avisos e 0 erros na execução
acompanhada. A inspeção read-only posterior provou em **ambos** os servidores:

- Baileys permaneceu em
  `sha256:d8d602df284bfbf557968bd5ca703589e75e68d1857182d7b64d61e28fe1a4bc`;
- WWebJS permaneceu em
  `sha256:bdf32d0f9eb9ec1ad0d035c2744a7f7fd46fb00671fa9412aecc547131142502`;
- Balance permaneceu em
  `sha256:17b1a15cf3691bbfde7ea384c5b5b3e2d2145bd93d9dc8fb48ac738c34ff3334`;
- somente WhatsMeow avançou para
  `sha256:b1f9ead1a0f4cda34300f84a1eabfd3e93f43f9847d06959745648ff74f66ea2`.

A reposição automática terminou com 16/16 warms `healthy`, restart zero: em
cada servidor há exatamente 4 Baileys, 2 WWebJS e 2 WhatsMeow. Todos os warms
WhatsMeow usam o ID novo e os warms dos demais providers preservam os IDs do
baseline. Este é o baseline seletivo válido para a continuação da bateria
funcional; não gerar novamente os outros artefatos enquanto eles não tiverem
mudança de código correspondente.

### Auditoria ponta a ponta dos canais em QR e recuperação SQLite WhatsMeow

Esta rodada foi executada sobre os 1.077 workers ativos dos 11 servidores
informados pelo operador. A leitura do PostgreSQL foi somente de diagnóstico e
a inspeção de cada volume foi feita pelo `worker_id` e pelo
`worker_runtime.session_volume_name` exatos, inclusive quando o runtime veio
de um warm. Nenhuma sessão, status ou linha de produção foi alterada.

#### Rodada 1 — inventário integral e separação por causa real

O snapshot tinha 489 workers `blocked`, 343 `disponible`, 175 `online`, 5
`recreating`, 51 `stopped`, 13 `mismatched` e 1 `offline`. Os 343 apresentados
pela UI como **Aguardando leitura do QR code** se dividiam em 115 Baileys, 184
WhatsMeow e 44 WWebJS.

A inspeção canal a canal mostrou resultados distintos por provider:

- nos 115 Baileys, 109 volumes não tinham `creds.json`, 4 tinham JSON inválido
  e 2 tinham credencial não registrada. Nenhum possuía sessão autenticada
  recuperável;
- nos 184 WhatsMeow, 156 bancos tinham exatamente um device legado pareado em
  `whatsmeow_device`, cursor legado v14/compat 8 e nenhuma identidade no esquema
  atual. Os outros 28 não tinham device legado ou atual pareado;
- nos 44 WWebJS, 27 perfis estavam em quarentena, 26 deles depois de três
  restaurações persistentemente `UNPAIRED`; 16 não tinham o conjunto mínimo de
  artefatos duráveis e somente 1 ainda tinha um perfil ativo completo.

Portanto, 156 dos 343 canais em QR eram falsos negativos recuperáveis, todos
WhatsMeow. Os demais 187 realmente não tinham uma sessão autenticável estática
que justificasse promovê-los a conectados.

#### Rodada 2 — causa raiz e correção no fork embarcado WhatsMeow

O fork havia trocado o cursor `whatsmeow_version` pelo cursor genérico
`whatsapp_store_version`. Ao abrir um SQLite legado, o upgrader não reconhecia
o cursor antigo, criava um esquema v17 `whatsapp_*` vazio ao lado do device
válido `whatsmeow_*` e `GetFirstDevice()` passava a enxergar zero devices. O
worker então publicava `has_store_id=false`, ignorava o bootstrap da sessão e
abria QR.

O commit `e144f3246f74245b84e3bc7ae30fc14e304ec03f` corrige esse caminho de forma
fail-closed:

- aceita somente SQLite legado v14/v15, compatível, com exatamente um device
  pareado;
- quando ainda não existe esquema atual, adota o cursor legado e deixa as
  migrações v15 → v17 converterem os dados;
- quando o runtime já deixou o esquema v17 vazio ao lado do legado, exige todas
  as tabelas atuais presentes e vazias antes de retirar somente esse esquema
  vazio e refazer a conversão;
- esquema atual parcial, populado, versão inesperada ou múltiplos devices são
  recusados sem mutação;
- a migração SQLite v16 deixou de executar o índice PostgreSQL com `INCLUDE` e
  agora cria um UUID de escopo único antes de copiar todas as projeções. Isso
  elimina tanto o erro de sintaxe SQLite quanto o panic de session ID não UUID.

Esse código **não cria tabelas legadas**. `prepareLegacySQLiteUpgrade()` só é
chamado quando o dialect é SQLite e só reage a `whatsmeow_*` que já existem no
arquivo. Banco SQLite novo continua criando exclusivamente `whatsapp_*`, fato
preso pelo teste `TestFreshSchemaUsesOnlyGenericWhatsAppTableNames`. No
PostgreSQL compartilhado o worker usa `NewWithDB()` e
`ValidateSchemaVersion()`; ele não chama `Upgrade()` nem essa recuperação
legada.

#### Rodada 3 — fixture real e três conexões WhatsMeow isoladas

Uma cópia consistente de SQLite real inicialmente revelou dois defeitos na
migração: o índice `INCLUDE` no arquivo SQLite e o fallback de JID como
`session_id`. Depois das correções, a fixture real passou
`TestUpgradeRecoversExternalLegacySQLiteFixture`: um device pareado foi
preservado, uma única projeção `whatsapp_device` foi criada e o cursor legado
deixou de existir na cópia migrada.

Em seguida foram testadas três cópias independentes, duas no Servidor 1 — uma
originada de warm e outra de volume direto — e uma no Servidor 2. Cada probe
usou um volume Docker temporário próprio, não recebeu NATS, manager nem URL do
banco central e executou uma consulta autenticada ao servidor do WhatsApp. Os
três terminaram `authenticated_transport_confirmed`, conectados e autenticados,
sem QR. Os containers originais permaneceram `running/healthy`; containers,
volumes, binários e bancos temporários foram removidos e a ausência foi
confirmada.

#### Rodada 4 — prova negativa WWebJS

Dois perfis em quarentena, em servidores diferentes, foram copiados e abertos
com a imagem WWebJS corrente usando a mesma política real
`webVersionCache: none`. Ambos emitiram QR, confirmando a razão
`persistent_unpaired_restore_exhausted` sem expor o QR. O único perfil ativo
com artefatos duráveis também foi testado: sua imagem original `1.34.11`
falhou; com `1.34.130` e depois com o pacote real `1.34.131` ele não chegou a
`READY` nem a transporte autenticado e terminou por timeout de 90 segundos.
Logo nenhum dos 44 casos WWebJS auditados pode ser recuperado automaticamente
com segurança. As cópias, browsers, volumes, scripts e containers de prova
foram removidos; os perfis originais continuaram parados e intactos.

#### Rodada 5 — regressão e comportamento esperado após subir

Passaram `go test ./...` tanto no módulo completo de
`apps/worker_whatsmeow` quanto no fork `forks/whatsmeow`, além de
`git diff --check`. Os contratos incluem banco novo sem tabela legada, versão
legada não suportada, esquema atual vazio recuperável, esquema atual populado
ou parcial recusado e fixture SQLite real opcional.

Quando a nova imagem WhatsMeow for instalada e os canais forem recriados ou
reiniciados pela tela, cada um dos 156 volumes válidos executará a conversão no
startup antes de `GetFirstDevice()` e seguirá o bootstrap autenticado. Os 28
WhatsMeow sem device, 115 Baileys sem credencial válida e 44 WWebJS sem perfil
autenticável devem permanecer corretamente aguardando QR. Nenhuma promoção de
status é fabricada apenas pela presença de arquivos.

O próximo build permanece **seletivo somente para WhatsMeow**, conforme a
supersessão anterior. Pareamento, instalação nos servidores e renovação dos
warms devem ocorrer exclusivamente pela tela, mantendo
`BALANCE_IMAGE_ROLLOUT_ENABLED=false`; nenhum rollout definitivo foi feito
manualmente nesta auditoria.

### Canários de recriação após o rollout seletivo WhatsMeow

Depois da instalação visual de `v20260815183526683`, a interface visual de
**Canais** foi usada sempre com **Manter a conexão atual**. O canal
`WhatsMeow Legacy` validou três recriações consecutivas no backend
`legacy_volume`: gerações `8→9`, `9→10` e `10→11`, com aproximadamente 2,40s,
2,44s e 3,52s entre `recreate_bootstrap_started_at` e o marker terminal. O
canal `Meow Maycon` validou três recriações consecutivas no backend
`postgres`: gerações `4→5`, `5→6` e `6→7`, com aproximadamente 2,31s, 3,28s e
3,39s.

Os seis ciclos terminaram com worker `online`, lifecycle nulo, marker terminal
na geração corrente, fato nativo `online/connected/authenticated/sessionValid`,
ACK verdadeiro e `qrAvailable=false`. A inspeção dos containers finais
confirmou `running/healthy`, restart zero e imagem
`sha256:b1f9ead1a0f4cda34300f84a1eabfd3e93f43f9847d06959745648ff74f66ea2`;
o legado manteve exatamente o volume homônimo montado em `/app/data`, enquanto
o PostgreSQL permaneceu sem mount de sessão. Não houve fallback, pairing ou
troca de backend. Esta rodada fecha **3/3 volume e 3/3 PostgreSQL** para
recriação WhatsMeow na imagem seletiva nova.

Também foi iniciado um canário de controle WWebJS PostgreSQL no canal
`Wwebjs`, geração `81→82`. Ele terminou corretamente online/ACK, sem QR e com
lifecycle limpo, mas levou aproximadamente 99,2s. A decomposição provou que
container, lease e abertura da revisão foram rápidos; o tempo ficou no replay
canônico protegido de uma revisão originalmente migrada de Baileys: primeira
importação de 2.315 registros, reload offline cercado, segunda selagem,
recuperação do transporte nativo após o stall controlado de 15s e registro dos
consumidores. Nenhum timeout global deve ser reduzido com base em um único
canário. A próxima rodada deve comparar outra revisão WWebJS antes de decidir
se a continuidade selada pode ser ampliada com as mesmas provas fail-closed.

### Rodada 6 — status terminal perdido entre o worker e o PgBouncer

O recorte posterior continha cinco canais `legacy_volume` em `recreating`: quatro
Baileys e um WWebJS. A inspeção foi somente de diagnóstico; nenhum status,
container, banco ou volume de produção foi alterado nesta rodada.

Três dos Baileys chegaram a produzir prova local forte de conexão: provider
`online`, sessão pronta, envio e recebimento disponíveis, autenticação válida e
QR ausente. Mesmo assim, repetiam `NotifyWorkerStatus failed`, voltavam a
projetar `worker_status_not_published` e deixavam o lifecycle central em
`recreating`. Outro Baileys tinha um terminal verdadeiro `401/logged_out`, mas
também não conseguia persistir a saída do lifecycle. O WWebJS era um runtime
antigo sem writer/capability e com container já encerrado; a correção de
aposentadoria desse replacement órfão já existe no código atual do control
plane, mas a imagem observada ainda era anterior a ela.

A causa comum da perda de status dos workers Node foi confirmada no PostgreSQL.
O usuário restrito `whatsapp_worker_runtime` acumulou **215** erros
`SQLSTATE 26000`, com a mensagem `unnamed prepared statement does not exist`,
entre `2026-08-15T16:39:13.875Z` e `2026-08-15T18:52:52.491Z`. O caminho usa
PgBouncer `1.23.0` em `transaction pooling`; o pool compartilhado dos workers
enviava toda query parametrizada pelo protocolo estendido sem nome. Assim, a
publicação de `apply_worker_runtime_status` podia perder o prepared statement
no backend escolhido e o provider ficava pronto localmente sem receber o ACK
durável que encerra `recreating`.

`packages/services/workerPostgresPool.ts` agora instala, em cada conexão nova,
uma adaptação de protocolo com estas propriedades:

- toda query parametrizada sem nome recebe o nome determinístico
  `underchat_worker_<sha256-do-sql>` limitado ao tamanho aceito pelo PostgreSQL;
- somente o texto SQL entra no hash; valores, capability, IDs e credenciais
  nunca entram no nome nem em logs;
- queries já nomeadas, queries sem parâmetros, protocolo explicitamente
  `simple` e instâncias de `Query` pertencentes ao chamador permanecem
  inalteradas;
- overloads com callback e todas as demais opções do `QueryConfig` são
  preservados;
- a instalação ocorre no evento `connect` do único pool e, portanto, cobre
  tanto `pool.query()` quanto clientes de `pool.connect()`, incluindo status,
  telemetria, stores e Drizzle.

Isso permite que o rastreamento nativo de prepared statements do PgBouncer
reprepare a mesma consulta no backend atribuído, eliminando especificamente o
estado sem nome que gerou o `26000`. A versão `1.23.0` observada, porém, mantém
`max_prepared_statements=0` por padrão. O manifesto declarativo dos poolers RW e
RO em `underchat-argocd/database/pg-stack/pg-stack.yaml` agora fixa o valor em
`200`; sem isso, a consulta nomeada continuaria sem rastreamento em transaction
pooling. A ordem obrigatória do rollout é sincronizar primeiro o pooler e
confirmar o parâmetro não zero, e somente depois publicar os workers Node. Não
há migration, mudança de schema, criação de tabela legada, alteração nos forks
ou mudança de regra de status.

Os gates locais passaram: teste novo **6/6**, conjunto focado de quatro suítes
**35/35**, Prettier, ESLint e typecheck global sem erros. Nenhuma imagem foi
construída ou instalada e nenhum rollout foi executado nesta rodada, conforme a
restrição de corrigir somente o código. Após a próxima imagem dos workers Node
ser instalada, o resultado esperado é que uma prova forte `online` seja
persistida no mesmo ciclo e que terminais reais, como `401/logged_out`, também
saiam de `recreating` sem depender da substituição completa do container.
O manifesto do pooler passou `kubectl apply --dry-run=client` e
`git diff --check`; ele também não foi aplicado ao cluster nesta rodada.

#### Sub-rodada 6.1 — vagas fantasmas reduziam o paralelismo por servidor

O executor de recriação em massa já tinha teto local de 32 tarefas, suficiente
para ocupar as 22 vagas físicas da topologia atual de 11 servidores com duas
recriações simultâneas em cada um. O atraso adicional não era falta de
concorrência no processo. A admissão no PostgreSQL contava todo target
`processing` ou `enqueued` como uma das duas vagas do servidor até o target
chegar a um resultado terminal.

Esse contrato divergia do lifecycle real: o handler do worker libera no Redis
a vaga física logo depois de criar/adotar o novo container e persistir o
runtime. A confirmação final de conexão continua depois disso. Se ela demorava
ou não era persistida — inclusive pelo erro `SQLSTATE 26000` desta rodada — o
target permanecia `enqueued/recreating` e seguia ocupando uma vaga somente no
contador do PostgreSQL, embora o Redis já permitisse nova provisão física. Um
target preso reduzia o servidor de duas para uma recriação; dois targets presos
impediam qualquer novo canal daquele servidor de avançar.

O contrato foi separado em duas fases sem aumentar o limite físico:

- `processing` continua ocupando capacidade enquanto reserva e publica a
  recriação;
- `enqueued` ocupa capacidade apenas enquanto preserva uma chave e um token de
  slot ainda não observados como liberados;
- depois que `waitForRelease()` confirma que a chave Redis não pertence mais
  ao token da operação, o executor limpa somente a identidade do slot no
  target; a reconciliação do lifecycle permanece `enqueued`, durável e
  retryable, mas deixa de consumir vaga física;
- a limpeza exige correspondência exata de `target_id`, `lease_owner`, status
  `enqueued`, chave e token. Perda de lease ou token divergente não libera a
  cobrança no banco e segue pelo retry normal;
- a liberação do slot não é aceita como prova de conexão. O target só termina
  quando `completeTarget()` confirma o runtime/status da mesma operação.

O Redis permanece como barreira autoritativa de duas provisões por servidor;
portanto, a mudança elimina a vaga fantasma sem permitir um terceiro container
em criação simultânea. Targets antigos que já perderam a identidade do slot
podem ser redirigidos e reconciliados sem repetir a ação destrutiva. Não há
migration, mudança de schema ou alteração nos forks.

Os contratos específicos do repositório e executor passaram **30/30**. O
conjunto integrado de slot Redis, batch, executor, pool PostgreSQL, plugin e
persistência de status passou **84/84**. Prettier, ESLint e o typecheck global
passaram sem erros; a regressão adicional do handler e da projeção de status
passou **561/561** e os builds `service`, `worker_baileys` e `worker_wwebjs`
terminaram **3/3** com sucesso. Esta sub-rodada permaneceu restrita ao código:
nenhum dado, container, status ou deployment de produção foi alterado.

### Recriação WWebJS PostgreSQL — escrita derivada tardia e fork `1.34.132`

O segundo canário de comparação usou o canal `Wwebjs Legacy`, que apesar do
nome já estava em `postgres`, na revisão ativa `3253` originada por
`legacy_volume_migration`. A recriação visual com preservação de sessão foi da
geração `75→76`. Ela terminou corretamente `online`, com lifecycle nulo,
marker terminal da geração 76, estado nativo
`connected/authenticated/sessionValid=true`, ACK verdadeiro e sem QR, porém
levou aproximadamente 163,8s entre o bootstrap e o marker terminal.

A telemetria separou a demora de uma perda de sessão. Na primeira tentativa,
o replay protegido importou os 2.216 registros, recarregou o documento,
reimportou a mesma projeção e abriu o overlay de app-state com sete chaves. A
verificação offline encontrou as sete chaves **7/7 exatamente iguais** em ID,
bytes, timestamp e fingerprint durante 46 leituras por 5.001ms. O único
desvio era uma linha de versão derivada que uma transação nativa já enfileirada
gravou depois da barreira online e da primeira limpeza. Como a implementação
anterior esperava simultaneamente chaves exatas e tabelas derivadas vazias, a
linha não desaparecia sozinha; o fluxo falhou fechado com
`wwebjs_canonical_app_state_sync_key_verification_failed`, encerrou aquele
Chromium e repetiu duas importações completas. A segunda tentativa preservou a
sessão, recuperou o sync nativo e concluiu o catch-up oficial em 36.392ms.

O fork `1.34.132` corrige somente essa corrida. Quando todas as chaves já são
exatas, ele reprova duas vezes que a máquina de coleções continua ociosa,
mantém as chaves canônicas intocadas, limpa **uma única vez** apenas versões,
ações, mutações pendentes e missing keys reconstruíveis, e exige duas leituras
vazias estáveis separadas por um scheduling boundary. Chave ausente ou
divergente, coleção que volte a trabalhar ou material derivado que reapareça
continua falhando fechado no mesmo prazo. A telemetria nova registra somente
contagens agregadas da limpeza e das amostras; nenhum material criptográfico é
exposto. Não foi ampliada a continuidade selada do restart ativo nem removida
a segunda selagem, porque estes canários não fornecem prova suficiente para
relaxar esse limite com segurança.

Os testes focados cobrem o reparo sem reescrever a chave e a prova negativa de
material derivado persistente; junto dos casos de visibilidade tardia foram
`4/4`. A regressão `RemoteAuth` + toda a camada de sessão passou **501** testes,
com um teste de instalação concorrente opcional pendente. ESLint, Prettier,
cache Web `2.3000.1044338228`, conteúdo dos 158 arquivos do pacote e
`git diff --check` passaram. O fork foi commitado e enviado em
`333b0a0bd77b7315c463dcf4cbb5a748662971ea` antes da publicação. O pacote
`@wwebjs/whatsapp-web.js@1.34.132` foi publicado com shasum
`f181528d5803778bb55b5815448d57bb92ac8b57` e integrity
`sha512-qC2GSQcK2CbsoQW5jSZ0VLOaOCOmKgU/aqjYDHPHa1xsAC+acZBCw1iL7NCO4zmwAGWP2c2epCYsAq/AnN9XQw==`.

Pela regra seletiva vigente, a integração desta versão deve gerar pela tela
**somente Worker WWebJS**. Baileys, WhatsMeow e Balance não foram alterados e
não devem ser reconstruídos, promovidos nem ter seus warms trocados nesta
rodada. A instalação nos dois servidores e a renovação dos warms WWebJS também
continuam exclusivamente visuais, com `BALANCE_IMAGE_ROLLOUT_ENABLED=false`.

### Rollout operacional do WWebJS `1.34.132` e canários pós-correção

O operador concluiu pela interface o build/instalação antes da retomada dos
canários. O job `01a006dc-d5a8-71eb-bb08-f09fddd310e7`, versão
`v20260815191851048`, terminou `completed` entre `16:18:51.048-03` e
`16:37:51.884-03`. Embora a alteração desta rodada exigisse somente WWebJS, o
job executado pelo operador continha os quatro itens e todos terminaram
`success`. Isso não altera a regra para as próximas correções: gerar novamente
apenas o provider cujo código mudou.

Os dois servidores materializaram exatamente os mesmos image IDs:

- Baileys:
  `sha256:a5138c39b6c40ccb608678a2c804f5f1760316a6bd6e04b727e5e6b41cb5e8ee`;
- WWebJS:
  `sha256:90d3d0917051eaab1141dee9a0963289cb4083d9052f3122b18c387a59d16491`;
- WhatsMeow:
  `sha256:08db6e4d4ff48dbdeca96431a2c827733cdb27a8deb2fa8ce26a1f186ce0de74`;
- Balance API:
  `sha256:0084717802ab4efba7a93862d3603a9ad2ecded6b620be1b485fb8ffeaaa9f75`.

Os quatro warms WWebJS ficaram `running/healthy`, restart zero, dois por
servidor, e a execução dentro de um warm de cada host confirmou fisicamente
`@wwebjs/whatsapp-web.js@1.34.132`. Os sete canais estavam `online`, com
lifecycle nulo, prova nativa forte, ACK verdadeiro e QR ausente antes dos
novos testes.

Três recriações PostgreSQL com preservação foram acompanhadas no Playwright
visível sobre a imagem nova:

| Canal           | Geração | Operação                               | Duração bootstrap → terminal | Resultado                           |
| --------------- | ------: | -------------------------------------- | ---------------------------: | ----------------------------------- |
| `Wwebjs Legacy` | `77→78` | `01a0070b-8f12-70a4-92ad-713a400807e1` |                   `73,898 s` | online/ACK, sem QR, tentativa única |
| `Wwebjs`        | `83→84` | `01a0070d-eaa3-708e-b0e5-64f10b0c50a7` |                   `77,861 s` | online/ACK, sem QR, tentativa única |
| `Wwebjs Legacy` | `78→79` | `01a00710-7c9c-711a-8b57-3cc97b89a2dd` |                   `69,053 s` | online/ACK, sem QR, tentativa única |

Nas três gerações, todos os eventos do outbox terminaram `published` na
tentativa 1: respectivamente 12, 11 e 11 eventos, sem pendência ou dead-letter.
Os containers finais ficaram `healthy`, restart zero. Não ocorreu
`initialization_failed`, `client.failure_primary`,
`wwebjs_canonical_app_state_sync_key_verification_failed` nem segundo client.
Os perfis já entraram com `app_state_overlay_required=false`; por isso a
limpeza derivada nova não precisou ser acionada, mas o caminho exato que antes
levava 163,8 s completou duas vezes em cerca de 69–74 s, sem a reimportação
integral adicional.

Um `browser_bridge.flush_failed` por `Execution context was destroyed` apareceu
na geração 79 durante a navegação canônica prevista. Ele não atingiu o gate
terminal, não abriu retry e foi seguido por importação, transporte, readiness e
ACK na mesma tentativa. Não classificar essa amostra transitória de navegação
como perda de sessão nem suprimir as cercas do bridge para removê-la dos logs.

### Handoff Baileys → WWebJS — watchdog externo interrompia importação válida

Depois do rollout `1.34.132`, a primeira aresta da nova matriz real confirmou
WhatsMeow → Baileys no canal PostgreSQL `Baileys`: handoff
`ee5f7c9c-4961-49a9-8fd8-9a7f7c0af5db`, revisão `3228→3254`, operação
`01a00714-b702-71af-8b1a-04a166d7a4fd`, concluído em aproximadamente `24,55 s`,
tentativa zero, online/ACK e sem QR. Isso prova que a revisão de origem usada no
passo seguinte estava íntegra.

Duas tentativas Baileys → WWebJS falharam com recuperação segura e reproduzível:

| Handoff                                | Revisão     | Operação                               | Falha                                 | Recuperação                                     |
| -------------------------------------- | ----------- | -------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `dd430ea5-d5bb-401b-975c-49942f8c3f87` | `3254→3255` | `01a00717-6699-720f-b4c5-1f0baf6e1359` | `wwebjs_canonical_import_task_failed` | Baileys online, geração 117; `return` concluído |
| `8d81bb0f-f1cd-45c0-8a2f-b0149113dd47` | `3254→3256` | `01a00720-54e3-727f-8664-67f0d3ab9280` | `wwebjs_canonical_import_task_failed` | Baileys online, geração 119; `return` concluído |

Nas duas, o source permaneceu preservado; na segunda, a recuperação terminou às
`17:37:30-03` e a ação visual **Retornar com segurança** foi persistida como
`completed` às `17:39:59.476882-03`. Não houve QR nem descarte de sessão. A trace
visual autoritativa é
`.playwright-cli/traces/trace-1786825907458.trace`.

A segunda repetição foi acompanhada diretamente nos logs do container WWebJS
alvo. Ela fechou a causa, sem inferência:

- às `20:32:47.325Z`, a projeção Baileys foi hidratada com `3.913` registros,
  `164.559` bytes, oito Signal sessions e sete app-state sync keys;
- `client.initialize()` começou às `20:33:02.501Z`;
- a primeira importação protegida começou às `20:34:35.477Z` e terminou às
  `20:35:37.784Z`, em `62,305 s`; o bootstrap probe ocupou cerca de `60,4 s`;
- o reload canônico cercado terminou e a segunda selagem/importação começou às
  `20:35:50.657Z`;
- às `20:36:32.510Z`, exatamente `210 s` depois do início do initialize, o
  watchdog genérico encerrou o Chromium enquanto a segunda tarefa estava há
  apenas `42,2 s` e ainda dentro do limite próprio de `120 s`;
- o `TargetCloseError` e o erro terminal
  `wwebjs_canonical_import_task_failed` surgiram **depois** desse encerramento.

Portanto, o erro de importação era consequência, não prova de credencial
inválida. O contrato anterior usava o mesmo watchdog destrutivo de `210 s` para
conexão comum e para handoff, embora o handoff execute duas passagens protegidas
separadas por navegação/reload. Remover a segunda selagem para ganhar tempo não
é aceitável: ela é parte da proteção contra promover um perfil diferente do que
foi validado.

`packages/services/wwebjs/methods/connection.service.ts` agora separa somente o
deadline de inicialização:

- conexão direta e recriação continuam exatamente com
  `WWEBJS_CLIENT_INITIALIZE_WATCHDOG_TIMEOUT_MS`, padrão `210 s`;
- handoff canônico usa
  `WWEBJS_SECURE_IMPORT_INITIALIZE_WATCHDOG_TIMEOUT_MS`, padrão efetivo `285 s`;
- o valor seguro é sempre pelo menos o watchdog comum e no máximo o orçamento
  externo de confirmação do handoff menos `15 s`;
- o teto é derivado de
  `WORKER_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS`, padrão `300 s`,
  deixando a cauda para prova nativa `ready`, readiness/authorization do
  JetStream e ACK central;
- se o orçamento externo for ampliado coordenadamente, o override específico
  pode crescer até ele menos a mesma margem; isoladamente, não pode ultrapassá-lo;
- `wwebjs.provider.client_initialize_started` registra `timeout_ms`, permitindo
  distinguir imediatamente o caminho comum do handoff sem esperar um timeout.

Essa mudança não altera fork, codecs, equivalência criptográfica, importador,
segunda selagem, auth timeout, guard de conexão, retry, QR, promoção, ACK ou
recriação. Os gates locais passaram: contrato completo do serviço WWebJS
`130/130`, Prettier, ESLint e typecheck global. Os testes novos cobrem limites,
override coordenado e o wiring real que mantém `210 s` no fluxo comum e escolhe
`285 s` apenas em `secureImportRestore`.

O próximo rollout é seletivo: commitar e enviar primeiro, gerar somente Worker
WWebJS pela tela, instalar nos dois servidores pela tela e renovar somente os
warms WWebJS. Depois, repetir Baileys → WWebJS com a mesma revisão preservada e
confirmar no evento inicial `timeout_ms=285000`, ausência de
`client_initialize_watchdog_timeout`, promoção online/ACK, QR ausente e duração
total menor que os cinco minutos. Só então continuar a matriz nas demais
direções; as duas falhas protegidas acima não contam como sucessos da campanha.

### Rodada 7 — conclusão CAS perdida, lote falso-negativo e teto absoluto do lifecycle

A investigação dos dois canais que permaneciam em `recreating/connecting`
separou duas causas. O WhatsMeow `Notificações 2`, em volume legado, chegava ao
schema v17 com `adv_key` não nulo, porém com zero bytes. A migração v17 inferia
`adv_secret_available=true` somente pela nulabilidade, e o scanner recusava a
credencial incompleta. O SQLite v15 real ainda possui a restrição antiga que
não permite simplesmente converter essa coluna para `NULL`.

O fork embarcado agora executa, somente depois de `Upgrade()` e somente no
dialeto SQLite, uma normalização estreita: revisões de origem
`legacy_sqlite`, marcadas como secret disponível e com `adv_key` de comprimento
zero passam a ter apenas `adv_secret_available=false`. O blob vazio permanece
como sentinela compatível com a restrição herdada. Revisões canônicas,
PostgreSQL compartilhado, chaves não vazias e qualquer outra origem não são
alteradas. Nenhuma tabela legada é criada. A cópia consistente do SQLite real
passou a abrir o device depois do upgrade; os testes também provam que uma
inconsistência canônica equivalente continua falhando fechado.

No Baileys `Hope Tecnologia`, o runtime era criado e o marcador de bootstrap
ficava exato, mas o primeiro CAS terminal perdia uma alteração intermediária do
ponteiro de controle. O fallback existente só concluía quando a linha já havia
avançado para `online`. Se ela ainda estivesse `recreating`, o handler removia
o replacement válido, devolvia erro e o mesmo journal criava outra geração.
Foram observadas gerações consecutivas até a 93, sempre com operação,
container/runtime e bootstrap coerentes, seguidas pela mesma falha terminal.

O handler agora faz uma única releitura consistente depois do primeiro CAS
perdido. Ele só repete a conclusão quando conta, servidor, provider, operação,
runtime, geração e marcador não aposentado continuam exatos. O novo CAS usa o
ponteiro de controle recém-observado e os mesmos locks `worker -> runtime` do
repositório; se outra execução já concluiu, exige também o tombstone exato da
operação e geração. Mudança de operação, geração, runtime, identidade ou status
continua recusada e o container não é promovido por inferência.

O executor do lote também relê o estado cercado antes de registrar uma falha
de journal/slot. Isso corrige os dois falsos negativos do lote online mais
recente: ambos estavam de fato `online` e sem lifecycle pendente, embora o lote
tenha terminado `70 success / 2 errors`. Para canais cujo estado inicial era
`disponible`, uma recriação comprovada que termina novamente `disponible` passa
a ser sucesso válido; um canal inicialmente `online` que termina disponível
continua sendo falha. A prova de operação, baseline, troca de container e
avanço de geração permanece obrigatória.

Por fim, o monitor deixa de manter operações quebradas indefinidamente. Depois
de 30 minutos, uma operação `creating/recreating` sem lock ativo é encerrada
por CAS exato em `error`, com lifecycle limpo, liberando lote e novas ações. O
relógio usa o timestamp imutável do UUIDv7 da operação; `worker.updated_at` é
somente fallback para IDs antigos. Assim, reservar novas gerações não reinicia
o limite. Antes do teto, redrive e reconciliação exata continuam normais. O
valor de 30 minutos está fixo no código; esta rodada não adiciona nem altera
variáveis de `.env`.

Os gates locais desta rodada passaram: `543/543` no contrato integral do
handler após a nova conclusão cercada, `160/160` no monitor, e o conjunto
focado de batch/executor/monitor/handler chegou a `734` testes com uma primeira
falha de fixture que revelou e corrigiu o uso incorreto de `updated_at` como
relógio absoluto. O typecheck global, Prettier e a suíte Go do fork e do worker
WhatsMeow passaram. A fixture SQLite externa real também passou isoladamente.
O próximo passo desta rodada é commitar/enviar, publicar Service, gerar Balance
API e WhatsMeow da mesma árvore, instalar nos 11 servidores e então executar os
dois lotes funcionais solicitados: todos os online não oficiais e, depois,
todos os canais em `disponible`, acompanhando cada target até estado terminal.

### WWebJS `1.34.133` — recaptura ADV idêntica não pode invalidar o checkpoint

Depois da ampliação do watchdog específico de handoff, o canário real
Baileys → WWebJS `9d7ecbaf-636f-48d9-b7ce-adf8cc3f9625`, revisão
`3254→3258`, deixou de ser interrompido pelo deadline antigo e chegou ao
checkpoint offline. A validação ainda falhou com
`wwebjs_canonical_offline_checkpoint_mutated_during_upload`, apesar de nenhum
segredo ter sido rotacionado. A recuperação permaneceu segura e terminou
`completed`: a revisão Baileys 3254 voltou online, sem QR e sem descarte da
sessão.

A correlação do bridge fechou a causa. O hook `__wwebjsAdvSecretCapture`
recebia novamente os mesmos 32 bytes do ADV já retidos durante a navegação.
Mesmo sendo byte a byte idêntico, o caminho anterior notificava
`onAdvSecretCaptured`, incrementava a geração suja e fazia o checkpoint
interpretar a recaptura como mutação concorrente. A falha era, portanto, um
falso positivo do controle de mudança; ignorá-la no checkpoint ou remover a
comparação de geração teria relaxado a cerca errada.

O fork agora compara comprimento e bytes em tempo constante antes da
notificação. Quando o valor é idêntico, mantém o buffer corrente, não chama o
callback e registra somente `browser_bridge.adv_secret_capture_unchanged`, com
o comprimento agregado. Um segredo realmente diferente continua substituindo
o anterior, limpando o buffer antigo, notificando a persistência e alterando a
geração exatamente como antes. O comportamento não depende do provider de
origem e, portanto, não cria um ramo Baileys que possa quebrar WhatsMeow.

Proveniência e gates:

- fork `108c2b15` — implementação e dois contratos positivo/negativo;
- fork `035a2d6c` — release publicada
  `@wwebjs/whatsapp-web.js@1.34.133`;
- shasum `8f33c76e030e823ef09c1adefcea653edea62b2c`;
- integridade
  `sha512-3JymQpL5rPMErZnhMXIoVurVbY2baa/VVj/duxb4p2EHkD+C0ojnanz3/TrHrrAlMyxQcU8xKkcJgCl5kQqxPw==`;
- fork: foco novo `2/2`, BrowserSessionBridge + RemoteAuth `323/323` e a
  camada inteira de sessão + RemoteAuth `502 passing / 1 pending` opcional;
- Underchat `40d53f7a5`: pacote/lock/contrato real atualizados; contratos
  focados `144/144`, contrato de dependência `14/14`, build TypeScript do
  WWebJS, ESLint, Prettier e `git diff --check` aprovados.

#### Rollout seletivo e prova física

O primeiro consumo do job perdeu o heartbeat do build worker antes de
concluir. Depois de confirmar os consumidores de geração/cancelamento ativos
e com lag zero, a ação visual **Reprocessar Worker WWebJS** retomou o mesmo job
`01a00760-4100-77b2-87ad-3dd242babe42`. Ele gerou exclusivamente WWebJS na
versão `v20260815214223744`, entre `18:42:23.744-03` e
`19:13:26.530-03`, com item `success` e imagem
`harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260815214223744`.
Nenhum build Baileys, WhatsMeow ou Balance foi incluído nessa execução.

Server 1 e Server 2 foram reinstalados sequencialmente pela tela de servidor;
os dois consoles terminaram **Instalação concluída e validada**, sem aviso ou
erro. Em ambos os hosts, a imagem instalada resolveu para o mesmo ID imutável
`sha256:2a8eda2b60f400e7e00c666b77d75895d978042cc7d20c3899ab096c243450c5`
e a execução dentro da imagem confirmou `1.34.133`.

Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` foi mantido
antes de **Recriar Todos**. Somente os quatro warms WWebJS foram substituídos;
todos ficaram `ready`, sem `last_error`, `running/healthy`, restart zero e na
imagem/pacote acima:

- Server 1: `01a00786-0cbc-71e4-80aa-a28a41cead2d` e
  `01a00786-0d33-7349-b528-37793985d1cd`;
- Server 2: `01a00786-0cf4-762a-bca7-423f0d13e2da` e
  `01a00786-0d5a-7590-aef2-92ae03202a11`.

#### Canário real Baileys → WWebJS aprovado

O Playwright visível migrou o canal PostgreSQL
`019ffb4e-1456-747b-8197-f19abb1eafe1` de **Opção 1 (Socket)** para
**Opção 2 (Navegador)**, usando **Manter a conexão atual**. O handoff
`cb79aaaf-89d1-4584-989c-9611e9b57c80`, revisão `3254→3259`, operação
`01a00788-220f-7386-acdb-c8c9d4fe5555` e geração 124 terminou `completed`,
tentativa durável zero, sem `error_code`, sem recovery e sem QR. O lifecycle
foi limpo; worker/runtime ficaram WWebJS `online`, prova nativa
`connected/authenticated/sessionValid=true` e ACK central verdadeiro. A UI
exibiu **Conexão bem-sucedida!**, com as provas de sessão, integridade e canal
disponível.

A projeção de origem possuía 3.913 registros, 164.559 bytes, oito Signal
sessions e sete app-state sync keys. As duas selagens offline levaram
`54,900 s` e `55,068 s`; em seguida o checkpoint
`884d721e-2036-4980-8a9b-d6a88d8bb848` concluiu na primeira tentativa, em
411ms. A recaptura do mesmo ADV apareceu como
`browser_bridge.adv_secret_capture_unchanged` e **não** alterou a geração.
Não reapareceu
`wwebjs_canonical_offline_checkpoint_mutated_during_upload`.

Depois da promoção, a coleção nativa `regular_low` mudou durante a primeira
janela de restauração. O fluxo falhou fechado com
`wwebjs_canonical_app_state_restore_restart_required`, preservou o perfil já
promovido e reabriu a mesma revisão ativa após dois segundos, sem nova
autenticação. A segunda inicialização materializou as cinco collections,
verificou 1.032 MACs e sete chaves, concluiu o catch-up em 33.680ms e atingiu
`ready`. Esse evento é uma recuperação controlada pós-ponto-de-não-retorno,
não rollback nem perda de sessão.

O handoff durável levou aproximadamente `356,986 s`; a prova forte online
chegou cerca de dois segundos depois e o ACK central em aproximadamente
`361,419 s` desde o início. O container final ficou `running/healthy`, restart
zero, sem OOM, com health HTTP 200, `Session ready`, envio/recebimento e
JetStream autorizados.

A latência foi auditada contra as rodadas 1.34.97–1.34.99 desta memória. Não
adicionar um atalho baseado apenas nas sete tabelas aparentes: em perfil novo,
o primeiro acesso/`clear()` dispara a mesma inicialização Signal privada de
aproximadamente 53 segundos, apenas mudando o nome do estágio. Também não
remover a segunda selagem nem o restart de ativação para ganhar tempo; nesta
amostra o app-state realmente mudou e exigiu materialização oficial. Qualquer
otimização futura precisa eliminar trabalho com uma prova nova e mensurável,
mantendo checkpoint offline, identidade, app-state, readiness e ACK. A
correção `1.34.133` está aprovada porque remove somente a mutação ADV falsa e o
canário confirmou o caminho completo até a tela conectada.

#### Canário reverso WWebJS → Baileys e diagnóstico do tempo em `requested`

Na mesma rodada, o Playwright visível devolveu o canal PostgreSQL
`019ffb4e-1456-747b-8197-f19abb1eafe1` de **Opção 2 (Navegador)** para
**Opção 1 (Socket)**, novamente por **Manter a conexão atual**. O handoff
`9f30df5a-17da-4630-a75f-5277a7f5e438`, revisão `3259→3260`, operação
`01a00796-d4a0-77f4-b76f-4cc4782ba17a` e geração final 125 terminou
`completed`, sem `error_code`, sem recovery e sem QR. O worker final ficou
Baileys `online`, com lifecycle limpo, ACK central verdadeiro e prova nativa
`connected/authenticated/sessionValid=true`; a UI exibiu **Canal online** e
**Conexão bem-sucedida!** para **Opção 1 (Socket)**.

Esse canário também produziu uma prova importante para diagnósticos de
latência. A Service API local que hospeda o consumidor
`WorkerLifecycleConsume` havia sido encerrada às `19:32`; por isso o handoff
criado às `19:42:00.487993-03` permaneceu corretamente em `requested`, com o
WWebJS de origem ainda online e protegido. Não havia erro de exportação,
Baileys ou JetStream no worker: faltava o consumidor do plano de controle.
Depois que a mesma Service API voltou e os 27 consumidores ficaram `ready`, o
journal pendente foi consumido sem reenvio manual nem duplicação. O runtime
WWebJS foi retirado com cerca, o Baileys geração 125 publicou `online` às
`19:44:33.727-03` e a operação terminou normalmente.

O tempo durável de `152,993 s` inclui aproximadamente `133 s` sem Service API;
o processamento efetivo após a retomada do consumidor levou cerca de 20
segundos. Portanto, quando uma migração ficar em `requested`, verificar
primeiro a disponibilidade/readiness do `WorkerLifecycleConsume` e o atraso
da fila antes de atribuir o tempo ao provider. A preservação da origem online
nesse estágio é comportamento fail-safe esperado, não motivo para cancelar ou
criar outro handoff.

O health HTTP final retornou 200 com `Session ready (WebSocket client state:
OPEN)`, envio/recebimento, comando JetStream e ACK central válidos. O container
Baileys `c7590721c43b` ficou `running`, restart zero, sem OOM, com 381,2MiB de
1,5GiB e 12 PIDs. O canário reverso prova que a correção idempotente do ADV no
WWebJS não regrediu a exportação para socket e deixou o canal de teste
novamente no provider correspondente ao seu nome.

### 2026-08-15 — retomada da matriz volume → PostgreSQL e cerca de versão na reinstalação

Antes da nova bateria em `config?tab=channels`, a memória inteira foi relida
e o inventário vivo confirmou sete canais online. Permaneciam em
`legacy_volume` apenas **Baileys Legacy** e **WhatsMeow Legacy**; o **Wwebjs
Legacy** já estava em PostgreSQL e sem volume depois da última limpeza
explícita. A imagem seletiva mais nova do WhatsMeow estava registrada como
default (`v20260815223542985`), porém a primeira reinstalação visual do Server
1 terminou “Concluída” mantendo `under-worker-whatsmeow:latest` no ID da
versão anterior `v20260815211815807`.

O console e o código mostraram a causa: uma redelivery enquanto o servidor
estava `installing` executou o atalho idempotente `isInstalled()`. A prova
antiga exigia somente a existência dos quatro aliases locais, Balance em
execução e health HTTP 200. Ela não comparava os aliases com as quatro
referências default capturadas no início da instalação; portanto, uma imagem
antiga saudável podia encerrar a reinstalação sem materializar a versão
selecionada.

A prova de readiness da reinstalação passou a receber o snapshot imutável de
`defaultImages` e comparar IDs Docker, um a um:

- referência Baileys default × `under-worker-baileys:latest`;
- referência WWebJS default × `under-worker-wwebjs:latest`;
- referência WhatsMeow default × `under-worker-whatsmeow:latest`;
- referência Balance default × `under-balance-api:latest` × imagem do
  container `under-balance-api`.

Todas as referências esperadas também precisam existir localmente, além das
cercas já existentes de rollout quiescente, container Balance em execução e
health HTTP 200. Os argumentos das imagens são passados ao `bash -c` como
posicionais e escapados, sem interpolação executável. Assim, redelivery ou
retomada somente usa o fast-path se **a mesma seleção de versões** já estiver
integralmente instalada; caso contrário, a execução original continua/puxa
as imagens corretas. O contrato focado de SSH ficou `11/11` e o TypeScript
global aprovou sem erros. Esta cerca deve permanecer em qualquer alteração
futura do instalador: “alias existe” não é prova de versão.

#### Primeiro canário volume → PostgreSQL e layout real do Baileys

Depois da reinstalação visual dos dois servidores, a imagem WhatsMeow
`v20260815223542985` foi comprovada nos dois aliases pelo ID imutável
`sha256:3c920cb8d7d4aa397b9375ddaacb69fe30af8afc8b38317b0d9aeb572d9daa8f`.
Somente os quatro warms de **Opção 3 (Socket)** foram recriados e ficaram
`ready`, saudáveis e sem restart. Antes de migrar o armazenamento, o canal
**WhatsMeow Legacy** também foi recriado preservando a sessão: abriu o SQLite
do volume, conectou em aproximadamente 1,1 segundo e publicou a prova forte
online. Isso confirmou que o rollout seletivo não regrediu o fluxo legado.

Pela tela `config?tab=channels`, o mesmo canal passou de `legacy_volume` para
`postgres` na migração `ad4ce412-b75f-4122-822a-1c1e07331268`. Origem geração
13, destino geração 15 e revisão 3261 chegaram a `cleanup_pending` na primeira
tentativa, sem erro, em aproximadamente 10,7 segundos. A UI exibiu a sessão
conectada e todas as provas válidas; foi escolhido **Manter por enquanto**, de
modo que o volume de recuperação continua preservado para a bateria repetida.

O primeiro canário equivalente do **Baileys Legacy** falhou fechado antes de
promover ou apagar qualquer dado. O checksum calculado na origem estava
correto, o volume foi montado somente para leitura e a revisão PostgreSQL
ficou em `staging`, mas o bootstrap devolveu
`legacy_session_migration_layout_invalid`. A inspeção física mostrou a causa:
o volume dedicado representa `/app/data` inteiro e contém os arquivos em
`storage/<worker-id>/*.json`; o importador Baileys aceitava apenas o formato
mais antigo, com `*.json` diretamente na raiz montada
`/app/legacy-session`.

A correção mantém a prova SHA-256 sobre **todo o volume**, exatamente igual na
origem e no destino, e separa dela a resolução do diretório de autenticação.
Depois do checksum, são aceitos apenas dois layouts inequívocos:

- plano antigo: somente arquivos JSON regulares na raiz;
- atual: exatamente `storage/<worker-id>/`, contendo somente arquivos JSON
  regulares.

Volume misto, diretório de outro worker, workers adicionais, arquivo não JSON,
layout vazio, link simbólico ou tentativa de escape de caminho falham
fechado. Não há busca heurística nem escolha do “primeiro diretório”. Os erros
da etapa agora carregam um `ERR_*` estático e seguro, permitindo telemetria
útil através do wrapper de fase sem expor mensagens, caminhos ou conteúdo de
sessão. Os contratos cobrem os dois formatos aceitos e todas essas rejeições;
junto aos contratos completos da conexão Baileys e do snapshot foram
`87/87`, com TypeScript global e Prettier aprovados. A operação real que
revelou a falha permanece com o volume de origem preservado e será concluída
somente depois de commit/push, build seletivo Baileys, instalação visual e
novo canário.

### 2026-08-15 — rodada do lote conectado: runtime antigo online, redrive excessivo e fence de bootstrap

O lote dos canais conectados não estava apenas lento. Dos 148 alvos não
oficiais, 145 terminaram com sucesso, dois chegaram ao resultado legítimo de
sessão inválida (`401/logged_out`) e o canal **DG** permaneceu enfileirado. A
inspeção correlacionada do banco, Redis, consumidor, Balance e Docker revelou
um estado contraditório reproduzível:

- `worker.lifecycle_operation_id` apontava para a operação nova e o status já
  era `online`;
- o runtime físico e a geração continuavam sendo os anteriores;
- `worker_runtime.recreate_bootstrap_operation_id` ainda apontava para a
  operação antiga;
- não havia lock nem slot de recriação preso;
- o journal e a claim de redrive continuavam íntegros;
- a cada redelivery aparecia apenas o probe `RuntimeHealth`, sem o comando
  destrutivo/idempotente `RecreateWorker`.

A primeira causa estava no fechamento otimista do consumidor. Um runtime
antigo saudável fazia `reconcileHealthyRuntimeLifecycle` recusar corretamente
o CAS por não possuir o marker de bootstrap da operação nova. O consumidor,
porém, convertia qualquer `false` em `fence_changed`, reconhecia a mensagem e
nunca chegava ao comando de recriação. Agora ele relê a visão primária depois
do CAS: somente uma mudança real de conta, servidor, provider, status,
operação, container ou geração é `fence_changed`. Se o fence permanece igual,
o resultado é `not_ready` e o fluxo continua para o comando idempotente de
recriação. Isso recupera o estado já existente sem limpar Redis ou editar o
worker manualmente.

A corrida que produz o estado contraditório também foi fechada em duas
camadas. O handler só permite `recreating -> online` quando
`worker_runtime` contém os quatro campos de bootstrap da **mesma** operação,
geração e container, sem marker de retirement. A migração
`20260816002000.sql` aplica a mesma regra sob locks `worker -> worker_runtime`
na função `apply_worker_runtime_status`, antes de delegar à cadeia anterior de
wrappers. Assim, um heartbeat forte do runtime antigo não consegue promover o
worker entre o claim do lifecycle e o início físico do replacement. A janela
legítima em que um container novo, exclusivamente identificado pelo volume e
pelos labels da operação, nasceu antes da persistência do ponteiro continua
recuperável: o handler reclama o ponteiro e grava o marker através do CAS
atômico existente antes de aceitar ONLINE.

A terceira causa de lentidão era independente. O executor do lote chamava
`redrivePrepared` em todo retry de um alvo enfileirado, normalmente a cada
minuto, ignorando o cooldown do monitor e multiplicando mensagens Kafka. O
executor agora apenas verifica o journal Redis. Journal existente fica sob a
responsabilidade exclusiva do redrive controlado pelo monitor; somente um
journal realmente ausente é reconstruído a partir da cópia durável do alvo e
publicado uma vez. Isso impede que um único alvo lento gere uma tempestade de
duplicatas ou faça os demais parecerem parados.

Gates desta rodada antes do rollout:

- contratos focados do handler, consumidor, executor e migração: `636/636`;
- contrato completo do handler: `544/544`;
- TypeScript global sem erros;
- Prettier e `git diff --check` aprovados;
- checksum Atlas regenerado pela CLI;
- migração aplicada integralmente no PostgreSQL local, seis statements em uma
  única versão, antes de qualquer aplicação em produção;
- nenhum valor novo de ambiente foi criado;
- nenhum warm ou container de canal foi parado, removido ou atualizado como
  efeito de publicação/default. A atualização dos warms permanece
  exclusivamente manual pela ação **Recriar Todos** de Canais aquecidos.

Próximos gates desta mesma rodada: commit/push, rollout da Service, aplicação
da migração, build local/pareamento da imagem Balance e do Baileys corrigido,
reinstalação controlada dos 11 servidores sem tocar nos runtimes, conclusão
do alvo DG e fechamento do lote conectado. Somente depois será criado o lote
dos canais **Aguardando leitura do QR code**, com auditoria alvo a alvo e
classificação entre sessão realmente inválida e sessão válida não recuperada.

### 2026-08-15 — fixture Baileys legado real: IDs sanitizados, app-state e PQ

Depois do suporte aos dois layouts físicos do volume, o canário visual do
**Baileys Legacy** avançou até o staging nativo e revelou uma segunda classe
de compatibilidade. A migração protegida
`a46bee1b-1a0f-47e9-bf74-161a3840e633` esgotou as três tentativas sem promover
a revisão, terminou `restored` com
`session_storage_migration_attempt_timeout` e restaurou o runtime legado na
geração 14. O worker voltou `online`, com `connection_validated`, volume-fonte
preservado e nenhuma perda de autenticação. Esse resultado confirma que o
rollback permanece seguro mesmo quando o bootstrap falha depois de abrir a
revisão PostgreSQL.

A sessão real contém 3.556 arquivos. Todas as credenciais e os 3.556 valores
passaram pelo codec binário do provider; o problema estava na projeção
canônica e nos nomes produzidos por `useMultiFileAuthState`. Foram encontrados
três formatos legítimos que o importador anterior não reconstruía:

- 54 sender keys usam no disco `grupo--remetente--device`, pois os dois
  separadores nativos `::` são sanitizados para `--`;
- 16 app-state sync keys antigos armazenam `keyData` como base64 textual e
  precisam da mesma conversão protobuf usada na leitura normal do adapter;
- 102 registros pós-quânticos (`pq-pre-key`, `pq-last-resort-key` e
  `pq-pre-key-state`) não estavam na lista de namespaces reconhecidos e seriam
  classificados como arquivos opacos;
- duas sessões Signal também continham receiver chains históricas esgotadas,
  com contador válido, zero message keys e nenhuma key material. Elas não são
  o ratchet remoto ativo e não possuem material capaz de descriptografar ou
  avançar.

O fork Baileys `1.0.31`, commit `8fca6a1a0c`, trata esses casos sem ampliar o
comportamento dos handoffs normais. A reconstrução de IDs só é ativada quando
o bootstrap de volume envia explicitamente
`storage_layout=multi_file_auth_state_v1`. Sender key ambígua ou malformada e
app-state cujo ID não fecha como base64 falham fechado. O nome seguro original
continua sendo o nome de arquivo, enquanto a chave PostgreSQL recebe o ID
nativo. Colisões são verificadas tanto por nome quanto por
`namespace + record_key`. Os namespaces PQ são ordenados do prefixo mais
específico para o mais curto para impedir que `pq-pre-key-state` seja
interpretado como `pq-pre-key`.

Na projeção provider-neutral, somente a forma exata de receiver chain inerte
é omitida; o provider record original continua integralmente armazenado. Se a
chain sem material for a `lastRemoteEphemeralKey`, a migração recusa com
`codec_active_receiver_chain_key_material_missing`. Isso evita transformar
uma tolerância a histórico esgotado em aceitação de ratchet ativo corrompido.

Validações antes do rollout:

- testes focados do fork: `109/109`;
- build TypeScript do fork aprovado;
- replay sem escrita da fixture viva, transmitida diretamente do volume para
  o codec local: `3.556/3.556` provider records e `3.555/3.555` mutações
  canônicas aprovadas, incluindo 54 sender keys, 102 registros PQ e 16
  app-state keys;
- pacote `@whiskeysockets/baileys@1.0.31` publicado no registry interno;
- contratos Underchat de dependência real, layout legado e store PostgreSQL:
  `45/45`, com TypeScript global aprovado.

O próximo gate é commit/push do pin `1.0.31`, build **somente** do Baileys,
instalação pela UI, troca controlada apenas dos warms Baileys e repetição do
canário visual. Não reutilizar o marker de layout em pacotes de handoff entre
providers e não aplicar substituições globais de `-` ou `_`: a codificação do
adapter de arquivos não é bijetiva e qualquer decodificação fora dos
namespaces estruturados acima pode alterar IDs válidos.

### 2026-08-15 — rollout seletivo sem substituição automática de warms

As correções do lote/fence foram publicadas no commit Underchat
`64b9e615b`. O pin do fork Baileys `1.0.31` e a marcação explícita do layout
legado foram publicados em seguida no commit `d7ba497e4`. A função SQL
`apply_worker_runtime_status` da migração `20260816002000.sql` foi aplicada
transacionalmente no PostgreSQL primário de produção. A verificação posterior
confirmou a função pública, a função-base isolada e as permissões esperadas:
o papel de runtime executa somente o wrapper protegido.

Os artefatos dos workers continuaram sendo gerados exclusivamente no ambiente
local. O job Baileys `v20260816003627174` terminou com sucesso e a inspeção
direta da imagem confirmou `@whiskeysockets/baileys@1.0.31`. O job Balance
`v20260816004014944` foi criado selecionando somente **Balance API**; antes de
dispará-lo, a seleção foi conferida no DOM como um único checkbox marcado. O
diretório isolado usado pelo executor apontava para o commit exato
`d7ba497e4`. Um job Baileys chegou a receber cancelamento enquanto já
exportava a imagem e terminou com sucesso; ele não foi usado implicitamente:
só foi pareado depois da validação da versão embarcada.

Na produção, a ação **Parear** importou os dois artefatos e as versões foram
definidas manualmente como padrão:

- Worker Baileys: `v20260816003627174`, imagem imutável
  `sha256:ebe52156df0d369f30302feede808ffdb40f45b46eae540138ec4890ce22353e`;
- Balance API: `v20260816004014944`, imagem imutável
  `sha256:a53b6c675f43f999e9b06cfb37869d58cc13f7b912073e61fd9a85b6d7ab626a`.

Antes de reinstalar os servidores, foi capturado em cada host um hash SHA-256
ordenado de `container_id + container_name` de todo container em execução,
exceto `under-balance-api`. Também foi capturado um baseline central de 1.041
runtimes e 189 warms. Os 11 servidores foram reinstalados pela ação explícita
da UI, já com o instalador do commit `b498f4206`, que não contém `docker stop`
ou `docker rm` para aliases de worker, containers de canal ou warms.

Todos os servidores voltaram para `online` e executaram um novo container
Balance saudável sobre o mesmo ID de imagem imutável. Em cada um dos 11
hosts, a contagem e o hash de todos os containers não-Balance foram idênticos
ao baseline individual. A conferência central posterior também permaneceu
idêntica:

- runtimes: `1041`, hash `b77fcbb595cef8b3b0df268a809b1795`;
- warms: `189`, hash `0bd1e2745b21738ba1f380bfa77a037c`.

Portanto, parear, alterar default e reinstalar os Balance APIs não atualizou,
reiniciou, removeu nem recriou qualquer canal ou warm. Os aliases das novas
imagens foram apenas baixados/tagueados. A substituição dos warms continua
dependendo exclusivamente da ação manual **Recriar Todos** em Canais
aquecidos; ela não faz parte deste rollout.

O lote conectado continuava, antes do rollout da Service, em 145 sucessos,
dois erros legítimos de sessão inválida e somente o DG enfileirado. O DG ainda
estava na geração 45 e no container antigo, com bootstrap pertencente à
operação anterior; o contador chegou a 155 tentativas sob a versão antiga.
Nenhum estado de banco ou Redis foi forçado. O próximo gate é concluir o
rollout `64b9e615-5-1698`, deixar o monitor redirigir naturalmente o mesmo
journal, comprovar a nova geração do DG e fechar esse lote antes de iniciar o
lote completo de **Aguardando leitura do QR code**.

### 2026-08-15 — Baileys legado real: colisão histórica na projeção LID

O canário visual seguinte do **Baileys Legacy**, migração
`5c734f5e-75ba-42e8-8780-40613c6341b1`, comprovou que o layout e os 3.556
provider records já atravessavam integralmente o bootstrap. A falha das duas
primeiras tentativas ocorria somente ao materializar a projeção canônica
`whatsapp_lid_map`. O PostgreSQL registrou o erro exato
`ON CONFLICT DO UPDATE command cannot affect row a second time`: o mesmo
`INSERT ... ON CONFLICT` recebia duas linhas com o mesmo LID dentro do lote.

A inspeção estrutural, sem imprimir identificadores ou conteúdo de sessão,
encontrou 1.224 mapeamentos diretos, 1.224 reversos e 1.223 LIDs diretos
únicos. Um LID possuía dois PNs históricos: uma entrada direta obsoleta e o
par direto/reverso atual. Isso é um estado legítimo do
`useMultiFileAuthState` após substituição de número. Não se deve descartar
nenhum dos 2.448 provider records, nem aceitar duas relações para a projeção
canônica 1:1.

O fork Baileys `1.0.32`, commit
`ed5fd4c6beb0a21023312071b2a71f911e8c936f`, agrupa somente as mutações da
projeção por LID. Para uma chave única, o comportamento permanece idêntico.
Quando há colisão, a entrada `_reverse` exata escolhe exclusivamente o PN que
forma o par recíproco; a linha direta histórica fica fora apenas da projeção,
enquanto seu provider record permanece preservado na revisão. Duplicata
idêntica é deduplicada. Colisão sem reverso inequívoco e PN apontando para
mais de um LID falham fechado com
`codec_ambiguous_baileys_lid_mapping`, antes da escrita canônica.

Validações antes do rollout:

- testes focados do fork, incluindo seleção recíproca e ambiguidade sem
  escrita parcial: `111/111`;
- build TypeScript do fork aprovado;
- pacote `@whiskeysockets/baileys@1.0.32` publicado no registry interno;
- contratos Underchat sobre a dependência empacotada real e o store
  PostgreSQL: `36/36`;
- TypeScript global aprovado.

A operação real consumiu a terceira tentativa ainda na imagem antiga e
terminou em rollback protegido antes do rollout. A UI exibiu **Sessão legada
restaurada**, o canal voltou `online` no volume, o volume-fonte permaneceu
preservado e nenhuma revisão incompleta foi promovida. Portanto, o canário da
versão nova deve ser uma operação nova; não reutilizar nem reabrir o journal
encerrado.

O pin `1.0.32` foi integrado no commit Underchat `db001673e` depois de todos
os gates locais e antes do build. Pela UI foi gerado exclusivamente o Worker
Baileys `v20260816011314176`, digest imutável
`sha256:1d8a12a58416cfb09d5b616a88b78651774f696015424cb84c33f66610af96bd`.
A imagem foi inspecionada antes do pareamento e contém o pacote `1.0.32`. O
pareamento tornou essa versão default. As instalações visuais dos Servers 1 e
2 concluíram com validação, sem avisos ou erros de lifecycle, e os aliases
locais dos dois hosts apontam para o mesmo digest.

Somente o filtro **Opção 1 (Socket)** foi selecionado em Canais aquecidos. Os
oito warms Baileys foram recriados, quatro por servidor, e todos ficaram
`running`, `healthy`, reinício zero e no digest novo. Os quatro warms WWebJS e
quatro WhatsMeow conservaram IDs e imagens. O próximo gate é iniciar pela UI
um canário novo do Baileys Legacy volume -> PostgreSQL, manter o volume após o
sucesso e validar contagens da revisão, projeção LID, ACK nativo e ausência de
QR antes de repetir a bateria.

### 2026-08-15 — Baileys legado: promoção do primeiro scaffold PostgreSQL

O canário novo `cd7dfe72-a2b3-4df5-8a74-949775eb71fa` comprovou que a correção
de LID atravessa a fixture viva inteira: 3.556 arquivos foram capturados, o
runtime PostgreSQL conectou sem QR, publicou `online` nativo com lease válida e
materializou 3.557 provider records depois das atualizações normais do
provider. Mesmo assim, o ACK central permaneceu bloqueado. O health endpoint
expôs corretamente `awaiting_dispatch_authorization`, e o log seguro revelou o
gate determinante: `candidate whatsapp session changed companion identity` ao
tentar promover a revisão `secure_import`.

A causa não era mudança real de identidade. O opener do controle central cria
primeiro a revisão vazia `legacy_volume_migration`, muda o header para
`preparing` e já aponta `active_revision_id` para esse scaffold. O importador do
fork procurava `active_revision_id IS NULL` depois do opener; essa condição é
impossível. Por isso ele criava uma segunda revisão `secure_import` e um handoff
Baileys -> Baileys cuja revisão-fonte não possuía `whatsapp_device`. A função de
promoção comparava a revisão preenchida com a origem vazia e, corretamente,
falhava fechado. As três tentativas continuaram protegidas pelo journal; não
houve promoção incorreta, autorização de dispatch nem QR.

O fork Baileys `1.0.33`, commit
`f755131b17467172e8b816c08c4711357a79e0cf`, preenche o scaffold já aberto em
vez de criar uma origem vazia. Essa exceção é estreita e exige simultaneamente:

- provider Baileys, header exatamente `preparing` e sem revisão anterior;
- `active_revision_id` igual à revisão aberta e status `staging`;
- source exatamente `legacy_volume_migration`;
- `storageMigrationId` válido e presente, que já foi autorizado pelo journal e
  pela geração do runtime no opener SQL.

Qualquer import comum, revisão ativa existente, handoff entre providers ou
estado divergente continua usando o caminho anterior e suas comparações de
fingerprint. A promoção inicial usa exclusivamente
`promote_legacy_volume_migration_revision`; a proteção de identidade de
`promote_whatsapp_session_revision` não foi relaxada.

Validações antes do rollout:

- teste específico do scaffold e suíte focada do fork: `106/106`;
- suíte completa do fork: `585/585`;
- build TypeScript do fork aprovado;
- pacote `@whiskeysockets/baileys@1.0.33` publicado no registry interno;
- contratos Underchat da dependência empacotada, store PostgreSQL e migração
  legada: `47/47`;
- TypeScript global sem erros, lockfile congelado validado e diff do lock
  restrito à troca `1.0.32 -> 1.0.33`.

Próximo gate: commit/push do pin Underchat antes de qualquer build, gerar pela
UI somente o Worker Baileys, instalar pela UI, trocar somente os warms Baileys
e iniciar uma migração nova depois da restauração protegida do canário atual.
Não reabrir as revisões `3325/3326` nem promover manualmente: elas documentam a
falha segura da versão anterior e devem ser invalidadas apenas pelo
orquestrador de restauração.

### 2026-08-15 — fechamento do lote online e redrive de lifecycle em um minuto

O último alvo do lote online, **DG**
(`019e9964-a848-702b-9c31-88d845991752`), expôs uma segunda condição de
recuperação. A operação explícita de recriação ainda era a dona do journal,
mas a projeção primária havia voltado para `online` apontando para o runtime
antigo, geração 45, cujo bootstrap pertencia a outra operação. O Balance
rejeitava corretamente remover esse runtime porque a cerca do banco não
permitia remover um worker projetado como online. Assim, o journal não podia
avançar nem devia ser descartado.

O commit `f7327cbae` fez o consumidor rearmar esse caso por CAS estrito. A
transição `online -> recreating` só ocorre quando a mesma operação ainda possui
o lifecycle, servidor, provider, container de controle, container do runtime e
geração observados. Mudança de qualquer cerca cancela o dispatch antigo. Não há
efeito Docker nessa etapa e um runtime realmente saudável, já inicializado
pela operação corrente, continua sendo finalizado sem recriação adicional.

A investigação também confirmou que o redrive geral ainda usava 5 minutos de
idade e 15 minutos de cooldown. Isso explicava as pausas visíveis mesmo depois
de corrigido o executor do lote. O commit `93e996063` fixa ambos em 1 minuto,
sem variável nova de ambiente. A claim Redis continua vinculada à operação, o
lock do worker continua exclusivo e o limite físico permanece em dois slots
por servidor. Uma claim antiga da mesma operação tem seu TTL encurtado
monotonicamente; ela não é roubada nem apagada.

Validação e rollout desta rodada:

- contratos do consumidor de lifecycle: `72/72`;
- contratos do monitor: `160/160`;
- Prettier, ESLint e TypeScript global aprovados;
- CI Devtron `1700`, checkout exato
  `93e99606387ef988705ccda57277bcc4c0eeff14`;
- imagem Service `93e99606-5-1700`, digest
  `sha256:1c72b9d51787bc00f2c0bf30ebec7faefd7e602dc4942c85d1b72f1aa64740bc`;
- rollout da Service concluído com `15/15` réplicas prontas.

Depois do rollout, o monitor redirigiu naturalmente a operação original do
DG. Sem alterar banco ou Redis manualmente, o runtime avançou da geração 45
para 46, recebeu um container novo, registrou bootstrap com o mesmo
`lifecycle_operation_id`, confirmou `online` e limpou o lifecycle. O alvo
terminou `succeeded` e o lote
`01a0076b-1e1b-740e-9e2a-8b11211303d2` foi fechado com 146 sucessos e dois
erros legítimos de sessão inválida (**Ht Sistemas** e **whatsapp**, ambos
WhatsMeow e já projetados como aguardando QR). Nenhum alvo, slot ou lifecycle
ficou pendente.

Nenhum warm ou container de canal foi reiniciado por alteração de versão. A
política continua sendo atualização de warms somente pela ação manual
**Recriar Todos** em Canais aquecidos. O próximo gate é inventariar novamente
os canais em **Aguardando leitura do QR code**, excluir qualquer provider
oficial, iniciar um novo lote pela UI e auditar individualmente todos os alvos,
separando sessão realmente inválida de sessão válida que não recuperou.

### 2026-08-16 — nova bateria volume -> PostgreSQL e corrida tardia do WWebJS

Antes desta rodada, a memória foi relida integralmente e os testes foram
executados pela ação real de `config?tab=channels`, sempre mantendo o volume
de origem após cada sucesso. O retorno para volume entre repetições não foi
feito alterando `worker`, runtime ou arquivos diretamente: somente o journal
exato em `cleanup_pending`, com fonte ainda preservada, worker PostgreSQL
online, ACK central e lifecycle nulo, foi rearmado em `restoring`. O
orquestrador continuou sendo o único responsável por aposentar runtime,
restaurar a projeção e iniciar o provider legado.

O **Baileys Legacy** concluiu cinco novas migrações visuais volume ->
PostgreSQL, todas na primeira tentativa, sem QR, com identidade preservada,
estado nativo `online`, ACK central e lifecycle limpo. As quatro primeiras
foram restauradas com o procedimento protegido acima e a quinta ficou em
PostgreSQL com o volume preservado. Os tempos internos ficaram na faixa de
aproximadamente 9 a 12 segundos. Isso também validou em ambiente vivo o fork
Baileys `1.0.33` e o reaproveitamento do scaffold
`legacy_volume_migration`; não criar novamente uma revisão `secure_import`
nesse bootstrap.

O **WhatsMeow Legacy** também concluiu cinco novas migrações na primeira
tentativa:

- `5c5fed1b-5ab8-4a93-bda8-af774b86d72e`, revisão `3332`, `11,176 s`;
- `fb8bcd04-576a-4fae-bdc8-34e1b4a9e556`, revisão `3333`, `9,688 s`;
- `db44c1c2-35f9-4270-a3d2-09d6eeb64b99`, revisão `3334`, `11,415 s`;
- `8a9e8d60-ab37-4355-9814-1e8428714126`, revisão `3335`, `11,307 s`;
- `bebd90da-2951-4420-87de-962d433abb47`, revisão `3336`, `11,661 s`.

As quatro primeiras foram restauradas com proteção; a quinta ficou em
PostgreSQL e `cleanup_pending`, com a fonte em volume preservada. Todas
terminaram com `attempt_count=1`, `online/connected/authenticated`,
`sessionValid=true`, sem QR, ACK central e lifecycle nulo.

Para cobrir o formato SQLite realmente antigo do WhatsMeow, uma cópia
consistente do volume preservado foi convertida em fixture real de schema
`v15` — cursor `(15,8)`, `integrity_check=ok`, um device pareado e chave ADV
de 32 bytes. A fixture continha, entre outros registros, 60 identity keys,
758 prekeys, 60 sessões Signal, 54 sender keys, 16 app-state keys, 1.231 MACs,
1.689 contatos, 19.213 message secrets e 668 mapeamentos LID. Os testes
`TestUpgradeRecoversExternalLegacySQLiteFixture`,
`TestUpgradeNormalizesEmptyLegacySQLiteADVSecret` e
`TestUpgradeDoesNotNormalizeEmptyCanonicalADVSecret` passaram sobre essa
fixture. Uma sonda de transporte sobre a cópia confirmou autenticação em
3,5 segundos.

Regra operacional importante: uma fixture estrutural SQLite antiga pode ser
inspecionada em paralelo, mas **nunca** conectar simultaneamente uma cópia
autenticada da mesma identidade enquanto o runtime original estiver ativo.
Essa duplicação provoca conflito legítimo entre companions. A sonda desta
rodada evidenciou o conflito; os artefatos temporários sensíveis foram
apagados e o canal real foi recuperado pelo fluxo normal de recriação,
terminando novamente PostgreSQL/online/ACK, sem mutação direta da sessão.

O **WWebJS Legacy** não possuía mais volume, portanto seu perfil LocalAuth foi
reconstruído a partir do runtime PostgreSQL ativo sem editar a sessão. O
container exato foi pausado apenas durante a cópia consistente e retomado em
seguida. O layout criado foi
`wwebjs/storage/<worker>/.wwebjs_auth/session-<worker>`, com 722 registros,
171.814.997 bytes e SHA-256
`325dd2441553b3295007b2ce9daf0201126d0e3908fe2cf40ce328a756c4da9c`.
Somente symlinks Chromium `SingletonCookie`, `SingletonSocket` e
`SingletonLock` foram removidos. O fence absorveu o reinício provocado pela
pausa e um journal independente
`6381f9d0-0b07-4ee4-80f5-a130126e9161` restaurou o canal pela via normal para
volume, geração `82`, online e com ACK.

A primeira migração WWebJS volume -> PostgreSQL na imagem `1.34.133`
(`cf812013-00a2-446c-aca4-4170dc2a5960`) encontrou uma corrida real. O
Puppeteer rejeitou `Runtime.callFunctionOn` com `Execution context was
destroyed` cerca de 400 ms antes do evento que incrementava a sequência de
navegação. A verificação síncrona interpretava o voo anterior como falha de
identidade e encerrava a primeira tentativa. O retry protegido conectou e
promoveu a revisão, preservando a origem, mas com latência de vários minutos.

O fork WWebJS `1.34.134`, commit
`8c3c708b8d101aebe1b80c88d83a0379feb85065`, adiciona uma observação limitada
a 1 segundo e somente no bootstrap `legacy_volume_migration`. Um erro precisa
ser transitório, a mesma Page deve continuar aberta e autoritativa, e o epoch
do runtime não pode mudar. Apenas o avanço posterior do document epoch ou da
sequência de navegação transfere a prontidão ao voo sucessor. Troca de
browser/Page, erro não transitório, pairing, revisão ativa e demais handoffs
continuam falhando fechado. O teste novo reproduz o evento 30 ms atrasado e
confirma que `finalizeNativeFailure` não é chamado pelo voo substituído.

Validações do fork antes da publicação:

- teste focado do RemoteAuth: `119/119`;
- suítes `authStrategies` e `session`: `503` aprovados e `1` pendente;
- ESLint e Prettier aprovados;
- verificação do web-cache e dos 158 arquivos do pacote aprovada;
- pacote `@wwebjs/whatsapp-web.js@1.34.134` publicado somente depois do commit
  e push do fork.

O pin `1.34.134` foi integrado ao Underchat juntamente com a atualização da
chave visual `session_migration_ingress_ready` de Kafka para JetStream nos
seis catálogos `pt`, `en` e `es` (web e backend). Antes do build, 175 contratos
de migração/WWebJS passaram e o TypeScript do worker WWebJS foi aprovado. O
próximo gate é commit/push deste pin, build **somente** do WWebJS pela UI,
instalação visual nos dois servidores, troca somente dos warms WWebJS e cinco
migrações funcionais novas. A tentativa antiga não conta na bateria pós-fix.

### 2026-08-16 — WWebJS 1.34.135: timeout explícito e rollout antes da contagem 5/5

A imagem `1.34.134` foi gerada e instalada sob a versão
`v20260816025842490`, digest
`sha256:e95531d938abdc686ae8f6c35a2fdac2165cdb6086dc471711e3a12971b0e8b5`.
O primeiro canário real dessa imagem,
`93720acc-08b0-4e92-b116-08f25f3fbd92`, preservou o volume e terminou em
`cleanup_pending`, revisão `3338`, geração `88`, primeira tentativa. Durante o
bootstrap ocorreram `Execution context was destroyed` e depois
`Protocol error (Runtime.callFunctionOn): Promise was collected`. A navegação
substituta recuperou o perfil e chegou a `online`, mas o segundo erro podia
deixar o `waitForFunction` do estado de autenticação consumindo todo o timeout
sem uma classificação terminal inequívoca.

O fork WWebJS `1.34.135`, commit
`23f9ca0d40ca511b6840592f23b34e5101c98410`, converte exclusivamente o timeout
do bootstrap `WAWebSocketModel.Socket.state` em
`wwebjs_auth_state_timeout`, preservando a causa original. Erros que não são
timeout continuam inalterados. No Underchat, os commits
`73a02303f` e `0ff1b8e324aa398825544a76564a811920541929` tratam esse código
como falha limitada de restore mesmo quando o perfil LocalAuth já foi
validado: novas tentativas continuam protegidas e, somente após esgotamento,
o runtime publica erro nativo explícito, não recuperável, que permite ao
lifecycle terminar sem permanecer indefinidamente em `recreating`. Um erro
genérico de Chromium/SDK não ganhou esse poder e continua preservando um
perfil validado.

Validações antes do rollout:

- teste focado de lifecycle do fork: `34/34`;
- suítes `authStrategies` e `session` do fork: `504` aprovados e `1` pendente;
- contratos Underchat do handler, conexão WWebJS e dependência empacotada:
  `693/693`;
- TypeScript do worker WWebJS aprovado;
- fork e Underchat limpos e sincronizados com `origin/main` antes do build.

Pela UI foi gerado somente o Worker WWebJS
`v20260816032510548`, digest imutável
`sha256:6250afe730d3d2c532552adc674030d0aa9410768c6133816db889e2bbd52070`.
As instalações visuais dos Servers 1 e 2 concluíram com validação, zero avisos
e zero erros. Os aliases locais dos dois hosts apontam para esse digest. Os
quatro warms WWebJS foram recriados pelo filtro **Opção 2 (Navegador)**; dois
por servidor ficaram `ready`, saudáveis e executando fisicamente o pacote
`1.34.135`. Os pools Baileys e WhatsMeow não foram recriados.

Durante a restauração protegida do canário `93720acc-...`, o build novo já
estava default no banco, mas ainda não havia sido instalado nos servidores.
Por isso o provisionador recusou usar silenciosamente a tag antiga e registrou
`13_internal:_worker_image_pull_failed` em retries não destrutivos. Assim que
a instalação visual materializou a referência imutável, o mesmo orquestrador
concluiu a restauração sem intervenção na sessão: `Wwebjs Legacy` voltou para
`legacy_volume`, geração `89`, container no digest novo, estado nativo
`online/ready`, ACK central verdadeiro e volume-fonte preservado. O
`last_error_code` no journal é histórico e não representa falha do estado
terminal `restored`.

Regra operacional consolidada: depois que um build se torna default, instalar
essa versão nos **dois** servidores antes de rearmar restaurações ou iniciar a
bateria. Não fazer fallback para uma tag anterior e não interpretar
`worker_image_pull_failed` nessa janela como corrupção de sessão. A contagem
solicitada foi zerada deliberadamente depois do rollout; o canário acima é
diagnóstico e **não conta**. O próximo teste visual começa em `0/5` para o
WWebJS; qualquer falha reinicia a contagem.

### 2026-08-16 — WWebJS 1.34.136: reidratação do sucessor no volume -> PostgreSQL

O primeiro ciclo oficial posterior ao rollout `1.34.135`, journal
`59eaee9a-d0d4-4601-8f3a-96252e8ec526`, não foi contado e reiniciou a
contagem em `0/5`. A tentativa provou que o perfil LocalAuth e a sessão não
estavam corrompidos: o primeiro documento autenticou, publicou
`sessionValid=true` e exportou uma projeção canônica completa com 2.319
registros, 111.504 bytes, sete sessões Signal, duas sender keys e sete chaves
de app-state. A origem permaneceu preservada durante todas as tentativas.

A falha ocorreu depois desse primeiro sucesso interno. A reconciliação
detectou dois MACs futuros e acionou o full-sync oficial. O WhatsApp Web
executou `close_socket_and_prevent_retry` e substituiu o documento principal.
O voo anterior foi corretamente descartado por `Execution context was
destroyed`, porém o voo sucessor recebeu o evento autenticado antes de o
registro de módulos privados do novo documento terminar de reidratar. Uma
exportação feita nessa janela retornou `module_abi.incompatible`, módulos
indisponíveis e campos de device ainda ausentes; isso foi classificado como
`wwebjs_canonical_projection_incomplete` e encerrou a tentativa. Portanto a
causa era uma corrida de prontidão do **documento sucessor**, não credencial,
identidade, PostgreSQL ou volume.

O fork WWebJS `1.34.136`, commit
`0e8fcce5d3efb51590bfafaf90d226b721a84e21`, adiciona um gate de capacidade
de no máximo 15 segundos exclusivamente ao bootstrap
`legacy_volume_migration`. Antes da primeira projeção de cada voo, o runtime
precisa provar schema da bridge, enumeração IndexedDB e ABI canônica completa.
O gate não aceita projeção parcial: incompatibilidade persistente continua
falhando fechado. Pairing inicial, handoff entre provedores, restart ativo e
demais fluxos não entram nesse caminho. Se o documento mudar durante o gate,
o erro explícito `wwebjs_legacy_volume_navigation_superseded` entrega a
execução ao sucessor serializado; nenhuma escrita, promoção ou rollback é
feita pelo voo antigo.

Validações antes da publicação:

- testes direcionados do RemoteAuth e lifecycle: `155/155`;
- suítes completas `authStrategies` e `session`: `506` aprovados e `1`
  pendente;
- ESLint e Prettier aprovados;
- pacote seco com os 158 arquivos esperados;
- pacote `@wwebjs/whatsapp-web.js@1.34.136` publicado somente depois do
  commit e push do fork;
- pin Underchat atualizado e os três contratos focados aprovados com
  `693/693`; TypeScript do Worker WWebJS aprovado.

O próximo gate físico continua sendo: commit/push do pin e desta memória,
build apenas do WWebJS pela UI, instalação visual nos dois servidores e troca
somente dos warms WWebJS. A bateria funcional recomeça em `0/5`; o journal
acima permanece apenas como evidência regressiva.

### 2026-08-16 — rollout físico do WWebJS 1.34.136 e baseline oficial 0/5

O journal de diagnóstico `59eaee9a-d0d4-4601-8f3a-96252e8ec526` esgotou as
três tentativas protegidas e terminou automaticamente em `restored`, sem
intervenção destrutiva. O volume permaneceu preservado; `Wwebjs Legacy`
voltou para `legacy_volume`, geração `92`, worker e runtime `online`, estado
nativo `connected=true`, `authenticated=true`, `sessionValid=true`,
`qrAvailable=false`, ACK central verdadeiro e lifecycle liberado. Isso
confirma que o erro anterior não deixou storage híbrido nem perdeu a sessão.

Pela tela de builds foi gerado **somente** o Worker WWebJS
`v20260816040854401`, usando a base Underchat
`2e3f94b1c884f6abc1530a04d7004e9845febe6e`. O build terminou sem erro e se
tornou default com o digest imutável
`sha256:c81fd80ace177a0483d32958bcfcae412702ba19c0945200a70ddd29805976cb`.
Baileys, WhatsMeow e Balance não foram reconstruídos.

As reinstalações foram executadas individualmente pela UI, com o console
visual aberto:

- Server 1: concluído e validado, 460 eventos, zero avisos e zero erros;
- Server 2: concluído e validado, 431 eventos, zero avisos e zero erros;
- em ambos os hosts, `under-worker-wwebjs:latest` e a referência versionada
  apontam para o mesmo digest `c81fd80a...`.

Na tela de canais aquecidos foi aplicado o filtro **Opção 2 (Navegador)** e
`Recriar Todos`, atingindo exatamente quatro warms WWebJS: dois no Server 1 e
dois no Server 2. Todos terminaram `ready`, saudáveis, no digest novo e com o
pacote físico `@wwebjs/whatsapp-web.js@1.34.136`. Runtimes atribuídos antigos
continuam podendo aparecer na auditoria Docker com versões anteriores; eles
não são warms disponíveis e não devem ser confundidos com falha do rollout.

Baseline de aceitação: `Wwebjs Legacy` está novamente conectado no volume,
o source volume existe no Server 1 e a contagem oficial permanece `0/5`. A
partir deste ponto, cada ciclo precisa terminar em `cleanup_pending` na
primeira tentativa, com PostgreSQL online e ACK confirmado; depois a origem
preservada será restaurada pelo journal para repetir o teste. Qualquer falha
zera novamente a sequência.

#### WWebJS volume -> PostgreSQL — ciclo oficial 1/5

O ciclo `6d958569-774a-4938-8f8b-1bb8967bb417` foi iniciado visualmente em
`config?tab=channels` a partir do `Wwebjs Legacy` conectado. Terminou em
`cleanup_pending` na tentativa `1`, revisão `3340`, com volume-fonte
preservado, geração PostgreSQL `94`, worker/runtime `online`, ACK central
verdadeiro e estado nativo `ready`, conectado, autenticado, sessão válida e
sem QR. A UI exibiu **Sessão conectada com sucesso** e foi escolhida a opção
**Manter por enquanto**.

Durante o gate, um full-sync oficial materializou o app-state: uma linha
temporariamente `Dirty` foi mantida como pendente, convergiu para projeção
completa de 2.320 registros/111.568 bytes e somente então recebeu duas
amostras estáveis. Isso é comportamento seguro esperado, não falha. O journal
foi rearmado pelo restore protegido e terminou em `restored`; o canal voltou
a `legacy_volume`, geração `95`, `online`, ACK verdadeiro, lifecycle nulo e
sessão nativa válida. Contagem oficial atual: `1/5`.

#### WWebJS volume -> PostgreSQL — ciclo oficial 2/5

O ciclo `fbe97161-ee53-4d2f-b335-b732c4b3af79` começou visualmente em
`config?tab=channels` às `01:32:27-03` e promoveu a sessão para PostgreSQL na
primeira tentativa. A fase de destino chegou a `cleanup_pending`, revisão
`3341`, geração PostgreSQL `97`, com o volume-fonte preservado, worker e
runtime `online`, ACK central verdadeiro e estado WWebJS `ready`, conectado,
autenticado, `sessionValid=true` e sem QR. A tela confirmou **Sessão conectada
com sucesso** e foi escolhida **Manter por enquanto**.

O restore foi rearmado somente depois de todos esses gates. Durante a volta,
o runtime de volume já publicou `online/ready` enquanto o ACK ainda estava
falso e o lifecycle continuava reservado; esse estado intermediário não foi
considerado sucesso. A conclusão oficial ocorreu apenas em `restored`, às
`01:37:55-03`, com `legacy_volume` nas projeções do worker e runtime, geração
`98`, ACK verdadeiro e lifecycle nulo. O journal permaneceu com
`attempt_count=1`, sem erro e com a fonte preservada. Contagem oficial atual:
`2/5`.

#### WWebJS volume -> PostgreSQL — timeout estrutural de dois boots e reset 0/5

O terceiro ciclo visual, journal
`cc76ba7d-570b-4c69-8755-0e1ab26ea294`, invalidou a sequência anterior e
reiniciou a contagem em `0/5`. A tentativa 1 não encontrou corrupção nem erro
de credencial: preservou o volume, abriu/promoveu a revisão `3342`, autenticou
a geração transitória `99` e depois iniciou corretamente a geração definitiva
`100`, já sem o volume de rollback. Essa segunda geração chegou a
`online/ready`, mas o deadline global de cinco minutos venceu antes de o ACK
central e o lifecycle serem consolidados. O orquestrador iniciou
`attempt_count=2`, portanto o ciclo foi rejeitado mesmo tendo se recuperado.

A causa era estrutural no orçamento, não específica do fork: uma tentativa de
migração volume -> PostgreSQL executa **dois boots independentes** — o runtime
de importação/validação e o runtime definitivo desacoplado do volume —, cada
um autorizado a consumir até quatro minutos de confirmação. O watchdog
externo reservava apenas `4 min + 1 min`, podendo interromper o segundo boot
legítimo. `workerLifecycleBudgets` agora calcula o piso como
`2 * sessionStorageMigrationConnectionConfirmationWaitMs + 1 min`; com os
defaults, a tentativa passa de `300000` para `540000` ms. Os budgets de slot,
gRPC e watchdog pendente continuam derivados desse piso, e o
`.env.example` foi alinhado em `540000` para instalações novas não reintroduzirem
o valor inseguro.

O retry diagnóstico terminou em `cleanup_pending`, revisão `3342`, geração
`102`, online/ready e ACK verdadeiro. Depois da confirmação visual e da opção
**Manter por enquanto**, o restore protegido concluiu em `restored`, volume
legado, geração `103`, online/ready, ACK verdadeiro e lifecycle nulo. A sessão
permaneceu íntegra. Os 25 contratos focados de budgets, orquestração e modelo
de migration passaram. Nenhum fork ou worker foi alterado; a bateria WWebJS
deve começar novamente em `0/5` após commit/push desta correção.

#### WWebJS volume -> PostgreSQL — recheck cercado da validação transitória

O primeiro ciclo posterior ao budget de nove minutos, journal
`e18ef792-1b26-4aa2-8f0b-69d027d1b46e`, confirmou o novo deadline no banco
(`01:53:25-03` -> `02:02:25-03`), mas também revelou uma segunda corrida. A
tentativa 1 preservou o volume, promoveu a revisão `3343` pela geração `104` e
iniciou o runtime definitivo `105`. Enquanto esse runtime ainda publicava
`handoff/handoff_validation`, `validateTarget()` fez uma leitura única,
classificou o alvo como não pronto e iniciou `attempt_count=2` às `01:55:22`,
muito antes do deadline. Logo, não era mais timeout: uma prontidão transitória
estava consumindo uma tentativa inteira.

O plano de controle agora mantém a mesma tentativa e reagenda a validação em
cinco segundos apenas sob um fence estrito: worker/migration, PostgreSQL,
geração alvo, provedor, escopo da migration e revisão ativa não podem
contradizer o journal; telefone/identidade presentes também precisam conferir.
Somente estados nativos recuperáveis de inicialização, restore, conexão,
reconexão ou handoff — além de `online` canônico aguardando subsistemas — são
reconsultados. QR, logout, sessão inválida, erro não recuperável, storage,
geração, revisão, provedor, telefone, identidade ou migration divergentes
continuam falhando fechado. O recheck é sempre limitado pelo deadline de nove
minutos e não incrementa `attempt_count`.

O retry diagnóstico do journal `e18ef792-...` terminou em
`cleanup_pending`, tentativa `2`, revisão `3343`, geração `107`, online/ready e
ACK verdadeiro. Após a confirmação visual, o restore protegido concluiu em
`restored`, volume legado, geração `108`, online/ready, ACK verdadeiro e
lifecycle nulo. O diagnóstico não conta; a sequência continua `0/5`. Os 27
contratos focados passaram, incluindo prova de que handoff recuperável é
reconsultado na mesma tentativa e que `logged_out` terminal continua gerando
retry seguro. Nenhum fork ou worker foi alterado.

#### WWebJS volume -> PostgreSQL — nova sequência oficial 1/5

O primeiro ciclo depois das duas correções, journal
`9d1542d4-41bd-4b24-82a3-aab41a830aef`, iniciou às `02:03:12-03` e terminou
sem retry. A geração de importação `109` promoveu a revisão `3344`; a geração
definitiva `110` permaneceu por mais de dois minutos em
`handoff_validation`, chegou a `online/ready` e foi consolidada em
`cleanup_pending` às `02:06:36-03`, ainda com `attempt_count=1`, ACK verdadeiro,
lifecycle nulo e volume-fonte preservado. A UI exibiu **Sessão conectada com
sucesso** e foi escolhida **Manter por enquanto**.

O restore protegido terminou às `02:08:09-03` em `restored`, com worker e
runtime em `legacy_volume`, geração `111`, online/ready, ACK verdadeiro e
lifecycle nulo. Não houve erro no journal. Essa rodada prova no ambiente vivo
que o handoff transitório não consome mais uma tentativa e que o orçamento
acomoda os dois boots. Contagem oficial pós-correção: `1/5`.

#### WWebJS volume -> PostgreSQL — nova sequência oficial 2/5

O journal `06dd09cf-b6d8-4864-982a-fe95ac566661` iniciou às `02:09:49-03` e
validou o destino às `02:11:56-03`, na primeira tentativa. A geração de
importação `112` promoveu a revisão `3345`; a geração definitiva `113`
terminou PostgreSQL, online/ready, ACK verdadeiro e lifecycle nulo. A UI
confirmou o sucesso e manteve o volume. O restore protegido encerrou às
`02:13:13-03` em `restored`, `legacy_volume`, geração `114`, online/ready, ACK
verdadeiro e lifecycle nulo. Fonte preservada, journal sem erro. Contagem
oficial pós-correção: `2/5`.

#### WWebJS volume -> PostgreSQL — troca entre amostras canônicas e reset 0/5

O terceiro ciclo da sequência, journal
`940562a4-e1bf-4450-bcda-2482b72e4996`, invalidou os dois sucessos anteriores
e reiniciou a contagem oficial em `0/5`. A geração de importação `115`
autenticou a sessão legada e, às `05:15:10.546Z`, exportou uma projeção
canônica completa: 2.319 registros, 111.504 bytes, sete sessões Signal, duas
sender keys e sete chaves de app-state. Aproximadamente três segundos depois,
a segunda amostra exigida pelo mesmo gate encontrou um documento novo ainda
sem o registro privado reidratado e retornou
`wwebjs_canonical_projection_incomplete`, com `module_abi.incompatible`,
módulos ausentes e leituras de device/Signal/app-state indisponíveis. O
runtime publicou `initialization_failed`; o volume-fonte permaneceu
preservado e nenhuma projeção incompleta foi promovida.

A causa é diferente da corrigida em `1.34.136`: o gate inicial de ABI passou
no documento original, mas o full-sync oficial substituiu o documento **entre
as duas amostras estáveis**. O tratamento de supersessão somente reconhecia
erros explícitos do Puppeteer, como `Execution context was destroyed`. A
bridge, corretamente, transformou a leitura do sucessor não hidratado em
erro canônico controlado; por isso o voo antigo finalizou a revisão em vez de
entregar a execução ao voo serializado do novo documento.

O fork `1.34.137`, commit
`9fff83c89291dd187000eb7dbfd77d54db956dad`, passa a reconhecer
`wwebjs_canonical_projection_incomplete` como candidato a troca de documento
somente no bootstrap cercado `legacy_volume_migration`. A recuperação exige
mudança real do `documentEpoch` ou da sequência de navegação no mesmo runtime
e na mesma página, observada diretamente ou dentro da janela curta já usada
para eventos atrasados. Confirmada a troca, o erro é convertido em
`wwebjs_legacy_volume_navigation_superseded`, permitindo que o sucessor
serializado refaça do zero ABI, duas amostras, identidade, revisão e
checkpoint. Se o documento não mudou, a projeção incompleta continua
falhando fechado e executa a finalização protegida normal. Pairing, handoff,
restart PostgreSQL e os demais provedores não entram nessa exceção.

Regressões adicionadas provam os dois lados da fronteira: uma projeção
incompleta após troca real é entregue ao sucessor sem rollback; a mesma falha
no documento corrente continua terminal. RemoteAuth e lifecycle passaram em
`157/157`; as suítes offline completas de autenticação e sessão passaram em
`508` testes, com um teste de concorrência PostgreSQL já marcado como
pendente. ESLint, Prettier e a verificação seca dos 158 arquivos do pacote
também passaram. O pacote foi publicado somente depois do commit/push do
fork. Na Underchat, o pin e o lock apontam para o tarball imutável `1.34.137`
(`sha512-ltj45TYp...`); os contratos do handler, conexão WWebJS e dependência
real passaram em `698/698`, e o TypeScript do Worker WWebJS passou. O comando global do upstream
continua exigindo `WWEBJS_TEST_REMOTE_ID` para testes externos e não é usado
como substituto das suítes determinísticas locais. Antes do próximo ciclo, o
pin e esta memória devem ser commitados/enviados; somente então a imagem
WWebJS deve ser construída e instalada pela UI.

### 2026-08-16 — rollout físico do WWebJS 1.34.137 e novo baseline 0/5

O journal diagnóstico `940562a4-e1bf-4450-bcda-2482b72e4996` não foi contado.
Ainda sob a imagem anterior, ele se recuperou na tentativa `2`, promoveu a
revisão `3346` na geração `117` e chegou a `cleanup_pending` com PostgreSQL
online e ACK central verdadeiro. O restore protegido foi rearmado somente
depois desses gates e terminou em `restored`, geração de volume `118`, sem
erro e com a origem preservada. Assim, a falha que motivou `1.34.137` não
deixou storage híbrido nem perda de sessão.

Pela tela de builds foi gerado **somente** o Worker WWebJS
`v20260816052618314`, usando a base Underchat commitada `916d9e792`. O build
terminou às `02:32-03`, tornou-se default e publicou o digest imutável
`sha256:a0052bc5b85c9af3d0909939bcbe0f2672e95563cf6d3673739744900ab6c3f2`.
Baileys, WhatsMeow e Balance não foram reconstruídos.

As reinstalações foram feitas individualmente pela UI, mantendo o console
visual aberto até a validação:

- Server 1: concluído, 476 eventos, zero avisos e zero erros;
- Server 2: concluído, 467 eventos, zero avisos e zero erros;
- nos dois hosts, `under-worker-wwebjs:latest` e a referência versionada
  resolvem para o mesmo digest `a0052bc5...`.

Na tela de canais aquecidos foi aplicado o filtro **Opção 2 (Navegador)** e
`Recriar Todos`. Os quatro pools filtrados foram substituídos por novos IDs e
voltaram a `ready`: dois no Server 1 e dois no Server 2. Auditoria física
confirmou todos `running/healthy`, no digest novo e com
`@wwebjs/whatsapp-web.js@1.34.137`. Runtimes já atribuídos mantêm a imagem com
que nasceram e não são evidência contra o rollout; antes da nova bateria, o
canal legado de prova deve ser recriado uma vez pela UI para consumir um warm
`1.34.137`. Depois disso a contagem WWebJS recomeça oficialmente em `0/5`.

## 2026-08-16 — encerramento da fila `Recriando` e auditoria integral do lote de QR

O lote de recriação dos canais que estavam em **Aguardando leitura do QR
code**, `01a0085a-9af6-73b7-8fa6-b6661731bf4b`, terminou às
`05:16:10.698Z` com `348/348` alvos concluídos e zero erro. Não existe mais
lote `queued/running`. Quatro leituras independentes entre `02:41:21-03` e
`02:41:56-03` confirmaram simultaneamente:

- `worker.deleted_at IS NULL AND status = recreating`: `0`;
- `config_channels_recreate_batch.status IN (queued, running)`: `0`;
- lifecycle ativo nos 348 alvos do lote: `0`.

Os nove registros ainda encontrados numa consulta sem o fence de exclusão são
tombstones históricos, todos com `deleted_at` preenchido entre janeiro e julho
de 2026. Eles não entram no repositório da tela, na fila ou nas contagens de
canais ativos e não foram alterados manualmente.

### Cinco canais que mantinham a cauda da fila

Os cinco canais observados individualmente não estão mais em `recreating`:

| Canal          | Provider | Geração final | Estado central | Prova nativa final                                      |
| -------------- | -------- | ------------: | -------------- | ------------------------------------------------------- |
| `Vix Suporte`  | Baileys  |          `18` | `disponible`   | `offline/transport_interrupted`                         |
| `TopKza Matão` | Baileys  |           `8` | `disponible`   | `offline/transport_interrupted`                         |
| `ISA`          | Baileys  |          `18` | `disponible`   | `qr/pairing_required`                                   |
| `wpp`          | Baileys  |          `17` | `disponible`   | `offline/transport_interrupted` após o pairing terminal |
| `bruno nunes`  | WWebJS   |           `6` | `disponible`   | `error/initialization_failed`, não recuperável          |

Esse resultado é deliberadamente honesto: uma sessão rejeitada ou sem prova
criptográfica não é promovida artificialmente para `online`. O lifecycle é
encerrado em `disponible`, deixando o canal pronto para um novo pareamento sem
reter o status transitório `recreating/connecting`.

### Causa e correção aplicada ao plano de controle

O commit Underchat `fb68394db` (`fix: finish unavailable recreate terminals`)
resolveu as duas causas que mantinham esses cinco alvos na cauda:

1. Baileys em volume legado podia conservar arquivos após a sessão ter sido
   rejeitada. Como o pedido de conexão não autorizava QR para um canal que já
   estava indisponível, o provider gerava QR internamente, não o publicava e
   terminava em `408`; a redelivery repetia o mesmo ciclo.
2. WWebJS podia publicar no banco o terminal nativo exato e encerrar antes de
   o Manager obter o estado pelo gRPC. Em outra variante, o gRPC respondia sem
   mais conter o evento nativo em memória. Sem fallback durável, a operação
   permanecia aguardando uma prova que já havia sido persistida.

O handler agora:

- define `qr_pending=true` somente quando o recreate começou em um estado já
  indisponível; um canal previamente `online` nunca recebe essa autorização;
- aceita do banco primário apenas terminal QR, logout/sessão inválida ou erro
  não recuperável da mesma conta, servidor, provider, operação, geração,
  container, source e outbox posteriores ao bootstrap;
- usa essa prova tanto quando o gRPC falha quanto quando o runtime responde sem
  evento nativo válido em memória;
- mantém estado live `connecting/offline` como autoridade quando ele existe;
  o fallback durável nunca sobrepõe uma transição viva;
- centraliza o mapeamento provider por tipo e remove a cadeia de ternários do
  caminho de status.

Os gates dessa mudança passaram com `77/77` contratos do repositório,
`552/552` contratos completos do handler, TypeScript e ESLint. Nenhuma variável
de ambiente foi criada.

### Imagem Balance e rollout sem tocar em warms

A correção foi construída localmente no job
`01a008f2-c752-76de-b52f-bbf2f5cd9a38`, versão
`v20260816050203602`, imagem
`harbor.devunder.com/underchat/balance/under-balance-api:v20260816050203602`
e digest imutável
`sha256:c1093a1b3ed254629a8fa0462c8a0c55c47114394d4e3abe8864afe91eeffca3`.
A versão foi pareada e definida em produção; os onze servidores ficaram
`online/healthy` com esse mesmo digest.

O Server 7 teve um journal de instalação preso em `queued/running` sem qualquer
efeito Docker. Somente esse journal foi cancelado e reenviado pela API padrão;
a segunda tentativa concluiu. Não houve pull ou recriação de worker nesse
retry.

Antes e depois do rollout, os fences físicos foram idênticos:

- warms: `159`, hash
  `127a11472296639f17485153b4559dfe2358a0a024623e5393ff8008d90ad2be`;
- runtimes estáveis fora dos três alvos então ativos: `1041`, hash
  `fae2ab3e6b424da38c2f50e89311c46c4b5dd6977400c5eb24eea0aa6a6fab8a`.

Portanto nenhuma atualização automática, parada ou recriação de warm/canal
foi feita pelo rollout. A política continua sendo recriar warms apenas pela
ação manual correspondente.

### Auditoria dos 348 canais e prova de que nenhuma sessão válida foi ignorada

O resultado final do lote foi auditado por alvo, provider, runtime, evento
nativo e volume físico nos onze servidores:

- `144` voltaram comprovadamente `online`: `143` WhatsMeow e `1` Baileys, todos
  com ACK central;
- `204` terminaram corretamente em `disponible`;
- nenhum alvo permaneceu com lifecycle ou slot de recreate ativo.

Nos `204` indisponíveis, a inspeção física somente leitura encontrou:

| Provider  | Quantidade | Evidência terminal                                                                                                 |
| --------- | ---------: | ------------------------------------------------------------------------------------------------------------------ |
| Baileys   |      `117` | `22` volumes ausentes, `91` sem `creds.json` e `4` credenciais com `registered != true`                            |
| WWebJS    |       `46` | `27` volumes ausentes e `19` perfis ativos sem a combinação mínima IndexedDB + Cookies/Local Storage               |
| WhatsMeow |       `41` | `38` sem identidade de device utilizável (`initializing`, sem sessão) e `3` com `remote_logout/sessionValid=false` |

Uma busca preliminar encontrou quatorze árvores WWebJS grandes em diretórios
históricos/quarentenados. A segunda passagem usou o caminho ativo exato
`wwebjs/storage/<worker>/session-<worker>` e comprovou que nenhuma delas era o
perfil restaurável atual. O resultado forte final foi
`STRONG_BUT_UNAVAILABLE=0`: nenhum `registered=true` Baileys, perfil WWebJS
restaurável ou device WhatsMeow válido ficou de fora da recuperação.

Conclusão operacional desta rodada: fila concluída, zero canal ativo em
`recreating`, zero lote pendente, zero sessão forte ignorada, banco não editado
manualmente e warms intactos.

## 2026-08-16 — WWebJS volume -> PostgreSQL, sequência 1/5 no `1.34.137`

Depois do rollout físico do digest `sha256:a0052bc5...` e da recriação do
canal legado na geração `119`, a nova contagem oficial foi iniciada do zero.
O journal `2e882136-3b15-4897-9a9b-0b02079ddf59` concluiu a migração em
`cleanup_pending` na primeira tentativa, promoveu a revisão `3347` e ficou na
geração PostgreSQL `121`. O runtime terminou `online/ready`, autenticado,
`sessionValid=true`, sem QR, com ACK central verdadeiro e lifecycle nulo. O
volume de origem permaneceu fisicamente presente e marcado como preservado.

A UI visível exibiu **Sessão conectada com sucesso**; foi escolhida a opção
**Manter por enquanto**. Somente após todos os gates acima o helper de retorno
protegido foi armado. O journal terminou `restored` às `02:52:58-03`; worker e
runtime retornaram a `legacy_volume` na geração `122`, `online/ready`, ACK
verdadeiro, lifecycle nulo e sem erro no journal. O runtime alvo e o runtime
restaurado usaram a imagem nova com `@wwebjs/whatsapp-web.js@1.34.137`.

Resultado oficial consecutivo do baseline novo: **WWebJS `1/5`**. A passagem
interna da geração de importação `120` para a geração definitiva `121` é parte
normal do cutover e não consumiu retry (`attempt_count=1`).

### WWebJS volume -> PostgreSQL — sequência 2/5 no `1.34.137`

O journal `2af7a076-1bf8-4fb1-8bcc-62c635f4dda0` iniciou às `02:55:01-03` e
chegou a `cleanup_pending` às `02:58:18-03`, sem retry. A geração de importação
`123` promoveu a revisão `3348`; a geração definitiva PostgreSQL `124`
terminou `online/ready`, autenticada, com sessão válida, sem QR, ACK central
verdadeiro e lifecycle nulo. O volume-fonte permaneceu preservado.

A confirmação foi acompanhada na UI visível e **Manter por enquanto** foi
selecionado. O restore protegido encerrou às `02:59:08-03` em `restored`,
`legacy_volume`, geração `125`, `online/ready`, ACK verdadeiro, lifecycle nulo
e journal sem erro. Resultado oficial consecutivo: **WWebJS `2/5`**.

### WWebJS volume -> PostgreSQL — sequência 3/5 no `1.34.137`

O journal `23f5609e-3a5f-4f1f-96d7-87f9d52bb19a` iniciou às `03:00:15-03` e
terminou `cleanup_pending` às `03:03:57-03`, ainda em `attempt_count=1`. A
rodada exercitou a variante mais lenta de full-sync/handoff: a geração de
importação `126` permaneceu em validação protegida, promoveu a revisão `3349`
e entregou a geração definitiva `127`, sem QR, erro ou retry. O resultado
final foi PostgreSQL `online/ready`, autenticado, sessão válida, ACK verdadeiro
e lifecycle nulo, mantendo a origem preservada.

Depois da confirmação visual e de **Manter por enquanto**, o restore protegido
encerrou às `03:04:48-03` em `restored`, `legacy_volume`, geração `128`,
`online/ready`, ACK verdadeiro e lifecycle nulo. Resultado oficial
consecutivo: **WWebJS `3/5`**.

### WWebJS volume -> PostgreSQL — sequência 4/5 no `1.34.137`

O journal `6da630c4-f78c-45be-b278-26722639b92b` começou às `03:05:54-03` e
atingiu `cleanup_pending` às `03:08:56-03`, em `attempt_count=1`. A geração de
importação `129` promoveu a revisão `3350` e a geração definitiva PostgreSQL
`130` terminou `online/ready`, autenticada, sessão válida, sem QR, ACK central
verdadeiro e lifecycle nulo. A origem permaneceu preservada.

Após a confirmação visual e **Manter por enquanto**, o retorno protegido
terminou às `03:10:21-03` em `restored`, `legacy_volume`, geração `131`,
`online/ready`, ACK verdadeiro, lifecycle nulo e sem erro. Resultado oficial
consecutivo: **WWebJS `4/5`**.

### WWebJS volume -> PostgreSQL — getter lazy de identidade e reset 0/5

A quinta passagem, journal `eead5a7c-ffb0-4545-9822-5445c63db5d7`,
invalidou a sequência `4/5` e reiniciou a contagem em `0/5`. Na geração `132`,
a projeção canônica foi exportada completa às `06:11:50.628Z`: 2.319
registros, 111.504 bytes, sete sessões Signal, duas sender keys e sete chaves
de app-state. Durante o full-sync, o getter lazy do registro privado usado
pela identidade lançou `Invariant Violation: Minified invariant #56367; %s`.
Como a leitura ocorria depois das duas amostras canônicas e antes do primeiro
checkpoint autorizado, nenhuma projeção foi promovida; o runtime publicou
`initialization_failed` e o volume-fonte permaneceu preservado.

O fork `1.34.138`, commit
`784a384c`, normaliza exceções de getters lazy/proxy para
`wwebjs_companion_identity_read_failed`. Somente no bootstrap cercado
`legacy_volume_migration`, a identidade é relida até vinte vezes, a cada
250 ms. Cada tentativa continua antes da primeira persistência: uma leitura
válida ainda precisa passar pela comparação de JID, fingerprint, projeção,
revisão e fence. Se o documento mudar, o voo antigo é entregue ao sucessor
serializado; se o getter continuar falhando no mesmo documento, a operação
continua terminal e executa o rollback/finalização normal. Pairing, handoff,
restart PostgreSQL e demais provedores não recebem esse retry.

As regressões novas provam: normalização do getter interno; recuperação no
mesmo documento; entrega após troca real de documento; e falha persistente no
mesmo documento continuando fail-closed. As suítes focadas passaram em
`129/129`; autenticação e sessão offline completas passaram em `512`, com um
teste de concorrência PostgreSQL já marcado como pendente. ESLint, Prettier e
o pacote seco de 158 arquivos também passaram. O pacote foi publicado após
commit/push como `@wwebjs/whatsapp-web.js@1.34.138`, integridade
`sha512-Xba2yeGeS3KVD0nR3XBAA/MBF9oWBn+0RQuDcGAZzrcWQcS0ItRl9RkPr3xL6d5zosEoZ3WrqjAe/cQIVnoURw==`.
Antes de qualquer build, o pin, lock, contrato e esta memória devem ser
commitados/enviados. O retry automático do journal que falhou é apenas
diagnóstico e nunca entra na nova contagem.

### Rollout físico do `1.34.138` e baseline oficial novamente em `0/5`

O retry diagnóstico do journal
`eead5a7c-ffb0-4545-9822-5445c63db5d7` chegou a `cleanup_pending` na segunda
tentativa, revisão `3351` e geração PostgreSQL `134`. Ele não foi contado. O
restore protegido só foi armado depois de `online/ready`, autenticação e
sessão válidas, ausência de QR, ACK central e lifecycle nulo. O journal
terminou `restored`; o canal voltou a `legacy_volume` na geração `135`, com os
mesmos gates online e o volume físico preservado.

O pin Underchat do pacote `1.34.138` foi testado antes do build e enviado no
commit `a83e37175`. A imagem foi produzida exclusivamente para o Worker WWebJS
pela UI, no build `v20260816062607721`, concluído às `03:32:16-03`. A versão
foi definida automaticamente como default e possui o digest imutável
`sha256:8a7fd05e0e22148d863948591b27f78a7fe9828edd56f5ac0e5fbd8552fc98d7`.

A primeira instalação visual no Server 1 revelou um problema operacional do
host, não do pacote: o filesystem raiz estava em `100%` (`47/48 GB`) e o pull
falhou ao extrair uma camada em `/var/lib/containerd`. O instalador foi
cancelado antes de repetir inutilmente `120` vezes. `docker system df`
comprovou `24,45 GB` em imagens sem contêiner ativo. Foi executado apenas
`docker image prune --all --force`: nenhum contêiner ativo, volume ou sessão
foi removido, e o host passou a `52%`, com `22 GB` livres. O preflight do
Server 2 encontrou `93%` de uso e `26,11 GB` igualmente recuperáveis; a mesma
limpeza estritamente limitada a imagens inativas levou o host a `39%`, com
`28 GB` livres.

As instalações seguintes foram feitas pela UI, uma por servidor. O Server 1
terminou com `408` eventos, zero aviso e zero erro; o Server 2, com `335`
eventos, zero aviso e zero erro. Ambos validaram o digest acima. Em seguida,
o filtro **Opção 2 (Navegador)** da tela de warms foi aplicado e somente os
quatro warms WWebJS foram recriados. Os quatro ficaram `ready/healthy` nos
dois servidores, todos com o digest novo e
`@wwebjs/whatsapp-web.js@1.34.138`.

Por fim, o canal `Wwebjs Legacy` foi recriado visualmente com **Manter a
conexão atual**. Ele terminou em `legacy_volume`, geração `136`,
`online/ready`, autenticado, `sessionValid=true`, sem QR, ACK central
verdadeiro e lifecycle nulo. O contêiner
`d30c97d23d41e7181b3530af1bd1867094072b78ba5536bdde1aaedd93a9e931`
está `healthy`, no digest novo e com pacote `1.34.138`.

Este rollout e a recriação de baseline não contam como passagem da bateria.
A próxima migração inicia a nova sequência oficial WWebJS em **`0/5`**. Se
qualquer uma das próximas cinco operações consumir retry, falhar em um gate
ou perder a sessão, a contagem volta imediatamente a zero.

### WWebJS volume -> PostgreSQL — sequência 1/5 no `1.34.138`

O journal `aa9e407f-7dd9-4d1c-b4bb-523fc46b2179` concluiu a primeira passagem
oficial do novo baseline em `cleanup_pending`, sem retry
(`attempt_count=1`). A geração de importação `137` promoveu a revisão `3352`;
a geração definitiva PostgreSQL `138` terminou `online/ready`, autenticada,
`sessionValid=true`, sem QR, com ACK central verdadeiro e lifecycle nulo. A
origem permaneceu fisicamente presente e marcada como preservada.

A UI visível confirmou **Sessão conectada com sucesso** e foi escolhida a
opção **Manter por enquanto**. O restore protegido terminou em `restored`,
`legacy_volume`, geração `139`, `online/ready`, autenticação e sessão válidas,
sem QR, ACK verdadeiro e lifecycle nulo. Resultado oficial consecutivo do
`1.34.138`: **WWebJS `1/5`**.

### WWebJS volume -> PostgreSQL — navegação após promoção e novo reset `0/5`

A passagem seguinte, journal
`fed3211a-cf48-4ce0-a14c-022e837966cc`, invalidou a sequência e reiniciou a
contagem em **WWebJS `0/5`**. Embora o journal do Manager tenha permanecido em
`attempt_count=1`, o primeiro runtime PostgreSQL não concluiu a inicialização:
o Chromium foi encerrado depois da promoção e o Worker executou uma nova
tentativa interna. A revisão `3353` somente chegou aos gates completos na
geração `141`; o cutover entregou a geração `142`. Como o critério desta
bateria rejeita qualquer retry interno, a operação não foi contada. O retorno
protegido encerrou o journal em `restored`, com o canal novamente no volume e
online.

Uma reprodução dedicada foi feita no journal
`b818eacf-cad5-4b68-b4e6-f11623ff410b`, sem contar para a bateria. Os logs
foram capturados diretamente desde o nascimento do contêiner de importação.
O primeiro voo de prontidão construiu e atestou a identidade, estabilizou o
app-state e promoveu atomicamente a revisão `3354`. O evento
`checkpoint.completed` ocorreu em `2026-08-16T07:08:36.774Z`. Imediatamente
depois, uma navegação legítima do frame principal substituiu o documento
(`navigation sequence 0 -> 3`) antes de o Client publicar READY. O sucessor
serializado repetiu corretamente as provas de identidade e geração, porém
`afterAuthReady()` havia zerado `authReady` no início do novo voo. Como a
revisão já estava `active`, o checkpoint canônico genérico recusou persistir
antes de READY e devolveu `false`. Esse `false` foi classificado incorretamente
como `handoff_checkpoint_not_persisted`, fechando página/browser e provocando
um retry interno desnecessário.

Esse diagnóstico descarta falta de CPU, memória, disco e perda de sessão: o
primeiro checkpoint já estava durável, a revisão estava promovida e o segundo
documento pertencia ao mesmo runtime. A reprodução chegou com segurança a
`cleanup_pending` na geração `144`; somente após todos os gates online o
restore foi armado. O journal terminou `restored`, `legacy_volume`, geração
`145`, `online/ready`, ACK verdadeiro e origem preservada.

### Correção cercada do sucessor READY no WWebJS `1.34.139`

O fork `@wwebjs/whatsapp-web.js@1.34.139`, commit `379a8da6`, guarda a
proveniência do último checkpoint READY durável pelo epoch exato do runtime.
Um segundo `afterAuthReady()` só pode usar o novo caminho
`checkpointReadyNavigationSuccessor` quando todas estas condições continuam
verdadeiras:

- a revisão já está `active` e o provider usa PostgreSQL nativo;
- runtime epoch, document epoch e navigation sequence são exatamente os que
  foram provados pelo voo atual;
- a proveniência durável pertence ao mesmo runtime;
- não existe restart ativo, activation marker, promoção pendente, handoff,
  admissão de checkpoint fechada ou shutdown.

O fence é revalidado depois do `flush` e da exportação, imediatamente antes
da persistência. Se outra navegação substituir o documento nesse intervalo,
nenhuma escrita, ACK de journal ou finalização destrutiva é feita; o voo é
entregue ao próximo sucessor serializado. Pairing, handoff entre providers,
restart PostgreSQL, recreate e os demais providers continuam usando os
caminhos fail-closed anteriores. A proveniência também é apagada em cada
`beforeBrowserInitialized`, impedindo reutilização entre runtimes.

As provas novas cobrem: checkpoint do sucessor no mesmo runtime depois da
promoção; rejeição fora do runtime provado; e substituição do documento no
meio da exportação sem persistência ou rollback destrutivo. Os testes focados
passaram em `3/3`; `RemoteAuth` + lifecycle em `163/163`; a suíte offline
ampliada de autenticação, sessão, cache e utilitários em `546 passing` e
`1 pending`. ESLint, Prettier, cache web, bundle e pacote seco de 158 arquivos
também passaram. O `npm test` genérico inclui testes externos que exigem
`WWEBJS_TEST_REMOTE_ID` e, por isso, não substitui essas suítes determinísticas.

O pacote `1.34.139` foi publicado com integridade
`sha512-Zl5WOsBEQYdqsZ4LI45ja+BHNhRnMODCP184xsqMvDLMo6OS2Q9Do9ivHGdURgUNo+y8Qrkny4X9yYWP0n/8Rg==`.
O pin real, lock e contrato Underchat foram atualizados; os contratos da
dependência, conexão WWebJS e command handler passaram em `698/698`. Antes do
próximo build, essas alterações e esta memória devem estar commitadas e
enviadas. Deve ser construída e instalada **somente** a imagem WWebJS. Após o
rollout e a recriação do warm/canal legado, a contagem oficial permanece
**WWebJS `0/5`** e só avança com cinco migrações consecutivas sem qualquer
retry interno.

### Rollout e baseline físico do WWebJS `1.34.139`

O pin, lock, contrato e esta memória foram commitados e enviados antes do
build no commit Underchat `d449f4e04`; o fork já estava publicado no commit
`379a8da6`. Pela tela de build foi gerada **somente** a imagem WWebJS
`v20260816072523937`, job `01a00976-0261-77a8-a191-e2813f1341b3`. O OCI
index instalado é
`sha256:f9e9ab92178b8592d75cc6e2c094aae6ac4a3bcdf7a26d720dc4d122d6fc3062`.

As duas instalações foram executadas pela UI. O Server 1 encerrou com `481`
eventos, zero aviso e zero erro; o Server 2, com `457` eventos, zero aviso e
zero erro. A auditoria posterior nos hosts comprovou que `latest` e a tag
versionada apontam para o mesmo digest em ambos.

Na tela de canais aquecidos foi aplicado o filtro **Opção 2 (Navegador)** e
usado **Recriar Todos**. Somente os quatro warms WWebJS filtrados foram
substituídos: `01a00982-e5b2-7419-bf59-f249c4b31ac8` e
`01a00982-e5f5-7638-ac2e-8c18cbbf9769` no Server 1;
`01a00982-e581-7316-8153-df994ba7f58a` e
`01a00982-e5df-7563-bfb1-e4c3d705d728` no Server 2. Todos ficaram
`ready/healthy`, no digest `f9e9ab...`, e a inspeção dentro dos quatro
contêineres confirmou `@wwebjs/whatsapp-web.js@1.34.139`. Os warms dos outros
providers permaneceram intactos.

Como prova de baseline, `Wwebjs Legacy` foi recriado visualmente com **Manter
a conexão atual**. Ele consumiu o pacote novo no contêiner
`d9baf9fa0c02`, geração `146`, e chegou de `initializing` a `online/ready`
com uma única tentativa: autenticado, `sessionValid=true`, sem QR, ACK central
verdadeiro, lifecycle nulo e sessão ainda `legacy_volume`. Não houve retry,
troca adicional de contêiner ou janela offline após o READY. Essa recriação
de rollout não conta para as baterias finais. A sequência oficial de
migração volume -> PostgreSQL começa agora em **WWebJS `0/5`** sobre o
`1.34.139`.

### WWebJS volume -> PostgreSQL — sequência `1/5` no `1.34.139`

O journal `73d85916-dfba-4d4e-948a-6ef458b164f6` concluiu a primeira
passagem oficial do pacote corrigido em `cleanup_pending`, com
`attempt_count=1`. A geração de importação `147` criou/promoveu a revisão
`3355` em um único `client_initialize`; a geração definitiva `148` concluiu
o replay canônico, a sincronização oficial do app-state e duas amostras
estáveis antes de chegar a `online/ready`, autenticada, `sessionValid=true`,
sem QR e com ACK central verdadeiro. Não houve segunda tentativa interna,
troca inesperada de runtime ou atalho dos gates.

A UI visível mostrou **Sessão conectada com sucesso** e foi selecionado
**Manter por enquanto**. O retorno protegido para a origem preservada terminou
em `restored`, `legacy_volume`, geração `149`, novamente `online/ready`, com
ACK verdadeiro e lifecycle encerrado. Contagem oficial atual:
**WWebJS `1/5`**.

### WWebJS volume -> PostgreSQL — sequência `2/5` no `1.34.139`

O journal `8f95e9ed-0fd5-4442-96bc-d995fb7e5563` terminou em
`cleanup_pending`, `attempt_count=1`. A geração de importação `150` promoveu
a revisão `3356`; a geração definitiva `151` passou pelo handoff e chegou a
`online/ready` com ACK verdadeiro. Nos dois runtimes cada
`client_initialize_started/completed` permaneceu em `attempt=1`.

Depois da aposentadoria deliberada da geração `150`, o logger daquele
contêiner ainda registrou `flush_failed` por frame já destacado. Isso ocorreu
somente após a troca normal para a geração definitiva, não abriu nova
tentativa e não afetou a revisão ativa; portanto não é o retry que invalida a
bateria. A UI confirmou sucesso e **Manter por enquanto** foi selecionado. O
restore encerrou em `restored`, `legacy_volume`, geração `152`,
`online/ready`, ACK verdadeiro e lifecycle nulo. Contagem oficial:
**WWebJS `2/5`**.

### WWebJS volume -> PostgreSQL — retry interno na terceira passagem e reset `0/5`

O journal `c9b4181f-a7fe-432b-880d-d7ac32dad56b` invalidou a sequência e
reiniciou a contagem em **WWebJS `0/5`**. A geração de importação `153`
promoveu a revisão `3357` e chegou a `connection.online_readiness_proven`,
mas a segunda prova forte executada depois de subir o consumo de mensagens
devolveu prontidão temporariamente falsa. O serviço publicou
`ready_provider_readiness_failed`; sem ACK central, o orquestrador aposentou a
geração `153` e abriu a `154`. Isso é retry interno e invalida a passagem,
mesmo com o journal em `attempt_count=1`.

A geração `154` concluiu os gates e levou o journal a `cleanup_pending`. A UI
confirmou sucesso, **Manter por enquanto** foi mantido, e o restore protegido
terminou em `restored`, `legacy_volume`, geração `155`, `online/ready` e ACK
verdadeiro. A origem nunca foi descartada. Os próximos passos são reproduzir
com o objeto completo de readiness, separar indisponibilidade transitória de
falha de sessão e corrigir sem relaxar identidade, sessão, app-state,
JetStream ou fences de geração. Nenhuma nova passagem conta antes dessa
análise.

### WWebJS — causa do retry por backpressure pré-ACK e fence corretivo

A investigação decodificou os campos redigidos do evento que derrubou a
geração `153`: `provider_state=probe_deferred_backpressure` e
`degraded_reason=provider_capacity_saturated`. Portanto, não houve prova
negativa de sessão, identidade ou app-state. O segundo
`verifyCurrentSession()`, executado depois de a primeira prova forte já ter
passado, encontrou a capacidade de invocações do provider ocupada e devolveu
um resultado inconclusivo.

O defeito estava na retenção cercada de `lastStrictReady`: ela já exigia o
mesmo objeto `Client` e idade máxima de dois intervalos de health check
(`60 s`), mas também exigia `connectionEstablished=true`. Esse flag só é
armado depois do ACK central; logo, durante a janela legítima entre o READY
nativo e o ACK, a prontidão forte recém-comprovada era descartada. O
backpressure inconclusivo virava `session_ready=false`, o runtime era
aposentado e uma tentativa interna desnecessária era iniciada.

O journal diagnóstico `973a4ba2-134d-4317-81f9-ecbcc8a13968` confirmou a
intermitência: importação na geração `156`, revisão `3358`, geração definitiva
`157`, `attempt_count=1` e nenhum retry interno. Depois de todos os gates, o
restore protegido terminou em `restored`, `legacy_volume`, geração `158`,
`online/ready`, com ACK verdadeiro. Essa operação foi apenas diagnóstica e
não conta para a nova sequência.

A correção no serviço Underchat acrescenta uma prova nativa explícita ao
cache de prontidão. Durante o pré-ACK, um resultado forte recente só pode ser
retido quando simultaneamente:

- pertence exatamente ao mesmo objeto `Client`;
- tem no máximo `60 s`;
- o `Client` ainda é a fonte nativa corrente da conexão; e
- o status nativo corrente continua classificado como online.

Se o cliente mudar, o cache expirar, o status sair de online ou a leitura do
status lançar erro, o caminho continua fail-closed e o backpressure não é
convertido em sucesso. O ajuste não aceita uma prova negativa, não altera os
gates de identidade, sessão, app-state, lifecycle, geração, JetStream ou ACK
e não muda o comportamento dos demais providers.

Os contratos novos cobrem tanto a retenção pré-ACK do mesmo cliente online
quanto a recusa imediata quando o status nativo deixa de estar online. A
suíte ampliada de `healthCheck`, `connection` e `workerCommandHandler` passou
em **719/719**, ESLint e Prettier passaram, `git diff --check` ficou limpo e o
typecheck completo terminou sem erros. Antes do rollout, a correção e esta
memória devem ser commitadas e enviadas. Deve ser gerada e instalada somente
a imagem WWebJS. Depois do rollout e da prova física do pacote, a bateria
oficial recomeça em **WWebJS `0/5`**; qualquer novo retry ou gate incompleto
reinicia novamente a contagem.

### Rollout do fence pré-ACK e baseline WWebJS — `aa1ff764b`

A correção foi commitada e enviada ao `origin/main` no commit
`aa1ff764b` antes de qualquer build. Pela UI visível foi gerada somente a
imagem WWebJS `v20260816081231438`; Baileys, WhatsMeow e Balance não fizeram
parte do job. O build terminou `Concluído` às `05:18-03`. A imagem possui o
digest imutável
`sha256:5658ab72c2c3f5d6c770447080c6aceca38593282ef9c2995b73fefb6f243276`.

As duas instalações foram executadas sequencialmente pela UI. O Server 1
terminou com `451` eventos, zero aviso e zero erro; o Server 2, com `463`
eventos, zero aviso e zero erro. A auditoria SSH confirmou que a tag
versionada e `under-worker-wwebjs:latest` apontam para o digest novo nos dois
hosts.

Depois do rollout, somente os quatro warms filtrados como **Opção 2
(Navegador)** foram recriados. Os novos warms são
`01a009ae-47f4-70bb-8407-16ff7095b7a4` e
`01a009ae-4790-710e-87fe-12caa0c3cf34` no Server 1, e
`01a009ae-480b-753d-ad3a-3f1e9d280740` e
`01a009ae-47ad-743c-a767-eee4e3c1a098` no Server 2. Todos ficaram
`running/healthy`, no digest `5658ab72...`, e a auditoria dentro dos quatro
contêineres confirmou `@wwebjs/whatsapp-web.js@1.34.139`.

O `Wwebjs Legacy` foi recriado com **Manter a conexão atual** como prova de
baseline. Ele chegou a `online/ready`, ACK central verdadeiro e lifecycle
nulo na geração `159`, contêiner `99d316e44677`, mantendo
`legacy_volume`. O contêiner está `running/healthy`, no digest novo, com o
fork `1.34.139`; houve um único
`client_initialize_started/completed`, ambos em `attempt=1`.

Durante esse baseline, o primeiro probe forte disparado imediatamente pelo
READY encontrou `provider_capacity_saturated`. Como ainda não existia
`lastStrictReady`, o novo fence corretamente não inventou uma prova positiva:
o status central recusou a tentativa transitória de downgrade por já possuir
ONLINE nativo, e o state-probe cercado comprovou a sessão cerca de dois
segundos depois no mesmo cliente e runtime. Não houve segunda inicialização,
troca de contêiner ou perda de sessão. Esse caminho é distinto do defeito da
geração `153`, no qual uma primeira prova forte já existia antes de o segundo
probe encontrar backpressure. Relaxar o baseline sem prova anterior faria o
sistema aceitar ausência de evidência como sucesso e não deve ser feito.

O rollout e a recriação-baseline não contam na bateria. A sequência oficial
permanece **WWebJS `0/5`** e começa no próximo volume -> PostgreSQL. Nessa
migração devem ser verificados tanto o primeiro probe forte quanto a retenção
cercada no segundo probe; qualquer tentativa interna reinicia a contagem.

### WWebJS volume -> PostgreSQL — nova sequência `1/5`

O journal `fcda77da-a937-47e4-a921-c4f5d67a884b` fechou a primeira passagem
oficial depois do rollout do fence pré-ACK. A importação ocorreu na geração
`160`, promoveu a revisão `3359`, e o runtime definitivo foi a geração `161`,
contêiner `7350ef130f3e`, no digest `5658ab72...`. O journal terminou em
`cleanup_pending`, `attempt_count=1`, sem erro; o runtime definitivo chegou a
`online/ready`, autenticado, `sessionValid=true`, sem QR, ACK central verdadeiro
e lifecycle nulo. A UI visível apresentou **Sessão conectada com sucesso**.

As gerações de importação e definitiva tiveram uma única inicialização cada,
sempre em `attempt=1`; não houve terceira geração, aposentadoria por falha ou
retry interno. Na geração definitiva, um callback READY concorrente encontrou o
gate ainda em `client_initializing` e produziu temporariamente
`connection_launching`. O status central recusou esse downgrade porque a mesma
geração já possuía prova nativa ONLINE, e o state-probe cercado confirmou a
sessão logo em seguida. Esse evento não abriu nova tentativa, não trocou o
contêiner, não perdeu a sessão e deve permanecer fail-closed: transformar
`connection_launching` em sucesso antes da primeira prova forte aceitaria
ausência de evidência.

Foi selecionado **Manter por enquanto** e executado o retorno protegido da
origem. O journal terminou em `restored`; o worker voltou a `legacy_volume` na
geração `162`, novamente `online/ready`, com ACK verdadeiro e lifecycle nulo.
Contagem oficial atual: **WWebJS `1/5`**.

### WWebJS volume -> PostgreSQL — nova sequência `2/5`

O journal `d3bc7f8d-d885-4b3b-ae38-efb89d82ff4c` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3360`. A importação usou a
geração `163`; a geração definitiva `164`, contêiner `79bb9152d34f`,
executou um único `client_initialize` em `attempt=1`, comprovou duas amostras
de prontidão online e terminou `online/ready`, autenticada, sem QR, ACK
verdadeiro e lifecycle nulo. Não houve retry interno, runtime adicional ou
falha de migração. O callback READY concorrente repetiu apenas o evento
transitório e fail-closed `connection_launching`; o state-probe da mesma
geração confirmou a conexão cerca de um segundo depois, sem aposentadoria.

A UI visível confirmou **Sessão conectada com sucesso**, foi mantido o volume
por enquanto, e o retorno protegido terminou em `restored`,
`legacy_volume`, geração `165`, `online/ready`, ACK verdadeiro e lifecycle
nulo. Contagem oficial atual: **WWebJS `2/5`**.

### WWebJS volume -> PostgreSQL — nova sequência `3/5`

O journal `4c11cbf1-74ac-4c40-bc26-e66056c951da` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3361`. A geração `166`
executou a importação e a geração definitiva `167`, contêiner
`81a3c7b57b37`, comprovou a sessão com exatamente um
`client_initialize_started/completed`, ambos em `attempt=1`. O runtime
chegou a `online/ready`, autenticado, `sessionValid=true`, sem QR, ACK
verdadeiro e lifecycle nulo, sem retry ou runtime intermediário adicional.

A UI visível apresentou **Sessão conectada com sucesso**. Depois de
**Manter por enquanto**, o restore terminou em `restored`, `legacy_volume`,
geração `168`, `online/ready`, ACK verdadeiro e lifecycle nulo. Contagem
oficial atual: **WWebJS `3/5`**.

### WWebJS volume -> PostgreSQL — nova sequência `4/5`

O journal `f1940fd8-1d66-4280-a95f-b9ec03b7043b` terminou em
`cleanup_pending`, `attempt_count=1`, revisão `3362`. A importação ocorreu
na geração `169` e a geração definitiva `170`, contêiner
`ab92d8442d58`, executou exatamente um ciclo de inicialização em
`attempt=1`, chegou a `online/ready`, autenticado, `sessionValid=true`, sem
QR, ACK verdadeiro e lifecycle nulo. A espera maior foi integralmente o
handoff/app-state cercado; não houve retry, erro ou terceira geração.

A UI visível confirmou o sucesso e o retorno protegido encerrou em
`restored`, `legacy_volume`, geração `171`, `online/ready`, ACK verdadeiro e
lifecycle nulo. Contagem oficial atual: **WWebJS `4/5`**.

### WWebJS volume -> PostgreSQL — nova sequência `5/5` concluída

O journal `bc9c1c05-bdb4-4b3a-8acc-12c317483449` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3363`. A importação usou a
geração `172` e a geração definitiva `173`, contêiner
`b484f345bd98`, executou um único `client_initialize` em `attempt=1`.
Durante o replay, o stream nativo ficou desconectado sem comms por `15 s`; o
recovery cercado fez uma única recarga do documento, preservou as credenciais
e recuperou o transporte. A materialização oficial do app-state manteve uma
linha transitória `app_state_versions.row_incompatible` até concluir a
sincronização; por isso esta passagem levou cerca de `2m43s`, mas não pulou
nenhum gate e terminou com duas amostras estáveis.

Logo depois do READY nativo, um state-probe concorrente encontrou a capacidade
do provider ocupada e publicou provisoriamente
`state_probe_verification_failed`. Como ainda não havia prova forte anterior
no cache, o caminho permaneceu corretamente fail-closed; a prova nativa ONLINE
impediu o downgrade central e o mesmo runtime publicou a prontidão forte cerca
de `1,3 s` depois. Não houve retry, nova inicialização, runtime adicional,
QR, perda de sessão ou erro no journal.

A geração `173` terminou `online/ready`, autenticada, `sessionValid=true`,
sem QR, ACK verdadeiro e lifecycle nulo. A UI visível confirmou **Sessão
conectada com sucesso**. Depois de manter o volume, o restore protegido fechou
em `restored`, `legacy_volume`, geração `174`, novamente `online/ready`, ACK
verdadeiro e lifecycle nulo.

Resultado da bateria consecutiva de storage: **WWebJS `5/5`**. As cinco
passagens oficiais desta nova sequência foram os journals `fcda77da...`,
`d3bc7f8d...`, `4c11cbf1...`, `f1940fd8...` e `bc9c1c05...`; todas ficaram em
`attempt_count=1`, com exatamente uma geração de importação e uma definitiva,
e todas retornaram com segurança ao volume para permitir a passagem seguinte.

### Baileys volume -> PostgreSQL — nova sequência `1/5`

Antes da nova bateria, o journal preservado `b2fe78d5...` foi restaurado pelo
fluxo protegido, recolocando `Baileys Legacy` em `legacy_volume`, geração
`35`, `online/connection_validated`, ACK verdadeiro e lifecycle nulo. Não
houve manipulação direta de arquivos ou flags de banco.

A primeira passagem oficial usou o journal
`810aa4d4-8f6b-4e5a-bb43-f89b9cbbdf6a`. A importação ocorreu na geração
`36`, promoveu a revisão `3364`, e a definitiva `37`, contêiner
`57539b62a9a2`, validou as credenciais e a conexão sem QR. O journal terminou
em `cleanup_pending`, `attempt_count=1`; o runtime ficou
`online/connection_validated`, autenticado, `sessionValid=true`, ACK
verdadeiro e lifecycle nulo, sem retry ou geração adicional.

A UI visível mostrou **Sessão conectada com sucesso**. Depois de manter o
volume, o restore terminou em `restored`, `legacy_volume`, geração `38`,
novamente online e com ACK verdadeiro. Contagem oficial atual:
**Baileys `1/5`**.

### Baileys volume -> PostgreSQL — nova sequência `2/5`

O journal `b4c0ccb8-a6de-4534-bf3d-c42b1a8e4d3d` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3365`. A geração de
importação `39` e a definitiva `40`, contêiner `6dbe99c3cc78`, passaram
sem retry; a definitiva ficou `online/connection_validated`, autenticada,
`sessionValid=true`, sem QR, ACK verdadeiro e lifecycle nulo. A UI confirmou
o sucesso. O restore fechou em `restored`, `legacy_volume`, geração `41`,
online e com ACK verdadeiro. Contagem oficial: **Baileys `2/5`**.

### Baileys volume -> PostgreSQL — nova sequência `3/5`

O journal `2ff79849-add9-4b73-bd07-867da73dafb8` terminou em
`cleanup_pending`, `attempt_count=1`, revisão `3366`. As gerações `42` e
`43` fizeram importação e ativação definitiva sem retry; a `43` ficou
`online/connection_validated`, autenticada, sem QR, ACK verdadeiro e
lifecycle nulo. A UI confirmou o sucesso e o restore terminou em `restored`,
`legacy_volume`, geração `44`, novamente online com ACK. Contagem oficial:
**Baileys `3/5`**.

### Baileys volume -> PostgreSQL — nova sequência `4/5`

O journal `a330a40d-fa01-4255-8e2c-db9c2f7d5d44` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3367`. A importação `45` e a
definitiva `46`, contêiner `756a82aff98a`, ficaram online com identidade,
credenciais, sessão e ACK validados, sem retry, QR ou runtime adicional. A UI
confirmou o sucesso. O restore oficial terminou em `restored`,
`legacy_volume`, geração `47`, online e com ACK. Contagem oficial:
**Baileys `4/5`**.

### Baileys volume -> PostgreSQL — nova sequência `5/5` concluída

O journal `f688dc66-e85c-4cc5-8e13-ed888aa8904e` terminou em
`cleanup_pending`, `attempt_count=1`, revisão `3368`. A importação ocorreu
na geração `48` e a definitiva `49`, contêiner `6e3e4b67f70e`, chegou a
`online/connection_validated`, autenticada, `sessionValid=true`, sem QR, ACK
verdadeiro e lifecycle nulo. O `client_stopped` visto na `48` foi a
aposentadoria normal da geração de importação após a promoção; não abriu
retry nem terceira geração.

A UI confirmou o sucesso e o restore protegido terminou em `restored`,
`legacy_volume`, geração `50`, online com ACK verdadeiro. Resultado da
bateria consecutiva: **Baileys `5/5`**. Os journals oficiais foram
`810aa4d4...`, `b4c0ccb8...`, `2ff79849...`, `a330a40d...` e `f688dc66...`;
todos permaneceram em `attempt_count=1`, com uma geração de importação e
uma definitiva, seguidas do retorno protegido ao volume.

### WhatsMeow volume -> PostgreSQL — nova sequência `1/5`

O journal preservado `bebd90da...` foi restaurado pelo fluxo protegido antes
da bateria. `WhatsMeow Legacy` voltou a `legacy_volume`, geração `32`, online
e com ACK verdadeiro. Esse é o mesmo volume originado no caminho SQLite
legado cuja compatibilidade de upgrade `v16` e recuperação dos layouts
anteriores já está coberta pelos testes e provas físicas documentados acima;
nenhuma conversão manual foi aplicada nesta rodada.

A primeira passagem oficial usou o journal
`bd38b65f-eb9e-45d4-a9f6-ba68a933f68f`. A importação ocorreu na geração
`33`, promoveu a revisão `3369`, e a definitiva `34`, contêiner
`f1e6caec76c0`, adquiriu lease/fence, abriu a revisão ativa, conectou sem QR e
passou o gate de comandos JetStream. O journal terminou em `cleanup_pending`,
`attempt_count=1`; o runtime ficou online, autenticado, `sessionValid=true`,
ACK verdadeiro e lifecycle nulo, sem retry.

A UI confirmou o sucesso e o restore protegido terminou em `restored`,
`legacy_volume`, geração `35`, online e com ACK. Contagem oficial:
**WhatsMeow `1/5`**.

### WhatsMeow volume -> PostgreSQL — nova sequência `2/5`

O journal `3dac1f48-a456-4325-8c5e-26d93e0ac93a` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3370`. As gerações `36` e
`37` concluíram importação e ativação definitiva sem retry; a definitiva
ficou online, autenticada, sem QR, ACK verdadeiro e lifecycle nulo. A UI
confirmou o sucesso. O restore terminou em `restored`, `legacy_volume`,
geração `38`, online e com ACK. Contagem oficial: **WhatsMeow `2/5`**.

### WhatsMeow volume -> PostgreSQL — nova sequência `3/5`

O journal `3f024e0e-f4b0-4790-b5c6-d7c01cde648f` terminou em
`cleanup_pending`, `attempt_count=1`, revisão `3371`. A importação `39` e a
definitiva `40`, contêiner `0b2acb01a397`, passaram sem retry; a definitiva
ficou online, autenticada, sem QR, ACK verdadeiro e lifecycle nulo. A UI
confirmou o sucesso e o restore fechou em `restored`, `legacy_volume`,
geração `41`, online e com ACK. Contagem oficial: **WhatsMeow `3/5`**.

### WhatsMeow volume -> PostgreSQL — nova sequência `4/5`

O journal `3119719d-4db7-43b6-bd85-5b43300ad5d2` concluiu em
`cleanup_pending`, `attempt_count=1`, revisão `3372`. A importação `42` e a
definitiva `43`, contêiner `d94d56f1ce51`, terminaram online, autenticadas,
sem QR e com ACK, sem retry ou runtime extra. A UI confirmou o sucesso. O
restore fechou em `restored`, `legacy_volume`, geração `44`, online e com
ACK. Contagem oficial: **WhatsMeow `4/5`**.

### WhatsMeow volume -> PostgreSQL — nova sequência `5/5` concluída

O journal `5301fcae-d95a-4de0-a3e1-c56c34dcc1e0` terminou em
`cleanup_pending`, `attempt_count=1`, revisão `3373`. A importação `45` e a
definitiva `46`, contêiner `42f02a99e98d`, concluíram sem retry; a definitiva
ficou online, autenticada, `sessionValid=true`, sem QR, com gate JetStream e
ACK verdadeiro. A UI confirmou o sucesso e o restore protegido terminou em
`restored`, `legacy_volume`, geração `47`, online e com ACK.

Resultado da bateria consecutiva: **WhatsMeow `5/5`**. Os journals oficiais
foram `bd38b65f...`, `3dac1f48...`, `3f024e0e...`, `3119719d...` e
`5301fcae...`; todos permaneceram em `attempt_count=1`, com uma geração de
importação e uma definitiva, e retorno protegido ao volume. Com isso, as
três baterias de storage exigidas estão completas: **WWebJS `5/5`, Baileys
`5/5` e WhatsMeow `5/5`**.

## 2026-08-16 — bateria entre providers: falha real Baileys -> WWebJS e correção `1.34.140`

A primeira volta da bateria entre providers começou no worker PostgreSQL
`019ffb4e-1456-747b-8197-f19abb1eafe1`. Baileys -> WhatsMeow
(`e49afb50-9c93-4f44-9f46-d13f81ee846a`, revisão `3374`, geração `126`) e
WhatsMeow -> Baileys (`d844addf-73d4-4468-a668-71e0fdd5c632`, revisão
`3375`, geração `127`) terminaram online, sem QR, recovery ou retry, em
aproximadamente `4,7 s` e `13,6 s`, respectivamente. Essas duas direções
possuem uma passagem válida, mas a volta completa ainda não foi declarada
concluída.

Baileys -> WWebJS (`54363144-f896-479c-8c89-1b234e015839`, revisão `3376`,
geração `128`) preservou e conectou a sessão, porém levou `339,2 s`. A UI
atingiu o limite seguro de cinco minutos antes de o backend concluir e, por
isso, **essa execução foi invalidada e a contagem Baileys -> WWebJS voltou a
zero**. A promoção tardia para online não deve transformar uma passagem que
ultrapassou o contrato da UI em sucesso de aceite.

A telemetria do contêiner `76cc05db0274` provou que não havia sessão
incompatível. Quatro das cinco coleções oficiais de app-state convergiram em
segundos; somente `regular_low` permaneceu simultaneamente dirty/in-flight
por `15 s`. A recuperação corretamente fez uma única recarga de realm, mas o
documento sucessor ficou com `Socket=CONNECTED` e sem prova viva de `WAComms`.
O código anterior apenas esperava passivamente por `60 s`; ao expirar, o
runtime falhou fechado e a ativação preservada repetiu os dois imports
canônicos, acrescentando cerca de dois minutos. A segunda tentativa da mesma
geração concluiu o full sync em `8,9 s`, confirmando um stall transitório do
runtime nativo, não corrupção do material.

O fork WWebJS `1.34.140`, commit `8a5fe8a6`, adiciona uma recuperação
estritamente cercada para esse sucessor de navegação:

- concede primeiro `5 s` para a reconexão automática;
- se ainda não houver transporte, redirige uma única vez o fluxo oficial
  `WAWebLaunchSocket.launchSocket(null)`;
- só admite o redrive com documento novo, usuário registrado, rede online,
  guardas de credencial/navegação ativos, fase destrutiva `suppressing`, sem
  violação e sem pareamento ativo;
- mantém referências `Conn.ref` já consumidas como diagnóstico, sem
  confundi-las com pareamento novo;
- continua exigindo `Socket=CONNECTED`, `WAComms.isCommsInitialized()` e
  `WAComms.isSocketConnected()` antes de restaurar a segurança e reiniciar o
  full sync;
- compartilha um único deadline entre reload, estabilidade, ABI, redrive e
  prova de transporte, em vez de somar timeouts independentes;
- registra `browser_bridge.app_state_native_sync_transport_redriven` apenas
  com campos allowlisted.

Regressão do fork: `207/207` testes focados do browser bridge; suíte
determinística de auth/session/web-cache/util `548 passing`, `1 pending`;
ESLint, Prettier, web-cache e pacote aprovados. O `npm test` irrestrito depende
de `WWEBJS_TEST_REMOTE_ID` e não é uma suíte local autônoma. O pacote
`@wwebjs/whatsapp-web.js@1.34.140` foi publicado com integrity
`sha512-XWTe2JRzWZi6S[...]T5xHruy45Ypfg==`. A Underchat foi apontada para essa
versão; o rollout seletivo do WWebJS e a nova contagem começam somente depois
do commit/push da integração e da instalação pelos servidores.

### Rollout físico seletivo do WWebJS `1.34.140`

O pin, o lock, o contrato e a correção acima foram commitados e enviados no
commit Underchat `4d4331b02`, depois do commit/push do fork `8a5fe8a6`. Pela
tela visual de builds foi gerada **somente** a imagem WWebJS
`v20260816094206414`, job `01a009f3-2b4e-7769-a645-fa44b097f96e`, concluído
entre `06:42:06-03` e `06:48:12-03`. A versão tornou-se o default WWebJS e
possui digest imutável
`sha256:1d211dc5700d9f7288be663ed50452c8d7904a6498bf2a2ddacd6271f612c2b2`.
Nenhuma imagem Baileys, WhatsMeow ou Balance foi reconstruída.

As duas instalações foram disparadas e acompanhadas individualmente pela
tela de servidores. O Server 1 concluiu e foi validado com `455` eventos,
zero aviso e zero erro; o Server 2 concluiu com `464` eventos, zero aviso e
zero erro. Em ambos, a tag versionada e o alias local `under-worker-wwebjs:latest`
apontam para a imagem `1d211dc5700d...`.

Em **Canais aquecidos**, o filtro exato `Opção 2 (Navegador)` selecionou
quatro warms e **Recriar Todos** substituiu somente esse conjunto. Os novos
pools são:

- Server 1: `01a009ff-6faa-7585-bd2a-aa64514dd284` e
  `01a009ff-7018-758d-af88-46f64b0e7b96`;
- Server 2: `01a009ff-6fe4-760a-9fe5-2d786283819c` e
  `01a009ff-7000-756f-bfc7-2bd3de4b3806`.

Os quatro terminaram `ready`, com saúde atualizada, contêineres
`running/healthy`, imagem `1d211dc5700d...` e inspeção interna comprovando
`@wwebjs/whatsapp-web.js@1.34.140`. Os warms Baileys e WhatsMeow permaneceram
intactos. O intervalo em que a tabela filtrada mostrou zero era a reposição
esperada do pool; o estado durável só foi aceito depois que os quatro novos
registros chegaram a `ready` e a UI voltou a totalizar `16` warms prontos.

O rollout está, portanto, fisicamente concluído. A passagem lenta anterior
continua inválida e não entra na contagem. A bateria entre providers deve
recomeçar no runtime `1.34.140`, exigindo três sucessos por direção, sem QR,
recovery, retry ou extrapolação do limite seguro da interface.

### Migração entre providers — rodada completa `1/3` no WWebJS `1.34.140`

A primeira rodada pós-rollout percorreu visualmente as seis arestas usando o
mesmo worker PostgreSQL `019ffb4e-1456-747b-8197-f19abb1eafe1`. Cada modal
terminou em **Conexão bem-sucedida**, sem QR, retorno protegido ou segunda
ação manual. As provas duráveis foram:

| Direção              | Handoff                                | Revisão | Geração |    Duração |
| -------------------- | -------------------------------------- | ------: | ------: | ---------: |
| WWebJS -> Baileys    | `498da587-8d8c-417d-b5c0-10f04310547d` |  `3377` |   `129` | `15,553 s` |
| Baileys -> WhatsMeow | `98b9307b-16ec-491d-97de-5320c67d89fb` |  `3378` |   `130` |  `3,128 s` |
| WhatsMeow -> WWebJS  | `c54daf7a-95a7-4905-a5be-51d9a1249491` |  `3379` |   `131` | `41,875 s` |
| WWebJS -> WhatsMeow  | `633cdf91-a398-4d86-ba82-3b9696b6c0f9` |  `3380` |   `132` |  `5,455 s` |
| WhatsMeow -> Baileys | `846a427f-fbee-46c1-836b-4ed042a9f38e` |  `3381` |   `133` | `12,090 s` |
| Baileys -> WWebJS    | `0d229c74-001c-45c9-becd-ea04d2341010` |  `3382` |   `134` | `41,864 s` |

Todos os handoffs terminaram `completed`, com `error_code=NULL`,
`recovery_state=none`, `recovery_attempt_count=0`; após cada promoção o
worker ficou `online`, lifecycle nulo, ACK central verdadeiro e estado nativo
conectado, autenticado, válido e sem QR. O campo `attempt_count=0` é o valor
normal do handoff síncrono já promovido, e não uma ausência de execução.

O caso regressivo principal, Baileys -> WWebJS, caiu de `339,200 s` na
execução inválida para `41,864 s` nesta passagem. O contêiner destino
`a2609bb6c2d4`, no digest `1d211dc5700d...` e pacote `1.34.140`, permaneceu
`running/healthy`; fez um único import canônico em `759 ms`, seguiu pelos
gates de ativação e produziu `connection.online_readiness_proven` sem
`client.failure`, recovery ou redrive desnecessário. A recuperação nova é
condicional: não disparar quando o transporte converge sozinho é o
comportamento correto.

Contagem oficial após a rodada: **todas as seis direções `1/3`**. Nenhuma
correção adicional foi necessária; a próxima rodada deve repetir exatamente
os dois ciclos dirigidos e zerar somente a direção que apresentar falha.

### Migração entre providers — rodada completa `2/3`

A segunda rodada repetiu as seis arestas pela UI visível, sem reutilizar uma
promoção anterior como evidência. Todos os modais chegaram a **Conexão
bem-sucedida** e os handoffs duráveis foram:

| Direção              | Handoff                                | Revisão | Geração |    Duração |
| -------------------- | -------------------------------------- | ------: | ------: | ---------: |
| WWebJS -> Baileys    | `2eaa9c52-cc35-464d-bd55-6da40f0a9ce9` |  `3383` |   `135` | `14,694 s` |
| Baileys -> WhatsMeow | `59dd79f0-3805-41f9-b932-cf9b38c06e6d` |  `3384` |   `136` |  `4,308 s` |
| WhatsMeow -> WWebJS  | `e83a2947-4e1e-4c6a-a1ce-424520c0c4de` |  `3385` |   `137` | `41,576 s` |
| WWebJS -> WhatsMeow  | `5ec5864e-d1ee-4087-b1a3-f68107c94b83` |  `3386` |   `138` |  `4,610 s` |
| WhatsMeow -> Baileys | `18e70548-8ea9-40c5-add8-0d91647be084` |  `3387` |   `139` | `13,724 s` |
| Baileys -> WWebJS    | `e4de3afd-f210-4700-9b4f-1bdd4f1f0f93` |  `3388` |   `140` | `41,751 s` |

As seis linhas terminaram `completed`, `error_code=NULL`, recovery `none/0`.
Ao fim, a geração WWebJS `140`, contêiner `00695674daea`, estava online,
`ready`, conectada, autenticada, `sessionValid=true`, sem QR, com ACK central
verdadeiro e lifecycle nulo. As duas entradas em WWebJS repetiram praticamente
o mesmo perfil temporal seguro da rodada anterior, sem a antiga cauda de
cinco minutos.

Contagem oficial: **todas as seis direções `2/3`**. Nenhuma falha ocorreu e,
portanto, nenhuma contagem foi reiniciada ou correção de código foi aberta.

### Migração entre providers — rodada completa `3/3` concluída

A terceira rodada visual completou a exigência sem falha intermediária:

| Direção              | Handoff                                | Revisão | Geração |    Duração |
| -------------------- | -------------------------------------- | ------: | ------: | ---------: |
| WWebJS -> Baileys    | `5cb6fd15-ad15-422c-a30d-f1c666f32c3b` |  `3389` |   `141` | `14,533 s` |
| Baileys -> WhatsMeow | `d5aedba9-e503-4036-afed-2fe8b3bffcea` |  `3390` |   `142` |  `3,180 s` |
| WhatsMeow -> WWebJS  | `76efc058-0e3f-480c-9aa7-150e5abb5e58` |  `3391` |   `143` | `40,932 s` |
| WWebJS -> WhatsMeow  | `a527b17c-f89f-4071-ad6c-7355f26017b4` |  `3392` |   `144` |  `5,043 s` |
| WhatsMeow -> Baileys | `20e42330-defb-4fe7-a5e3-ff0b6113f385` |  `3393` |   `145` | `11,221 s` |
| Baileys -> WWebJS    | `e942a9a7-c865-46b7-af9a-36b5c6f8630d` |  `3394` |   `146` | `42,487 s` |

Novamente todas as linhas terminaram `completed`, sem erro, recovery ou
tentativa de recuperação. A geração final `146`, contêiner
`ba681f71349a`, ficou WWebJS `online/ready`, conectada, autenticada, válida,
sem QR, com ACK verdadeiro e lifecycle nulo. A variação máxima das seis
entradas WWebJS aceitas foi inferior a dois segundos (`40,932–42,487 s`),
enquanto o antigo outlier inválido era `339,200 s`.

Resultado final da bateria de tipo: **Baileys -> WhatsMeow `3/3`, Baileys ->
WWebJS `3/3`, WhatsMeow -> Baileys `3/3`, WhatsMeow -> WWebJS `3/3`, WWebJS
-> Baileys `3/3` e WWebJS -> WhatsMeow `3/3`**. Foram dezoito promoções
novas pós-rollout, sem QR, regressão da conexão direta, recovery, lifecycle
preso ou ultrapassagem do limite visual. A próxima bateria exigida é a
recriação `3x` por provider, mantendo a sessão PostgreSQL; os canais legados
também devem ser exercitados onde o aceite anterior os colocou em escopo.

### Recriação PostgreSQL — WWebJS `3/3` no `1.34.140`

Antes da contagem foi executado um canário diagnóstico no worker
`019ffb4e-1456-747b-8197-f19abb1eafe1`, recém-promovido de Baileys para
WWebJS na revisão ativa `3394`. A operação
`01a00a17-e70f-778b-8eea-1bb11c83d97e`, geração `146→147`, terminou
segura em aproximadamente `113,154 s`, mas não foi contada. A trace provou
um único `client_initialize` e nenhuma recuperação: a revisão com `3.920`
registros executou as duas selagens completas separadas pelo reload offline,
conectou, validou app-state, chegou a `online/ready` e recebeu ACK central.
Esse perfil é o mesmo replay conservador já documentado para revisão ativa
originada em outro provider. Não há prova para remover a segunda selagem ou
preservar tabelas Signal apenas para reduzir o tempo.

A sequência oficial usou o worker WWebJS dedicado
`019ffb52-7e9e-71cc-a611-a1e1725ae68c`, revisão ativa `3223`, com `2.316`
registros canônicos:

| Ciclo | Operação                               | Geração | Duração aproximada | Resultado           |
| ----: | -------------------------------------- | ------: | -----------------: | ------------------- |
|   1/3 | `01a00a1d-6dd0-7395-af82-998bc5d46963` |    `85` |         `61,995 s` | `online/ready`, ACK |
|   2/3 | `01a00a1f-47ac-70e3-8e8c-2bcea395aa18` |    `86` |         `56,812 s` | `online/ready`, ACK |
|   3/3 | `01a00a21-71b2-7033-8d9a-5f3195639a68` |    `87` |         `81,034 s` | `online/ready`, ACK |

Os três ciclos foram disparados pela interface visual com **Manter a conexão
atual** e terminaram na primeira tentativa, com lifecycle nulo, marker terminal
na geração corrente, sessão conectada/autenticada/válida e `qrAvailable=false`.
Cada execução restaurou o perfil, fez a primeira importação, um único reload
offline cercado, a segunda selagem e a prova de prontidão com duas amostras.
Não houve `client.failure`, recovery, redrive, pareamento ou descarte de
sessão. A variação do terceiro ciclo ficou no catch-up autenticado de app-state
após a segunda selagem; não representou retry nem perda de transporte.

Conclusão: **WWebJS PostgreSQL `3/3`**. Nenhuma alteração de código ou build
foi aberta nesta sub-rodada. O próximo bloco deve validar Baileys PostgreSQL
`3/3`, mantendo a contagem separada por provider.

### Recriação PostgreSQL — Baileys `3/3`

O worker PostgreSQL `019ffb4e-1456-747b-8197-f19abb1eafe1` foi preparado
pela UI com um handoff preservado WWebJS -> Baileys. A geração `148` chegou a
`online/connection_validated` com ACK em aproximadamente quatro segundos,
sem QR ou recovery; essa migração foi apenas preparação e não entrou na
contagem de recriação.

As três recriações seguintes usaram **Manter a conexão atual** sobre a mesma
sessão:

| Ciclo | Operação                               | Geração | Bootstrap → marker | Resultado                          |
| ----: | -------------------------------------- | ------: | -----------------: | ---------------------------------- |
|   1/3 | `01a00a25-bc63-713d-a8c5-30e4a69e0625` |   `149` |          `9,002 s` | `online/connection_validated`, ACK |
|   2/3 | `01a00a27-ec28-778d-9a21-e6d385eb00b9` |   `150` |          `7,099 s` | `online/connection_validated`, ACK |
|   3/3 | `01a00a2a-2f2c-71f6-8ea4-ce3ee4e287dc` |   `151` |          `5,326 s` | `online/connection_validated`, ACK |

Todas terminaram com lifecycle nulo, marker terminal exatamente na geração
corrente, `connected/authenticated/sessionValid=true`, `qrAvailable=false` e
sem dead-letter, nova autenticação ou degradação intermediária persistente.
Os cooldowns foram respeitados e as três provas pertencem ao mesmo canal, não
a reaproveitamento de status anterior. Conclusão: **Baileys PostgreSQL
`3/3`**. Não foi necessária alteração de código, fork, imagem ou warm.

### Recriação PostgreSQL — WhatsMeow `3/3`

O canal dedicado `Meow Maycon`
(`01a002f4-73a1-70bc-878a-edbf8ac71565`) permaneceu WhatsMeow/PostgreSQL e
foi recriado três vezes pela interface visual, sempre com preservação da
sessão:

| Ciclo | Operação                               | Geração | Bootstrap → marker | Resultado     |
| ----: | -------------------------------------- | ------: | -----------------: | ------------- |
|   1/3 | `01a00a2b-75db-762d-8d14-69460b5aace5` |     `9` |          `3,301 s` | `online`, ACK |
|   2/3 | `01a00a2d-acc8-7688-920d-ede160c8120b` |    `10` |          `3,215 s` | `online`, ACK |
|   3/3 | `01a00a2f-eaee-72c3-98d0-885287312fa6` |    `11` |          `3,208 s` | `online`, ACK |

As três gerações terminaram conectadas, autenticadas, válidas, sem QR e sem
recovery, com marker terminal exato, lifecycle nulo e ACK central verdadeiro.
A dispersão ficou abaixo de `0,1 s`, sem janela offline persistente ou segundo
bootstrap. Conclusão: **WhatsMeow PostgreSQL `3/3`** e matriz PostgreSQL de
recriação completa: WWebJS `3/3`, Baileys `3/3` e WhatsMeow `3/3`.

O próximo bloco exigido é a mesma matriz `3/3` em `legacy_volume`, sem migrar
o backend nem aceitar uma conexão nova como prova de preservação.

### Recriação legacy volume — WWebJS `3/3`

O canal `Wwebjs Legacy`
(`01a00236-10c8-77ef-96b2-06a52b0ed59a`) foi exercitado três vezes pela UI
com **Manter a conexão atual**:

| Ciclo | Operação                               | Geração | Bootstrap → marker | Resultado           |
| ----: | -------------------------------------- | ------: | -----------------: | ------------------- |
|   1/3 | `01a00a31-4f61-724e-99f4-262c5d25ac8e` |   `175` |         `14,018 s` | `online/ready`, ACK |
|   2/3 | `01a00a33-83d7-74e9-850b-7843babb80df` |   `176` |         `13,717 s` | `online/ready`, ACK |
|   3/3 | `01a00a35-d685-726c-b7da-82db1b74c364` |   `177` |         `12,392 s` | `online/ready`, ACK |

O backend permaneceu `legacy_volume` em todos os ciclos e o runtime final
manteve `session_volume_name=01a00236-10c8-77ef-96b2-06a52b0ed59a`.
As três gerações ficaram conectadas, autenticadas e válidas, sem QR, retry,
recovery ou migração implícita para PostgreSQL. O marker terminal e o ACK
central pertencem à geração corrente e o lifecycle ficou nulo ao final.
Conclusão: **WWebJS legacy volume `3/3`**; nenhuma correção foi necessária.

### Recriação legacy volume — Baileys `3/3`

O canal `Baileys Legacy`
(`01a00268-d35d-738e-8bd5-6cc040d85d59`) foi recriado três vezes pela UI,
sempre preservando a conexão e o volume:

| Ciclo | Operação                               | Geração | Bootstrap → marker | Resultado                          |
| ----: | -------------------------------------- | ------: | -----------------: | ---------------------------------- |
|   1/3 | `01a00a37-3c92-77fe-a631-205ab4af6286` |    `51` |          `9,845 s` | `online/connection_validated`, ACK |
|   2/3 | `01a00a39-7bd4-77ed-b163-ebbd803fda49` |    `52` |          `8,313 s` | `online/connection_validated`, ACK |
|   3/3 | `01a00a3b-cc12-72cc-86b9-2b0f911a7b50` |    `53` |          `6,443 s` | `online/connection_validated`, ACK |

O runtime final manteve `session_storage=legacy_volume` e
`session_volume_name=01a00268-d35d-738e-8bd5-6cc040d85d59`. Não houve QR,
retry, fallback para PostgreSQL, perda da credencial, recovery ou lifecycle
órfão. As três gerações terminaram conectadas, autenticadas e válidas, com
marker/ACK da geração corrente. Conclusão: **Baileys legacy volume `3/3`**;
nenhuma correção ou publicação foi necessária.

### Recriação legacy volume — WhatsMeow `3/3`

O canal `WhatsMeow Legacy`
(`01a00269-ceb2-777d-bb5f-2babbe150663`) completou a matriz legada pela UI,
sempre com preservação da conexão e do mesmo volume:

| Ciclo | Operação                               | Geração | Bootstrap → marker | Resultado     |
| ----: | -------------------------------------- | ------: | -----------------: | ------------- |
|   1/3 | `01a00a3d-27c6-70db-8769-f15e503b23ad` |    `48` |          `3,300 s` | `online`, ACK |
|   2/3 | `01a00a3f-76f7-7671-9468-ac40324e4791` |    `49` |          `3,212 s` | `online`, ACK |
|   3/3 | `01a00a41-b8ad-73dc-ae60-9c2236fc99f3` |    `50` |          `3,264 s` | `online`, ACK |

O runtime final permaneceu `legacy_volume`, com
`session_volume_name=01a00269-ceb2-777d-bb5f-2babbe150663`. As três execuções
terminaram conectadas, autenticadas, válidas, sem QR, retry, recovery ou
troca implícita de backend. O lifecycle ficou nulo e marker/ACK pertencem à
geração corrente. Conclusão: **WhatsMeow legacy volume `3/3`** e matriz de
recriação completa nos dois backends: PostgreSQL `9/9` e volume legado `9/9`.

### Fechamento do resíduo histórico Baileys e auditoria final

A auditoria agregada depois das 18 recriações encontrou um único handoff
não terminal. Não era uma falha das execuções atuais: o registro
`b08f4e92-ea3d-495d-a629-1103ab8cae2c`, revisões `3325 -> 3326`, havia sido
criado pelo importador Baileys anterior ao `1.0.33`. Naquela versão, o
bootstrap de volume abria um scaffold `legacy_volume_migration` e depois um
segundo `secure_import`, formando um handoff interno Baileys -> Baileys. A
restauração segura invalidou o scaffold e recolocou o volume online, mas o
descendente permaneceu historicamente em `validating`. O código `1.0.33` já
não cria esse caminho, porém faltava terminalizar o resíduo quando uma
migração antiga chegava a `restored`.

A migration Atlas `20260816104500`, commit Underchat `48753c631`, adicionou
uma limpeza transacional, idempotente e fail-closed no evento de restauração.
Ela só alcança um descendente quando todas estas cercas coincidem:

- origem e destino são o mesmo provider da migração de storage;
- origem é o scaffold `legacy_volume_migration` já invalidado pela
  restauração, e destino é `secure_import` ainda em staging/validação;
- não existe lifecycle de provider, ponto de não retorno ou artefato de
  pré-ativação;
- worker e runtime já voltaram ao volume-fonte exato, com provider correto,
  conexão nativa online, válida, sem QR e ACK central;
- a sessão canônica está vazia, sem revisão ativa ou anterior, porque o volume
  é novamente a única fonte autoritativa.

O handoff é então marcado `failed` com
`legacy_volume_migration_restored`; a revisão descendente recebe o mesmo
terminal. O trigger genérico agenda recovery atomicamente ao observar a falha,
e a mesma transação o muda para `cancelled`, pois o volume saudável já foi
restaurado. Handoffs entre providers, operações com lifecycle, revisão ativa,
provider divergente, ponto de não retorno ou runtime sem prova online não são
tocados.

Antes de aplicar, a migration foi executada contra o estado real dentro de
uma transação com rollback: a contagem ativa caiu de um para zero e o canal
continuou online. O contrato focado passou `10/10`, o TypeScript global passou,
o commit foi enviado antes da aplicação e o Atlas terminou na versão
`20260816104500`, sem arquivo pendente. Depois da aplicação, o resíduo ficou
`failed/cancelled`, a revisão `3326` ficou `failed`, e nenhuma recuperação foi
aberta.

Um dead-letter WhatsMeow da geração final `11` também foi classificado. O
evento `12597` veio do epoch `b1f3bc36-...`, informou uma desconexão tardia do
transporte e foi recusado corretamente como `stale_runtime`. Em `133 ms`, o
mesmo runtime já havia avançado para o epoch `aac29c9f-...` e publicou o evento
`12598` como `online`; não houve projeção offline, QR ou perda de ACK. Os
demais dead-letters recentes pertenciam a gerações aposentadas e tinham o
mesmo motivo de fencing. Não transformar esses eventos tardios em estado do
canal é parte da proteção, não uma falha a redrivar.

A conferência final no banco e no Playwright visível mostrou os sete canais
como **Conectado**. Em todos: status primário `online`, lifecycle nulo,
marker terminal da geração corrente, storage worker/runtime idêntico,
provider nativo correto, `connected/authenticated/sessionValid=true`,
`qrAvailable=false` e ACK verdadeiro. As contagens finais foram zero para
workers fora de `online`, lifecycles, handoffs ativos, recoveries, migrações de
storage ativas, resoluções, self-heal e outbox não publicado. O único erro de
console continuou sendo o asset de imagem externo inacessível em
`10.0.2.89:9002`, já conhecido e sem relação com WhatsApp.

Resultado consolidado desta aceitação:

- volume -> PostgreSQL: WWebJS `5/5`, Baileys `5/5`, WhatsMeow `5/5`;
- entre providers: as seis direções `3/3`, total `18/18`;
- recriação PostgreSQL: WWebJS, Baileys e WhatsMeow `3/3`, total `9/9`;
- recriação volume legado: WWebJS, Baileys e WhatsMeow `3/3`, total `9/9`.

Não reiniciar essas contagens sem um novo requisito ou mudança de versão. Em
regressões futuras, separar sempre eventos realmente pertencentes ao epoch
corrente de telemetria tardia cercada, e nunca reabrir revisões ou promover
handoffs manualmente.

## 2026-08-16 — nova conexão após volume legado não liberava QR Code

O canal de produção **Notificações 2**
(`019edbf4-b6e5-7389-96cd-8478038373c5`, WhatsMeow, Servidor 11) expôs uma
falha diferente da migração protegida. Ele estava em `legacy_volume`; depois
de **Recriar -> Iniciar nova conexão**, o controle central mudou corretamente
o destino para `postgres`, removeu a credencial anterior e publicou
`awaiting_qr`. Ao selecionar QR Code, porém, a API respondeu
`worker_qrcode_not_ready`, traduzido pela interface como **Canal ainda não está
disponível para solicitar QR Code**.

### Evidência e causa exata

A geração nova `68` estava saudável, sem mount, no backend PostgreSQL e com o
provider nativo em `initializing`. O erro não era indisponibilidade do worker,
latência da UI ou falha do gRPC. A tentativa de QR não chegou a criar um grant
de ativação de pareamento para a geração atual porque o repositório canônico
recusou corretamente a árvore como não vazia.

A inspeção transacional da sessão mostrou:

- a revisão ativa nova era um staging de pareamento vazio e sem device;
- ainda existia uma revisão `failed` criada pela tentativa anterior de migrar
  o volume para PostgreSQL;
- ainda havia entradas de garbage collection daquela tentativa;
- `whatsapp_session.last_error_at` permanecia em
  `2026-08-16 13:23:49-03`;
- os grants existentes pertenciam somente às gerações antigas `58/59`; não
  havia grant para a geração `68`.

Esse conjunto viola deliberadamente a regra de draft retomável: último erro
nulo, uma única revisão, no máximo uma entrada de GC e revisão ativa vazia e
exatamente cercada pelo runtime corrente. Portanto, **não** corrigir este caso
relaxando `session_not_empty`, limpando somente `last_error_at` ou forçando um
grant. Essas alternativas poderiam misturar uma sessão descartada com um novo
pareamento.

A causa no lifecycle era uma hipótese inválida no caminho destrutivo
`legacy_volume -> postgres`: por a fonte autoritativa ser o volume, o código
removia contêiner/volume, mas pulava
`deletePostgresWhatsappSessionByWorkerId`. Uma migração protegida anterior que
falhou e foi restaurada pode deixar uma **sombra canônica não autoritativa**
para auditoria/GC. Ao escolher nova conexão, essa sombra também pertence à
conexão descartada e precisa ser removida integralmente antes de reservar a
geração substituta.

### Correção fail-closed

O reset destrutivo com destino PostgreSQL agora sempre remove a árvore
canônica anterior, inclusive quando o runtime aposentado ainda é
`legacy_volume`. A autorização adicional não é genérica: o repositório trava
primeiro `worker` e depois `worker_runtime` e só aceita a remoção quando
coincidem, na mesma transação:

- conta, lifecycle e status `recreating` atuais;
- `worker.session_storage=postgres` como destino autoritativo já escolhido;
- backend `legacy_volume`, geração, container e nome do volume exatamente
  capturados antes da remoção física;
- operação destrutiva de nova conexão, nunca migração protegida.

Para runtime PostgreSQL, a cerca anterior e a revogação de
capability/writer epoch foram mantidas. Para runtime legado já aposentado não
há writer PostgreSQL a revogar; a transação apenas elimina, na ordem protegida,
handoff, chunks, sessão, revisões e dependências canônicas. Divergência de
backend, geração, container, volume, lifecycle ou status retorna `false` sem
apagar dado algum. A migração de storage protegida (`remove_session=false`),
as recriações que preservam sessão e os handoffs entre providers não passam
por esse novo ramo.

Regressões adicionadas:

- remoção aceita para a sombra canônica sob a cerca legada exata;
- rejeição sem qualquer `DELETE` quando backend ou volume divergem;
- prova do orquestrador de que a limpeza ocorre depois da aposentadoria física
  e antes da reserva da próxima geração;
- retry com alvo PostgreSQL frio continua usando a cerca PostgreSQL exata;
- o contrato de conversão confirma que o runtime legado fornece geração,
  container e volume para a autorização.

Gates locais desta correção: contratos direcionados `633/633`, TypeScript
global aprovado, ESLint focado aprovado e `git diff --check` limpo. A imagem do
Balance/serviço precisa conter este commit antes de repetir **Iniciar nova
conexão**. O runtime de produção já aberto na geração `68` continuará bloqueado
pela sombra, como deve; depois do rollout, uma nova execução destrutiva fará a
limpeza cercada e o QR deverá criar o grant somente sobre uma árvore canônica
realmente nova.

## 2026-08-16 — troca de provider com nova conexão era recusada pelo journal

O canal de produção **Notificações**
(`019fed30-5bb1-73c8-9e7c-cb0881ab0a05`) expôs um erro diferente do handoff
protegido. Ele estava WhatsMeow/PostgreSQL e, ao editar para Baileys, o usuário
escolheu explicitamente **Iniciar nova conexão**. A API respondeu HTTP `409` e
a UI exibiu `worker_lifecycle_journal_invalid`, antes de alterar o worker ou
apagar a sessão. Tentativas posteriores com a mesma estratégia também
receberam `409`.

É importante não misturar as duas operações observadas na sequência:

- as requisições destrutivas entre `18:48:54-03` e `18:53:22-03` foram
  recusadas pelo journal;
- somente a tentativa separada das `18:54:16-03`, na qual foi escolhida
  **Migrar conexão atual**, recebeu `202` e criou o handoff
  `72835d0b-ce30-433a-b2f9-9c16a6cbc288`;
- esse handoff terminou `completed`, revisão alvo `26`, geração `22`, Baileys
  online, autenticado, `sessionValid=true` e ACK central. Seu sucesso não é
  evidência de que o caminho de nova conexão estivesse funcional.

### Causa exata

O frontend estava correto: `AppChannelConnectionStrategyDialog` emitiu
`fresh`, `AppEditChannel` enviou `connection_strategy=fresh` e
`WorkerUpdaterUseCase` construiu o lifecycle destrutivo esperado:

- destino PostgreSQL;
- troca de `previous_worker_type_id=whatsmeow` para `worker_type_id=baileys`;
- `remove_session=true` e `remove_volume=false`;
- cleanup obrigatório do runtime anterior antes de ativar o destino.

A falha ocorria antes do claim no PostgreSQL. O
`WorkerLifecycleQueueService.assertJournalPayloadShape()` só reconhecia dois
contratos para troca de provider: handoff PostgreSQL preservado
(`remove_session=false/remove_volume=false`) e conversão destrutiva de volume
legado para PostgreSQL (`true/true`). O terceiro contrato legítimo — nova
conexão em PostgreSQL (`true/false`) — era classificado como
`payload_semantics_invalid`. Como `prepare()` valida antes de escrever o
journal e antes de o use case reivindicar `lifecycle_operation_id`, as
tentativas falhas não deixaram operação ativa nem chave parcial para redrive;
o `409` foi fail-closed e a sessão anterior permaneceu intacta.

### Correção e cercas antirregressão

O journal agora reconhece `destructivePostgresProviderReset` somente quando
todas as condições explícitas coincidem:

- origem `worker_update` e mudança real entre providers WhatsApp suportados;
- storage PostgreSQL, sem metadado misturado de storage anterior;
- `remove_session=true` e `remove_volume=false`;
- ação primária obrigatoriamente `recreate`, seguida do cleanup pareado;
- no comando primário, `cleanup_previous_runtime_required=true`.

Essa autorização não relaxa o handoff protegido. Migração continua exigindo
preservação da sessão (`false/false`), conversão de volume continua exigindo
remoção de sessão e volume (`true/true`), providers não suportados continuam
recusados e qualquer combinação parcial falha antes da primeira escrita. O
cleanup e o primário continuam no mesmo operation ID e passam pela validação
de identidade cruzada antes do redrive.

A revisão do pipeline completo encontrou uma segunda incompatibilidade que
ficaria oculta enquanto o primeiro `409` bloqueava o fluxo: uma troca
destrutiva de provider podia reservar warm pool, mas a ativação warm não tinha
um proprietário idempotente para apagar a sessão PostgreSQL antiga sem correr
o risco de um redrive apagar a nova sessão do destino. O contrato final ficou
deliberadamente assim:

1. o cleanup da origem usa `remove_session=false/remove_volume=false` e retira
   somente o runtime do provider anterior;
2. o primário do destino usa `remove_session=true/remove_volume=false`;
3. troca destrutiva de provider não reserva warm pool e segue pelo recreate
   frio;
4. o recreate frio é o único proprietário da exclusão PostgreSQL, usando o
   snapshot exato de geração/container e o mesmo `lifecycle_operation_id`;
5. o journal rejeita tanto `activate_warm` nesse caso quanto um cleanup que
   tente também assumir a exclusão da sessão.

Isso mantém a ordem segura **aposentar origem -> apagar sessão cercada ->
reservar nova geração -> iniciar destino**. O warm pool continua disponível
para criação e para resets sem troca de provider, e os fluxos de migração e
recriação preservada não foram alterados.

Cobertura adicionada:

- produtor `WorkerUpdaterUseCase` exercitado nas seis direções
  Baileys/WWebJS/WhatsMeow com estratégia `fresh`, provando limpeza do número e
  data de conexão, ausência de handoff preservado, cleanup `false/false`,
  primário `true/false` e ausência de reserva warm;
- journal exercitado no caminho frio, incluindo persistência e redrive
  ordenado dos dois comandos;
- consumidor do Service API provando que despacha primeiro o cleanup
  WhatsMeow e depois o recreate Baileys, sem consultar autorização de handoff;
- handler do Balance já coberto pelo contrato que entrega o snapshot exato do
  runtime removido à exclusão PostgreSQL durante uma substituição de provider;
- casos negativos para remoção de volume em PostgreSQL, ausência da prova de
  cleanup, mistura com metadados legacy, ativação warm e cleanup destrutivo
  duplicado.

Gates locais: `173/173` testes direcionados aprovados, TypeScript global
aprovado, ESLint e Prettier focados no código aprovados e `git diff --check`
limpo. O rollout precisa atualizar em conjunto **Manager API** (produtor e
decisão cold), **Service API** (leitura/execução do journal) e **Schedule API**
(redrive do journal). **Balance API, Web e os três workers não receberam
alteração nesta correção**; o handler cold já possuía a exclusão PostgreSQL
cercada necessária. Depois do rollout, repetir pela UI uma troca de provider
escolhendo **Iniciar nova conexão** e validar a sequência completa: HTTP `202`,
cleanup da sessão anterior, destino em `awaiting_qr`, QR liberado e nenhum
provider handoff criado. Até essa prova visual pós-rollout, a correção está
validada localmente, mas não deve ser marcada como canário de produção
concluído.

## 2026-08-16 — WhatsMeow legado com ADV vazio não migrava para PostgreSQL

O canal de produção **Meio Preço**
(`019ff146-bde0-7799-a32a-ad237219f3d6`, WhatsMeow, Servidor 6) falhava de
forma determinística ao migrar `legacy_volume -> postgres`. Seis operações em
gerações distintas chegaram a capturar o volume, abriram uma revisão staging
no destino e terminaram restauradas após três tentativas. O erro externo era
sempre o genérico `13_internal:_worker_service_is_not_healthy`.

### Evidência e causa exata

O controle central e o snapshot do volume estavam funcionando:

- o checkpoint tinha dois arquivos, `20.873.216` bytes e checksum estável;
- a origem permanecia preservada e voltava online após cada restauração;
- o runtime PostgreSQL de destino abria a revisão de
  `legacy_volume_migration`, mas encerrava com
  `startup_session_revision_open_failed` antes de persistir ou validar a
  projeção;
- a reprodução offline com uma cópia somente leitura do `store.db` real
  falhou exatamente em `prepareWhatsmeowSnapshot` com
  `whatsapp projection ADV capability is inconsistent`.

A sessão foi criada pelo upgrade histórico SQLite e sua revisão comprova
`source='legacy_sqlite'`. Nesse formato, uma identidade pública sem segredo
ADV extraível pode permanecer como `adv_secret_available=false` e
`adv_key=x''`. O loader do fork já reconhecia essa representação: ele restringe
a reparação à origem `legacy_sqlite`, marca a capability como ausente e mantém
o BLOB vazio porque a constraint SQLite histórica não permite `NULL` para um
device pareado. O importador volume -> PostgreSQL não transportava a origem da
revisão até a validação e, por isso, recusava o mesmo sentinel legado que o
loader já havia aceitado.

Não resolver este caso aumentando timeout, repetindo o recreate ou aceitando
qualquer ADV vazio. O destino estava em crash loop e mais espera apenas
postergava a restauração. Também não alterar a migration SQLite histórica nem
afrouxar a constraint canônica do PostgreSQL.

### Correção fail-closed

A captura SQLite agora lê e transporta internamente a proveniência da revisão.
Durante a preparação, a conversão de `adv_key` vazio para SQL `NULL` ocorre
somente quando todas estas provas coincidem:

- a revisão fonte declara exatamente `source='legacy_sqlite'`;
- `adv_secret_available` é booleano e `false`;
- `adv_key` é uma célula binária com comprimento zero.

O fingerprint continua sendo recalculado e comparado com o fingerprint v2
armazenado antes da inserção. Revisão canônica sem essa proveniência, ADV não
vazio marcado como indisponível, capability verdadeira com chave inválida e
qualquer outro material inconsistente continuam rejeitados. No PostgreSQL, a
identidade pública equivalente é gravada canonicamente como
`adv_secret_available=false` e `adv_key=NULL`.

Regressões permanentes adicionadas:

- banco SQLite v17 reproduzindo o sentinel histórico e comprovando que a
  captura carrega `legacy_sqlite` até a normalização;
- aceitação e conversão do BLOB vazio somente com a proveniência legada;
- rejeição do mesmo BLOB vazio em snapshot canônico;
- rejeição de chave ADV não vazia quando a capability está indisponível,
  inclusive com origem legada;
- manutenção do caso canônico público já válido (`false/NULL`).

A cópia real de produção, aberta em modo somente leitura, passou por captura e
preparação depois da correção. A suíte completa de
`apps/worker_whatsmeow` também passou. Em produção, a última tentativa da
imagem antiga terminou `restored`; o canal permaneceu `legacy_volume`, voltou
`online`, `sessionValid=true` e o volume continuou preservado. Não iniciar nova
tentativa até atualizar **somente o Worker WhatsMeow**; Manager, Service,
Schedule, Balance, Web, Baileys e WWebJS não foram modificados nesta rodada.
Após o rollout, repetir a migração do mesmo canal e exigir estado terminal
`completed`, `session_storage=postgres`, revisão alvo ativa/validada, conexão
online e ausência de QR ou nova autenticação.

## 2026-08-16 — Cacoal: volume legado coletado durante rollback e redrive infinito

O canal de produção **Cacoal**
(`019ecce0-c75f-73f8-aff4-3568c30b1f08`, WhatsMeow, Servidor 1) expôs uma
falha de infraestrutura diferente da incompatibilidade ADV descrita acima. A
migração `09b6b931-d31f-4552-a5be-51b6164ef4f8` falhou após três tentativas e
entrou em `restoring`, porém o rollback não encontrou o volume-fonte
`warm-019fbb08-f0a2-739a-b8e7-32dfb1047ca8`. O controle antigo repetia o
recreate aproximadamente a cada poucos segundos, gerando novos operation IDs
e deixando o canal indefinidamente em `recreating`.

### Evidência física e limite de recuperação

A inspeção direta no Servidor 1 confirmou que o contêiner pode ser descartado
e recriado, mas o volume — a única fonte autoritativa da sessão — não existe
mais no Docker. O mesmo nome foi procurado nos onze servidores de workers e
não foi encontrado. Também não há outro volume associado ao worker, `store.db`
com o telefone do canal, arquivo aberto e apagado, backup local ou snapshot
LVM/ZFS/Btrfs. O host usa ext4 sobre `/dev/md3` RAID1; o PostgreSQL contém
somente revisões de tentativa vazias, sem device WhatsMeow validado. Portanto,
não existe projeção canônica capaz de reconstruir a credencial antiga.

Não criar um volume Docker vazio com o mesmo nome. Isso faria o path existir,
mas substituiria silenciosamente a sessão perdida por um filesystem vazio. A
sessão original só pode ser recuperada se existir backup externo do host ou do
volume; nesse caso, os bytes devem ser restaurados com o mesmo nome antes de
qualquer recreate. Sem backup, a única alternativa funcional é uma nova
autenticação explicitamente aceita pelo operador.

### Causa exata

O journal afirmava `source_volume_preserved=true`, mas essa referência não era
considerada por todos os caminhos de limpeza do warm pool. Durante a
finalização do alvo PostgreSQL,
`cleanupAssignedWarmPoolReferences()` chamava
`WorkerWarmPoolRepository.deleteAssignedByWorkerId()` e removia o registro
atribuído que ainda materializava o volume-fonte. Sem ownership durável em
`worker_runtime` ou `worker_warm_pool`, a reconciliação seguinte classificava o
volume físico `warm-*` como órfão e podia coletá-lo, embora a migração ainda
dependesse dele para rollback.

O segundo defeito era de recuperação. Quando o handler recusava corretamente
recriar com volume ausente, o erro incluía o nome do volume e o orquestrador
tratava toda falha em `restoring` como transitória. Assim, ele reagendava a
mesma operação a cada 15 segundos para sempre. Nenhum retry poderia recuperar
bytes fisicamente ausentes.

### Correção fail-closed

O journal de migração passou a ser referência forte do volume. Todos os paths
relevantes de claim, prova e exclusão de warm/orphan agora exigem `NOT EXISTS`
de uma migração cujo `source_volume_name` coincida,
`source_volume_preserved=true` e estado diferente de `completed`. A cerca foi
adicionada tanto à limpeza do warm atribuído quanto aos reclaims legacy,
converted e Docker orphan. Enquanto o journal declarar preservação, nem a
aposentadoria do contêiner nem o garbage collector podem remover o registro ou
o volume. Depois do cleanup explicitamente autorizado e do estado `completed`,
a proteção é liberada.

O handler agora emite códigos estáveis, sem incorporar o nome do volume:

- rollback protegido: `session_storage_migration_source_volume_missing`;
- recreate comum: `worker_session_volume_missing_recreate_aborted`.

Ao receber o primeiro código durante `restoring`, o orquestrador transiciona
uma única vez para o novo estado terminal `recovery_required`, limpa claim e
`next_attempt_at`, grava `source_volume_preserved=false` e publica o diagnóstico.
Esse estado não participa do índice de migração ativa e não é redirigido
automaticamente. A UI mostra **Recuperação manual necessária**, proíbe a
interpretação de sucesso e orienta restaurar backup ou iniciar nova conexão
somente se o operador aceitar substituir a sessão anterior. Os seis catálogos
`pt/en/es` foram atualizados.

A migration Atlas `20260816233000.sql` adiciona o novo estado, a constraint
que exige a combinação terminal coerente e recria o índice ativo excluindo
`recovery_required`. Não gravar esse estado antes de aplicar a migration e
atualizar os consumidores da resposta.

### Intervenção de produção em 2026-08-16

Como a versão antiga continuava criando operações, o journal foi estacionado
de forma reversível, sem qualquer mutação de volume: `next_attempt_at` foi
fixado em `2099-01-01T00:00:00Z`, claim e lifecycle do journal foram zerados,
o lifecycle do worker foi invalidado e o erro foi normalizado para
`session_storage_migration_source_volume_missing`. Vinte segundos depois, o
estado permanecia `restoring`, sem claim, sem lifecycle e sem contêiner. Não
usar `next_attempt_at=NULL` para estacionar o estado antigo: o claim legado
considera `NULL` elegível. A data futura é apenas uma cerca operacional até o
rollout; não significa sessão restaurada.

Depois do rollout conjunto, redirigir uma vez a operação para que o código novo
materialize `recovery_required`. Não promover manualmente para `restored` ou
`completed`. Para recuperar a sessão antiga, restaurar primeiro o volume a
partir de backup externo; se não houver backup, obter autorização explícita
para nova autenticação.

### Gates e escopo de rollout

Foram aprovados `740/740` testes relevantes, incluindo todos os contratos do
handler, warm pool, orquestrador, snapshot, telemetria, protobuf, modelo Atlas
e UI. O teste novo exercita Baileys, WWebJS e WhatsMeow e comprova que todos
emitem o mesmo terminal quando o rollback protegido não encontra o volume.
Também passaram TypeScript global, `vue-tsc`, ESLint/Prettier focados,
`test:locations`, `git diff --check` e `atlas migrate validate`.

O rollout desta correção requer:

- migration Atlas `20260816233000.sql`;
- **Balance API**, dono do handler gRPC e da limpeza/reconciliação de warm;
- **Schedule API**, dono normal do job/orquestrador de storage migration;
- **Manager API**, dono dos endpoints e do schema da resposta;
- **Service API** se `SERVICE_API_ENABLE_NON_BUILD_CONSUMERS` puder habilitar os
  mesmos jobs nesse ambiente;
- **Web**, para apresentar o estado terminal sem falso sucesso.

Baileys, WWebJS e WhatsMeow workers não receberam alteração nesta correção de
ownership. A correção ADV imediatamente anterior continua exigindo somente o
rollout seletivo do Worker WhatsMeow correspondente ao commit `6f48fe4bc`.

## 2026-08-16 — WhatsMeow PostgreSQL: lease recuperava, mas provider permanecia offline

O canal de produção **Trampo Comercial**
(`019fdc47-c4df-73e3-9b6b-1daa998b0a02`, WhatsMeow, Servidor 11) ficou
`offline` aproximadamente 58 minutos depois de concluir com sucesso a migração
`legacy_volume -> postgres` `653d68b1-3fae-484d-bca6-000ff78b40bd`. A
migração não causou perda de credencial: ela terminou `completed`, revision
`61`, generation `11`, identidade e telefone conferidos, envio/recebimento
validados e volume-fonte removido somente após a promoção. O fato nativo no
incidente ainda declarava `authenticated=true`, `sessionValid=true` e
`recoverable=true`; o terminal era especificamente `lease_lost`.

### Cronologia e evidência de produção

O runtime estava online e persistia prova forte imediatamente antes da falha.
Entre `2026-08-17T02:16:19.340Z` e `02:16:34.340Z`, quatro renovações da lease
falharam em intervalos de cinco segundos. Às `02:16:39.381Z`, o deadline local
entrou na margem de segurança: o worker fechou corretamente o command ingress,
publicou `lease_lost` e encerrou o socket para impedir dois escritores. Apenas
**27 ms depois**, às `02:16:39.408Z`, a mesma lease renovou com sucesso,
fencing token `2` e mais 30 segundos de validade. O processo antigo continuou
renovando esse token por vários minutos, enquanto o provider permaneceu
fechado e o canal central continuou offline.

O PostgreSQL primário revelou a causa das renovações rejeitadas. No intervalo
de um minuto ao redor do incidente, o usuário restrito dos workers produziu
`50 × SQLSTATE 26000`, `7 × 08P01`, `4 × 22P02` e uma concorrência legítima
`40001`. A linha da primeira renovação observável mostrou parâmetros de outra
consulta chegando às posições de `renew_whatsapp_session_lease`; as quatro
falhas locais ocorreram nos mesmos milissegundos dos `26000` registrados no
servidor. Não houve restart do PgBouncer, failover do PostgreSQL, logout do
WhatsApp, sessão inválida ou troca de geração.

### Duas causas combinadas

1. A rodada anterior sobre PgBouncer corrigiu os workers Node com prepared
   statements nomeados, mas o worker Go não estava coberto. `lib/pq`, por
   padrão, envia o `Parse` da instrução parametrizada sem nome, espera a
   resposta e somente depois envia `Bind/Execute`. No PgBouncer em
   `transaction pooling`, o backend pode mudar entre essas duas rodadas. Isso
   explica tanto `unnamed prepared statement does not exist` quanto valores
   vinculados contra a assinatura de outra instrução.
2. Havia uma corrida independente na recuperação. Quando outro goroutine
   cruzava o deadline local e marcava `lease_lost`, uma renovação já em voo
   ainda podia retornar sucesso. O caminho de sucesso apagava
   incondicionalmente `leaseErr`. Assim, o availability guard voltava a ver
   PostgreSQL saudável antes de entrar em `suspended` e nunca executava a
   sequência explícita `reacquire lease -> prepare durable fence -> resume
provider`. A lease continuava viva, mas o estado terminal e o socket do
   WhatsMeow permaneciam fechados.

Não corrigir este caso ignorando `lease_lost`, reabrindo o socket diretamente
ou tornando todos os terminais recuperáveis. O fechamento fail-closed foi
correto. `logged_out`, sessão inválida, conflito de writer/generation e handoff
continuam terminais protegidos; somente uma nova lease adquirida com token
monotônico e runtime fence aprovado pode reativar a sessão persistida.

### Correção aplicada

`OpenWorkerPostgres` agora normaliza a DSN do `lib/pq` com
`binary_parameters=yes`, inclusive sobrescrevendo configuração contrária em
URL ou keyword DSN. Nesse modo, `Parse`, `Bind` e `Execute` seguem no mesmo
batch de protocolo; o pooler não pode separar a instrução sem nome de seus
valores. O mesmo `*sql.DB` é compartilhado pelo runtime fence, lease, status
outbox e SQLStore WhatsMeow, portanto a correção cobre toda a fronteira direta
do worker sem alterar schema, credencial, revisão ou semântica dos BLOBs.

O renew também passou a respeitar a perda local como sticky. Se um sucesso
chegar depois de `leaseErr`, ele não altera `expiresAt/localDeadline`, não limpa
o erro e encerra o loop antigo com o evento estruturado
`lease_renew_recovery_required`, reason de baixa cardinalidade
`local_lease_already_lost`. O guard então observa a perda, suspende
imediatamente, testa somente a disponibilidade do banco, adquire um fencing
token novo, reinstala o runtime fence e chama `ResumeAfterDatabaseRecovery` no
mesmo client/sessão, sem QR e sem nova autenticação.

Para diagnóstico sem expor DSN, parâmetros ou material de sessão,
`safeOperationalErrorCode` agora classifica `pq.Error` em categorias estáveis:
`postgres_invalid_statement`, `postgres_connection_failure`,
`postgres_parameter_invalid`, `postgres_serialization_failure`,
`postgres_connection_limit` e `postgres_shutdown`. Categorias funcionais já
tipadas continuam tendo precedência. Não usar IDs, telefones ou SQLSTATE como
labels de métrica de alta cardinalidade; correlação detalhada permanece nos
logs estruturados.

### Regressões, validação e rollout

Foram adicionadas regressões para:

- normalização de URL e keyword DSN com preservação das demais opções;
- rejeição de um renew tardio após perda local, sem limpar erro ou avançar a
  prova antiga;
- avanço normal de deadline/contador enquanto a lease está saudável;
- classificação sanitizada dos SQLSTATEs observados;
- teste opt-in concorrente contra PgBouncer real.

O teste direto no mesmo pooler de produção passou **5/5**. Cada rodada executou
320 queries parametrizadas concorrentes, totalizando **1.600/1.600** sem
cruzamento de parâmetros, `26000` ou `08P01`. O detector de races passou dez
repetições dos caminhos de deadline, suspensão, reacquire e resume; a suíte
completa de `apps/worker_whatsmeow`, `go vet ./...` e `git diff --check`
também passaram.

O escopo de rollout é **somente Worker WhatsMeow**. Manager, Service, Schedule,
Balance, Web, Baileys, WWebJS, fork e Atlas não foram alterados. O container
antigo de Trampo Comercial ainda mantém a lease token `2` renovada, mas não
pode executar a nova recuperação porque a imagem em produção contém a corrida.
Após instalar a imagem nova pela tela e atualizar os warms, substituir/recriar
uma vez o runtime escolhendo **Manter a conexão atual**. Exigir: token de lease
novo, `connecting -> online`, `authenticated/sessionValid=true`, command
ingress pronto, ACK online verdadeiro, lifecycle limpo e nenhum QR. Em uma
oscilação futura, a sequência esperada nos logs é
`lease_lost -> lease_renew_recovery_required -> runtime suspended -> lease
reacquired -> database recovered -> online`; nunca um `lease_lost` seguido de
renovações silenciosas com provider permanentemente fechado.

## 2026-08-17 — recriação em massa WhatsMeow presa: JSONB binário e arrays Signal sem adapter

Após o rollout da correção anterior, uma recriação em massa dos canais online
deixou inicialmente 55 e depois **56** canais em `recreating`, quase todos
apresentados pela API como fase `connecting`. Todos tinham a mesma assinatura:

- provider `whatsmeow`;
- `session_storage=postgres`;
- nova `runtime_generation` exatamente uma unidade acima da última concluída;
- container novo atribuído e saudável na maioria dos casos;
- `lifecycle_operation_id` e `recreate_bootstrap_operation_id` iguais;
- projeção nativa vazia e `native_connection_online_acknowledged=false`.

Os canais não estavam aguardando o WhatsApp. Em amostras de todos os servidores,
o provider carregava a revisão, confirmava a sessão, conectava nativamente e
deixava o consumer JetStream pronto. O bloqueio ocorria ao persistir o fato
terminal: `status_outbox.admission_failed` e
`strong_online.persistence_completed successful=false` repetiam sem que o
Manager recebesse o ACK forte. Por isso aumentar timeout, repetir recreate ou
forçar status no banco somente amplia a fila e não resolve a causa.

### Regressão na fronteira `binary_parameters`

No primário PostgreSQL, a janela analisada registrou **5.004** falhas
`SQLSTATE XX000` com `unsupported jsonb version number 123`, sempre no parâmetro
`$7` de `apply_worker_runtime_status(..., $7::jsonb, ...)`. O número `123` é o
byte ASCII de `{`. A correção anterior ativou `binary_parameters=yes` para que
o `lib/pq` envie `Parse/Bind/Execute` no mesmo batch e não sofra troca de
backend no PgBouncer transaction mode. Porém `json.Marshal` produz `[]byte` e,
nesse modo, o driver envia todo `[]byte` como representação binária. O binário
de `jsonb` exige um byte inicial de versão `1`; o documento textual começando
por `{` foi interpretado incorretamente como versão `123`.

Não remover `binary_parameters=yes`: isso reintroduz os `26000`, `08P01` e
parâmetros cruzados que causaram a perda de lease anterior. A regra permanente
da fronteira é:

- JSON destinado a `json`/`jsonb` deve chegar como `string`;
- BLOB destinado a `bytea` deve permanecer `[]byte`;
- arrays PostgreSQL devem usar o adapter do driver (`pq.Array`);
- o batch atômico do `lib/pq` deve continuar habilitado.

Foi criado o boundary explícito `workerPostgresJSONText`. Ele agora cobre o
status nativo, a solicitação de self-healing e todos os payloads JSONB do
outbox de chamadas. O artefato de resync já fazia a conversão correta e foi
mantido. A telemetria segura passou a classificar exatamente essa falha como
`postgres_jsonb_binary_encoding_invalid`, sem incluir SQL, DSN, credenciais ou
conteúdo da sessão.

### Segundo defeito real: sessão Signal antiga não abria

O canal **SOUL MAIS SAÚDE**
(`019f9409-7794-7596-9cec-c50ca637ad0c`, Servidor 11, revision `10`) era um
outlier: seu container reiniciava com
`startup_session_device_open_failed`, em vez de chegar ao loop de status. A
revisão e o device estão completos e ativos; a diferença é que há sessões
Signal antigas que `normalizeCanonicalSignalStorage` precisa converter ao
abrir.

Uma sonda read-only até a leitura do device reproduziu o erro exato antes da
escrita: `sql: converting argument $3 type: unsupported type []string, a slice
of string`. O fork montava corretamente
`unnest($3::text[], $4::bytea[])` e
`unnest($3::text[], $4::text[], $5::bytea[])`, mas passava `[]string` e
`[][]byte` crus. O `database/sql`/`lib/pq` rejeitava esses tipos antes de enviar
a query. O caminho só era exercitado por revisões com payload Signal legado
que efetivamente necessitava normalização; por isso a maioria da frota não
mostrava o defeito.

O fork agora exige `PostgresArrayWrapper` nesse caminho e envolve todos os
arrays com o adapter já configurado pelo worker como `pq.Array`. A
normalização continua transacional, idempotente, escopada por
`session_id/revision_id` e protegida pelo operation fence do runtime. Não
converter os arrays manualmente para strings nem ignorar o erro: `bytea[]`
precisa preservar exatamente os bytes criptográficos.

### Regressões, provas e rollout

O teste opt-in contra o PgBouncer real foi ampliado. Em cada consulta ele agora
transporta simultaneamente bigint, UUID, texto, JSONB textual, BYTEA binário,
`text[]` e `bytea[]`. Passou **5/5**, 320 operações concorrentes por rodada,
totalizando **1.600/1.600** sem `XX000`, `26000`, `08P01`, cruzamento de
parâmetros ou alteração dos BLOBs/arrays. Também passaram:

- suíte completa de `apps/worker_whatsmeow`;
- suíte completa do fork `apps/worker_whatsmeow/forks/whatsmeow`;
- race detector nos limites do worker e em todo `store/sqlstore`;
- `go vet ./...` nos dois módulos;
- `git diff --check`.

O escopo de rollout é **somente Worker WhatsMeow**, mas a imagem deve conter o
worker e o fork local alterados. Não há migration Atlas, pacote externo ou
alteração em Manager, Schedule, Service, Balance, Web, Baileys ou WWebJS. Antes
do rollout, não iniciar novas recriações WhatsMeow nesta imagem: cada runtime
continuará conectando nativamente e falhando no mesmo ACK JSONB.

Depois de commitar/pushar, gerar e instalar somente a nova imagem WhatsMeow
pela tela, atualizar os warms e substituir/recriar os runtimes afetados com
**Manter a conexão atual**. Um container já iniciado com a imagem defeituosa
não recebe a correção sozinho. Para cada canal exigir:

1. revisão existente aberta sem QR/nova autenticação;
2. `recreating/connecting -> online` em poucos segundos;
3. fato nativo `online`, `authenticated=true`, `sessionValid=true`;
4. ACK online verdadeiro, geração concluída igual à geração atual e lifecycle
   limpo;
5. ausência de `unsupported jsonb version number`,
   `postgres_jsonb_binary_encoding_invalid` e
   `startup_session_device_open_failed` nos novos containers.

Para **SOUL MAIS SAÚDE**, a primeira abertura da imagem nova também deve
normalizar os registros Signal legados com os arrays adaptados e então seguir
o mesmo terminal online. Não alterar manualmente a revisão/device nem apagar a
sessão: os dados estão completos e o defeito é somente a codificação dos
parâmetros na normalização.

### Auditoria cruzada PgBouncer: Baileys e WWebJS não herdam o defeito JSONB

Após identificar a regressão do `binary_parameters=yes`, foi auditada a
fronteira PostgreSQL compartilhada pelos workers Node. Baileys e WWebJS usam
`node-postgres`, não `lib/pq`, e não habilitam o modo binário global que causou
o `unsupported jsonb version number 123`. O status e o self-healing passam
JSONB como `JSON.stringify(...)`; os forks mantêm `Buffer` para `bytea`, texto
JSON para casts `jsonb` e arrays no formato nativo aceito pelo driver.

O pool comum `workerPostgresPool` transforma toda consulta parametrizada em
prepared statement nomeado deterministicamente pelo hash do SQL. Isso é
compatível com o PgBouncer em transaction mode porque os poolers RW e RO de
produção mantêm `max_prepared_statements=200`. Não remover essa camada nem
voltar a prepared statements anônimos nos workers Node.

Uma prova read-only foi executada diretamente contra o PgBouncer de produção
com a mesma fronteira Node: bigint, UUID, texto alternando `baileys`/`wwebjs`,
JSONB textual, BYTEA, `text[]` e `bytea[]`, usando o statement nomeado comum.
Passou **5/5**, 320 consultas concorrentes por rodada, totalizando
**1.600/1.600** sem cruzamento de valores ou erro de protocolo. Também passaram
99 testes dos contratos do pool, status/outbox, auth store Baileys e session
store WWebJS.

Na janela de quatro horas dos logs do primário, os 6.837 `XX000`, 183 `26000`
e dois `08P01` não tinham o `application_name=underchat-whatsapp-worker` do
caminho Node; os `XX000` ainda mostravam explicitamente provider `whatsmeow`.
Portanto não publicar Baileys ou WWebJS para esta correção. A auditoria também
encontrou seis `23514` no Baileys ao tentar escrever token de privacidade vazio
contra `whatsapp_privacy_tokens_payload_check`. Essa é uma falha funcional
separada do PgBouncer e deve ser diagnosticada/corrigida em rodada própria, sem
alterar o protocolo de parâmetros Node que foi validado aqui.

## 2026-08-17 — Pimenta Bueno: revisão canônica SQLite com `source=NULL` impedia migração

O canal **Pimenta Bueno**
(`019ecce5-612e-75e2-8b89-9e3b2e0c2e99`, WhatsMeow, Servidor 2) falhou de
forma determinística ao migrar `legacy_volume -> postgres`. A migração
`5cc888a0-8c21-4361-b51e-55192964618f` esgotou três tentativas e foi restaurada;
durante o diagnóstico, a repetição `34db294b-8b56-46d6-b289-c9cb0b3440ce`
reproduziu a mesma assinatura nas três gerações de destino. O Manager recebia
apenas `13_internal:_worker_service_is_not_healthy`, mas o problema não era
lentidão, PgBouncer, WhatsApp ou volume indisponível: cada container PostgreSQL
novo encerrava com exit code `1` ainda no bootstrap, antes de criar a revisão
de destino.

### Diagnóstico com cópia consistente e sem risco ao volume

O rollback terminou corretamente em `restored`; o canal voltou `online` na
geração `125`, com `session_storage=legacy_volume`, e o volume-fonte permaneceu
preservado. Foi produzida uma cópia consistente online do SQLite com a API de
backup do próprio SQLite, sem parar ou escrever no volume. A cópia passou
`PRAGMA quick_check=ok`, tinha schema `17`, tamanho `53.190.656` bytes e foi
removida do Servidor 2 e da máquina de diagnóstico ao final.

Executar nessa cópia exatamente a fronteira de produção
`captureWhatsmeowSQLiteSnapshot -> prepareWhatsmeowSnapshot` revelou o erro
que o health check genérico ocultava:

`read secure import revision metadata: sql: Scan error on column index 2, name "source": converting NULL to string is unsupported`

O SQLite estava íntegro. A única revisão que possuía o device pareado e ativo
era canônica, status `staging`, revision `1`, e tinha
`whatsapp_session_revision.source=NULL`. A coluna é nullable pelo schema e o
SQLStore local abre essa mesma revisão normalmente; portanto `NULL` é um estado
canônico legítimo, não corrupção nem formato histórico desconhecido. O
importador, porém, fazia `Scan` dessa coluna diretamente em `string`, derrubava
o processo e jamais chegava à gravação no PostgreSQL. Isso explica as revisões
de destino vazias e o erro externo genérico de serviço não saudável.

### Correção e limite de segurança

A captura agora lê `source` como `sql.NullString`. Quando presente, o valor é
preservado exatamente; quando `NULL`, a proveniência interna permanece vazia.
Isso não relaxa a validação criptográfica: somente a proveniência explícita
`legacy_sqlite` autoriza a normalização histórica do segredo ADV vazio. Uma
revisão canônica com origem nula continua sujeita às mesmas verificações fortes
de device, identidade, fingerprint e ADV que já existiam. Em particular, o
teste que rejeita segredo ADV vazio em snapshot canônico continua passando.

Foi adicionada uma regressão que cria um store SQLite v17 real pelo SQLStore,
salva um device pareado cuja revisão nasce com `source IS NULL`, captura e
prepara o snapshot completo. Além da suíte sintética, a cópia real de Pimenta
Bueno passou pela fronteira corrigida com **17 tabelas e 61.602 registros**,
sem alterar os dados. Passaram `go test ./internal/app -count=1`, toda a suíte
`go test ./... -count=1`, `go vet ./...` e `git diff --check` do Worker
WhatsMeow.

### Rollout e reteste obrigatório

O escopo é **somente Worker WhatsMeow**. Não há alteração em fork, Manager,
Service, Schedule, Balance, Web, Atlas, Baileys ou WWebJS. A imagem antiga
continuará falhando nas três tentativas porque o erro ocorre dentro do
importador embarcado nela; não repetir a migração antes de instalar a nova
imagem pela tela e atualizar os warms WhatsMeow.

Após o rollout, iniciar novamente a migração de Pimenta Bueno e exigir, sem QR
ou nova autenticação:

1. captura consistente do volume e criação de uma revisão PostgreSQL não vazia;
2. container de destino saudável, sem restart loop;
3. `authenticated=true`, `sessionValid=true`, identidade e telefone iguais;
4. migration `completed`, `session_storage=postgres` e revision de destino
   validada/ativa;
5. exclusão do volume somente depois de toda a evidência forte aprovada.

Se aparecer apenas `worker_service_is_not_healthy`, não tratar como timeout e
não aumentar tentativas. Correlacionar `migration_id`, runtime generation e
container de destino; um crash antes da revisão ativa deve ser reproduzido
contra uma cópia consistente do volume, preservando sempre o original para o
rollback.

### Segunda tentativa antes do rollout e endurecimento transacional

A migração `c1f7fd9d-8967-4f4b-9d35-1192f86abb62` repetiu o mesmo sintoma em
três gerações, mas **não validou a correção acima**: os containers candidatos
usaram a imagem `v20260817031519012` (`sha256:02a33f0f...`), criada antes do
commit que aceita `whatsapp_session_revision.source=NULL`. O alvo encerrou
novamente no bootstrap com `startup_session_revision_open_failed`; o rollback
terminou em `restored`, o canal voltou online no volume legado e nenhum dado da
origem foi apagado. Não interpretar uma repetição em imagem antiga como
regressão do código novo.

Uma nova cópia consistente e somente leitura do mesmo volume passou pelo
pipeline atual com **17 tabelas e 61.609 registros**. A diferença de sete
registros em relação à sonda anterior decorre da sessão online continuar
recebendo estado; ambas as cópias passaram a validação completa. Isso reforça
que a sessão não está corrompida e que o rollout precisa conter o commit de
compatibilidade, em vez de repetir a operação com a imagem antiga.

O bootstrap também foi endurecido contra conflitos PostgreSQL realmente
transitórios. A captura e a validação do SQLite continuam executadas uma única
vez sobre a cópia cercada; somente a transação serializável que grava a revisão
é repetida, no máximo três vezes e com backoff curto, exclusivamente para
`SQLSTATE 40001` (serialization failure) e `40P01` (deadlock). Falhas de fence,
escopo, checksum, schema, identidade ou conteúdo permanecem terminais e nunca
são repetidas. Cada tentativa usa uma nova transação; portanto uma tentativa
abortada não deixa projeção parcial.

A telemetria segura passou a separar quatro fronteiras sem serializar SQL,
DSN, credenciais ou conteúdo da sessão:

- `startup_legacy_volume_snapshot_failed` — volume, arquivo ou checksum;
- `startup_legacy_volume_capture_failed` — abertura/leitura do SQLite;
- `startup_legacy_volume_validation_failed` — projeção canônica inválida;
- `startup_legacy_volume_import_failed` — fence ou transação PostgreSQL.

O wrapper externo de abertura preserva essa categoria interna, evitando que
tudo volte a aparecer como `startup_session_revision_open_failed`. Foram
adicionadas regressões para retry serializável, ausência de retry em erro
permanente e preservação da categoria segura. Passaram a suíte completa do
Worker WhatsMeow, `go vet ./...`, race detector nos novos limites e
`git diff --check`.

O rollout continua sendo **somente Worker WhatsMeow** e deve incluir os dois
commits desta correção. Depois de instalar pela tela e atualizar os warms,
confirmar pelo ID/tag da imagem do container candidato que ele é posterior aos
commits; só então zerar a contagem do reteste `legacy_volume -> postgres`.

## 2026-08-19 — WWebJS: pareamento novo voltava ao QR durante o checkpoint conectado

### Evidência de produção e causa exata

O canal WWebJS `01a01a0f-9eca-755c-b53f-923e1bb1da07`, no Server 8, foi
analisado sem alterar sessão, revisão, container ou banco. O container estava
`running/healthy`, executava `@wwebjs/whatsapp-web.js@1.34.140` e os arquivos
instalados de `Client`, `RemoteAuth` e `BrowserSessionBridge` tinham os mesmos
hashes do `HEAD` correspondente do fork. Portanto o sintoma não era imagem
antiga, instalação parcial, falta de recurso ou divergência entre fonte e
pacote.

A cronologia segura dos logs em UTC foi:

1. QR disponível às `12:47:16.809Z` e socket conectado às `12:47:24.284Z`;
2. autenticação confirmada às `12:47:30.716Z`, seguida do gate estável de
   app-state às `12:47:50.291Z`;
3. projeção canônica `ready_preflight` persistida e identidade validada entre
   `12:47:50.623Z` e `12:47:50.647Z`;
4. `checkpoint.ready` iniciado às `12:47:50.652Z` com o perfil conectado
   congelado;
5. o próprio WhatsApp executou `close_socket_and_prevent_retry` às
   `12:47:50.786Z` e substituiu legitimamente o documento principal;
6. o artefato congelado terminou às `12:47:51.280Z`, mas a prova de retomada
   do documento antigo foi recusada às `12:47:53.909Z` com
   `document_epoch_valid=false`, usuário não registrado e transporte ainda
   desconhecido no realm substituído.

A bridge classificava qualquer prova negativa de retomada como
`wwebjs_connected_profile_resume_proof_invalid`. O `RemoteAuth` tratava esse
código como falha terminal do checkpoint inicial, finalizava a revisão
`staging/pairing` recém-autenticada e o worker iniciava outra autorização,
fazendo a interface sair de **Conectando e pareando** e voltar ao QR. A sessão
do celular chegou a autenticar; o defeito era a perda de continuidade entre
dois documentos do mesmo runtime antes da promoção durável.

### Fronteira em relação às correções anteriores

Esta falha não deve ser confundida com as sucessões já documentadas:

- a `1.34.127` serializou documentos do bootstrap
  `legacy_volume_migration` antes do checkpoint e deixou explicitamente o
  pareamento novo fora da exceção;
- a `1.34.129` criou o freeze/resume crash-consistent para o checkpoint
  conectado de pareamento ou volume, mas manteve toda prova de resume negativa
  como terminal;
- a `1.34.139` autorizou o sucessor READY somente depois de a revisão já estar
  `active` e de existir um checkpoint durável no mesmo runtime;
- a `1.34.140` recuperou transporte parado em sucessor de handoff, exigindo
  ausência de pareamento ativo.

O espaço ainda não coberto era exatamente: revisão `staging`, origem
`pairing`, preflight canônico e identidade já duráveis, primeiro checkpoint
do perfil conectado ainda em curso e navegação legítima antes da promoção.
Não reutilizar como solução a redução de delays, um retry genérico, a remoção
manual da revisão staging ou o relaxamento das provas de identidade e
transporte; esses atalhos reabririam os riscos que as versões anteriores
fecharam.

### Correção cercada no fork `1.34.141`

O fork `@wwebjs/whatsapp-web.js@1.34.141`, commit
`b91514188eaebddf935e4b1265e10e78cd1ff4a0`, separa a troca comprovada de
documento das demais falhas de resume. Quando `document_epoch_valid=false`
prova que o realm da captura congelada foi substituído, a bridge emite
`wwebjs_connected_profile_navigation_superseded`; socket desconectado,
registro ausente, pairing ativo ou transporte inválido no documento atual
continuam emitindo `wwebjs_connected_profile_resume_proof_invalid` e falham
fechado.

O `Client` aceita o código novo apenas em seu serializador de flights de
readiness. O `RemoteAuth` conserva uma proveniência transitória somente depois
de o pareamento inicial concluir app-state estável, preflight de identidade,
persistência canônica e validação da identidade, imediatamente antes do
checkpoint conectado. O documento sucessor pode repetir esse mesmo checkpoint
somente quando todas as cercas permanecem verdadeiras:

- PostgreSQL nativo, revisão `staging` e origem `pairing`;
- runtime epoch idêntico ao que fez o preflight;
- document epoch e navigation sequence exatamente atuais;
- projeção canônica preflightada já persistida;
- nenhum restart ativo, activation marker, candidato promovido, handoff,
  fechamento de admissão ou shutdown.

O sucessor não repete o delay inicial, mas refaz integralmente o gate de
app-state, o preflight, a persistência canônica e a validação de identidade no
novo realm antes de reconstruir o artefato. A revisão staging não é apagada
quando o predecessor comprovadamente perdeu o documento; ela só é promovida
depois que o sucessor conclui o checkpoint normal. A proveniência é apagada no
sucesso, na falha terminal e em todo `beforeBrowserInitialized`, impedindo
reuso por outro browser ou runtime. Pareamento sem preflight, troca de runtime,
erro no documento atual, handoff, restart e revisão ativa preservam os caminhos
fail-closed existentes.

### Publicação, integração e provas antes do rollout

As três regressões novas provam a classificação do resume, a serialização do
flight sucessor e a continuidade do pareamento inicial no mesmo runtime; o
teste negativo recusa runtime diferente. A suíte determinística ampliada do
fork terminou com **521 passing / 1 pending**. O pending é somente a instalação
PostgreSQL concorrente opcional. O `npm test` irrestrito continua dependendo
de `WWEBJS_TEST_REMOTE_ID`, conforme já registrado neste documento, e não foi
contornado com credencial fictícia. ESLint, Prettier, `git diff --check`, cache
Web fixado `2.3000.1044338228` e pacote de 158 arquivos passaram.

O pacote foi publicado depois do commit/push do fork e relido no registry
interno. O tarball possui shasum
`556e020198d2134709d5abcec2c1ba46dd41e202`, integrity
`sha512-7PJOJHmJLYdgLxkkDBLIEGhKU3Jgr+dDCjZmz482Mxl/jQGANRmhxIU45tTxdOEf4lDxqCElJmg09UZREA5UeA==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.141/whatsapp-web.js-1.34.141.tgz`.

Na Underchat, `package.json` e `pnpm-lock.yaml` fixam esse tarball e sua
integrity. O contrato da dependência real exige a versão, o código transitório,
a proveniência de runtime e as cercas explícitas de `staging/pairing`. Os
contratos da dependência, conexão WWebJS e command handler passaram
**702/702**; o build TypeScript local do `worker_wwebjs` também passou. Esse
build local é somente prova de compilação e não corresponde a uma versão OCI
gerada pela tela.

Nenhum build visual, promoção de default, instalação em servidor, renovação de
warm ou recriação de canal foi executado neste atendimento, conforme o escopo
combinado com o operador. Depois que ele gerar e instalar a nova imagem, o
reteste precisa confirmar dentro do container o pacote `1.34.141` e observar,
no mesmo runtime, a revisão `staging/pairing` chegar a `active`, o canal chegar
a `online/ready` com ACK central e nenhum novo QR. Se houver nova geração,
troca de browser, falha de identidade ou outro QR, a passagem não valida esta
correção e deve ser diagnosticada sem mutação manual da sessão.

## 2026-08-19 — WWebJS: continuação no store após navegação do checkpoint

### Reteste da `1.34.141` e camada ainda destrutiva

O reteste do mesmo canal no Server 8 confirmou que a imagem nova estava
efetivamente em execução. O container estava `running/healthy`, sem restart,
carregava `@wwebjs/whatsapp-web.js@1.34.141` e os hashes de
`PostgresSessionStore`, `RemoteAuth`, `BrowserSessionBridge` e `Client`
coincidiam com os arquivos publicados do fork. Logo, o retorno para o QR não
era cache de imagem nem instalação incompleta.

A `1.34.141` reconheceu corretamente a navegação e o `Client` entregou o
trabalho ao documento sucessor, mas a revisão já havia sido destruída por uma
camada inferior. A sequência observada em UTC foi:

1. revisão `352`, `staging/pairing`, autenticada às `13:55:18.927Z`;
2. app-state estável às `13:55:37.844Z`, preflight canônico persistido às
   `13:55:39.828Z` e identidade validada às `13:55:40.114Z`;
3. checkpoint conectado iniciado às `13:55:40.131Z`, seguido do
   `close_socket_and_prevent_retry` oficial às `13:55:40.335Z`;
4. artefato concluído às `13:55:42.181Z` e resume do documento antigo
   recusado às `13:55:42.399Z` com `document_epoch_valid=false`;
5. o `PostgresSessionStore.checkpointProfile()` recebeu
   `wwebjs_connected_profile_navigation_superseded`, porém seu `catch` chamou
   `failRevision()` às `13:55:42.455Z`, executou
   `clear_whatsapp_session` e zerou `revisionId/revisionStatus`;
6. o `Client` registrou a sucessão correta um milissegundo depois, mas o novo
   documento já não possuía revisão. Na repetição do preflight, às
   `13:56:16.118Z`, o PostgreSQL recusou os argumentos sem revisão com SQLSTATE
   `22023`; as tentativas seguintes voltaram ao QR e terminaram por exaustão.

O ponto faltante estava, portanto, no limite pós-stream e pré-persistência do
store. O `RemoteAuth` e o serializador do `Client` não conseguem continuar uma
revisão que `failRevision()` já removeu.

### Correção cercada no fork `1.34.142`

O fork `@wwebjs/whatsapp-web.js@1.34.142`, commit
`766ee9044df0011e62bd6bfedf581f2bd514b201`, trata exclusivamente o
`error.code` exato `wwebjs_connected_profile_navigation_superseded` como uma
corrida não destrutiva em `checkpointProfile()`. Nessa fronteira ainda não há
metadado de artefato ou promoção confirmada: os chunks órfãos continuam sendo
apagados, mas a revisão candidata permanece `staging/pairing` para que o
documento sucessor refaça todos os gates e publique o checkpoint normal.

A telemetria específica é `checkpoint.navigation_superseded`, com
`retryable=true`. Não foi criado retry genérico e não são aceitos texto de
mensagem, erro Puppeteer genérico, SQLSTATE, falha de identidade nem
`wwebjs_connected_profile_resume_proof_invalid`. O teste negativo confirma
que esse último código ainda chama `clear_whatsapp_session`, limpa a revisão e
registra `checkpoint.failed`; assim, as cercas fail-closed anteriores
permanecem intactas.

As regressões novas reproduzem a revisão staging antes do checkpoint,
interrompem a validação pós-stream com a navegação controlada, provam a
ausência de `clear_whatsapp_session` e promovem a mesma revisão numa segunda
chamada. A suíte ampliada de sessão e autenticação terminou com **523 passing /
1 pending**; o pending continua sendo somente a instalação PostgreSQL
concorrente opcional. ESLint, Prettier, `git diff --check`, cache Web fixado
`2.3000.1044338228` e verificação do pacote de 158 arquivos passaram.

O pacote foi publicado no registry interno depois do commit/push. O tarball
possui shasum `87ae263b14fdd9391f1f64d653fd6e5ceb92adb3`, integrity
`sha512-NhZYWbGxsA/MV1AJQ8BULdeDe5ilaNF7btNw9Wv3SGhmSK2C0T+bPb5mCfeWz7+baSJmNEZbKGTm122grdV52w==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40wwebjs%2Fwhatsapp-web.js/-/1.34.142/whatsapp-web.js-1.34.142.tgz`.

Na Underchat, a dependência e o lockfile passam a fixar esse tarball e sua
integrity. O contrato da dependência real exige a versão `1.34.142`, a
comparação por `error.code`, o evento específico e a preservação apenas da
corrida controlada. Os três contratos WWebJS passaram **702/702**, e o build
TypeScript local delegado por `build:worker_wwebjs` terminou com sucesso. O
build visual, a promoção de default, a instalação e a recriação do canal
continuam sob responsabilidade do operador. No próximo reteste, é necessário
confirmar o pacote `1.34.142` dentro do container e observar a mesma revisão
passar de `staging/pairing` para `active`, sem
`session.failed_pairing_cleared`, antes de considerar a correção validada em
produção.

## 2026-08-19/20 — Baileys: importação pela extensão falhava na promoção e derrubava o gRPC

### Sintoma e causa comprovada no runtime

Na importação da sessão local do WhatsApp Web para o canal Baileys, a extensão
concluía a transmissão e informava que a sessão havia sido restaurada, mas a
interface recebia `13 INTERNAL: 14 UNAVAILABLE: Connection dropped`. A inspeção
do runtime do canal no Server 2 mostrou que o erro de transporte era
secundário. A revisão `secure_import` foi criada, validada, conectou pelo
Baileys, persistiu as credenciais e publicou o status nativo `online`. A falha
ocorreu somente no checkpoint final, quando
`promote_whatsapp_session_revision_v17_impl` recusou a promoção com SQLSTATE
`23514` e a mensagem `candidate whatsapp session changed companion identity`.

O predecessor era uma revisão inicial `staging/pairing`. Diferentemente do
rascunho vazio do WWebJS, o Baileys já havia persistido credenciais locais de
bootstrap e uma linha de dispositivo antes de existir pareamento. Esse estado
não possuía JID, LID, UUID do Facebook, provas ADV ou fingerprint de companion,
mas também não era fisicamente vazio; por isso entrava na comparação geral de
identidade, que corretamente encontrava diferença entre o rascunho ainda não
vinculado e a sessão importada.

Uma segunda falha transformava essa rejeição cercada em queda do processo. O
bloco local de confirmação retornava a Promise de
`finalizeReadyConfirmation()` sem `await`; a rejeição assíncrona escapava do
`try/catch`, surgia como `BaileysSessionFenceError: REVISION_INVALID`, encerrava
o processo Node e fazia o Docker reiniciá-lo. O stream gRPC era então
interrompido e produzia o `UNAVAILABLE` exibido pela extensão. Após o restart, a
revisão transitória já inválida também impedia o bootstrap por perda da lease.

### Correção aditiva e fronteiras de não regressão

A migração aditiva `atlas/prod/20260819214500.sql` substitui somente a
implementação cumulativa da função de promoção e reconhece um predecessor
Baileys inicial como rascunho pristine sob todos estes requisitos simultâneos:

- origem e candidata usam o provider `baileys`;
- a origem é `staging/pairing` e a candidata é `secure_import`;
- não existe revisão anterior, fingerprint ativo nem operação de lifecycle;
- generation, epoch, capability, lease, fencing token, handoff e revisão ativa
  correspondem exatamente ao runtime corrente;
- nenhum dispositivo da origem contém JID, LID, UUID do Facebook, `adv_details`,
  assinaturas ou chave ADV, device fingerprint ou versão de fingerprint.

Somente nessa fronteira a comparação entre a identidade vazia do rascunho e a
identidade real importada deixa de ser exigida. Uma sessão previamente
vinculada, mesmo que apenas um desses campos esteja presente, continua no gate
normal de igualdade e falha fechada em qualquer divergência. A mudança não
atinge WWebJS, WhatsMeow, migração `legacy_volume`, handoff entre providers,
sessão ativa/ready nem reconexão. Permanecem intactos os requisitos de checksum,
material canônico da candidata, reserva, lifecycle, lease, fences, ACK central
e prontidão JetStream. Não houve preenchimento, promoção ou limpeza manual de
revisões no banco de produção.

Em `packages/services/baileys/methods/connection.service.ts`, a confirmação
agora usa `return await this.finalizeReadyConfirmation(...)`. Assim, inclusive
uma futura rejeição SQL legítima permanece dentro do `try/catch`: a conexão é
degradada, o ACK central fica falso e o socket é marcado indisponível, sem
encerrar o processo nem converter uma falha de sessão em queda do gRPC.

O fork `/home/maycon/baileys` foi auditado limpo na versão interna `1.0.39`.
Não foi necessário alterar ou publicar o pacote, pois os dois defeitos estão na
função PostgreSQL e no controle assíncrono da Underchat, não no transporte ou
na serialização do fork.

### Provas locais antes do rollout

Os contratos focados de conexão e migração terminaram com **2 suites / 100
testes**. A regressão de serviço força `BaileysSessionFenceError` na promoção e
prova que a confirmação resolve em estado degradado, com ACK falso e socket
indisponível, sem rejeição não tratada. O contrato da migração exige cada cerca
do rascunho Baileys e também confirma que o gate geral de fingerprint continua
presente.

Os contratos cumulativos de schema, plugin gRPC e caso de uso executados nessa
etapa terminaram com **2 suites / 73 testes**; TypeScript, ESLint e Prettier nos
arquivos TypeScript tocados, além de `git diff --check`, passaram. O documento
completo ainda contém tabelas históricas fora do formato atual do Prettier; a
seção nova foi formatada sem reescrever esses registros anteriores.
`atlas migrate validate` aprovou toda a cadeia e um PostgreSQL descartável
recebeu **310 migrações / 1905 statements**, incluindo a nova função. O comando
`atlas migrate lint` não pôde ser usado porque a versão local `1.3` passou a
reservar o lint ao Atlas Pro; essa limitação de ferramenta não foi mascarada
como aprovação.

O verificador PostgreSQL amplo foi executado duas vezes, cada vez sobre um
banco novo com as 310 migrações. Nas duas execuções ele passou as provas de
privilégios e takeover de generation, mas parou antes do cenário de importação
numa asserção temporal preexistente de
`verifyNativeRuntimeStatusProjection`: o reconciliador retornou zero enquanto
o script esperava uma lease criada quatro segundos no futuro ser abrangida
pelo limite de cinco segundos. Como a falha foi idêntica antes de alcançar a
promoção e não toca a função modificada, ela é registrada como gate amplo não
concluído, não como aprovação. Os bancos descartáveis foram removidos e o role
temporariamente habilitado para login foi restaurado para `NOLOGIN`, sem senha.

Até este registro, não houve commit, push, publicação de imagem, aplicação em
produção, instalação em servidor nem nova tentativa da extensão. O rollout só
pode ser considerado aprovado depois de executar os gates restantes, publicar
a árvore exata e confirmar no runtime real a promoção para `active/ready`, o
ACK central, a ausência de restart e a continuidade do stream gRPC.

## 2026-08-20 — Baileys: `REVISION_INVALID` restante após o primeiro rollout

### O que o reteste comprovou

Depois do registro anterior, o commit Underchat
`a5cd50ad9` foi efetivamente construído e instalado no canal Baileys do Server 2. O container iniciado às `01:20:32Z` usava a imagem
`v20260820010326092`, continha o `return await` da confirmação e executava a
função PostgreSQL com a exceção cercada
`v_source_is_pristine_baileys_pairing`. A função instalada tinha o mesmo corpo
da migração e a imagem permaneceu com restart zero. Portanto o novo
`REVISION_INVALID` não era cache, migração ausente nem rollout incompleto.

As tentativas das revisões alvo `3414` e `3415` chegaram a conectar e
autenticar pelo Baileys, persistiram checksum, material canônico, JID, LID,
provas ADV e fingerprint, mas foram recusadas na promoção com SQLSTATE
`23514`. A revisão fonte `3413` continuava exatamente no caso permitido:
`staging/pairing`, mesmo provider, sem revisão anterior, lifecycle ou
fingerprint ativo, com generation/epoch/capability correspondentes e sem
qualquer identidade vinculada. Isso eliminou o segundo gate de comparação
fonte/destino e isolou a falha no primeiro gate: o `p_expected_jid` enviado
pelo fork não correspondia ao JID final persistido.

O alvo durável mostrou a forma que torna a corrida possível: depois do
handshake ele possuía um JID telefônico `@s.whatsapp.net` e um LID `@lid`,
ambos com device ID e diferentes entre si. O pacote do navegador é staged com
o `me.id` existente naquele instante. Depois, o servidor pode canonicalizar
`me.id`/`me.lid` antes do estado `open`. O fork `1.0.39` guardava somente o
`expectedJid` inicial, selava novamente as credenciais finais, descartava o
resultado do seal e enviava o alias antigo ao CAS. O PostgreSQL então recusava
corretamente o alias contra o JID final, embora o fingerprint criptográfico e
o outro alias ainda provassem continuidade da mesma conta.

O isolamento assíncrono do primeiro patch funcionou: essas duas rejeições não
derrubaram mais o processo nem o stream gRPC. A extensão recebeu somente
`REVISION_INVALID`, o container ficou `running/healthy`, restart zero, e a
revisão candidata foi compensada. Nenhuma revisão foi promovida, preenchida,
apagada ou alterada manualmente durante o diagnóstico. O estado de recovery
bloqueado e as revisões failed foram usados apenas como evidência read-only.

### Correção fail-closed no fork `1.0.40`

O fork `/home/maycon/baileys`, commit
`1b1b8eb8eedc3fb188573d8005669ed0d8794d50`, passou a congelar no stage os
dois aliases importados (`expectedJid` e `expectedLid`) e o fingerprint do
companion. Antes da promoção ele sela as credenciais finais e exige:

- interseção entre os aliases importados e os aliases finais, normalizados
  somente quanto a device ID e à grafia equivalente `c.us`/`s.whatsapp.net`;
- igualdade exata do fingerprint criptográfico quando ele já existia no
  pacote importado;
- uso da cópia interna autoritativa do candidato, e não de campos que um
  chamador possa alterar no objeto retornado;
- envio do JID final já selado ao CAS PostgreSQL somente depois das provas
  anteriores.

Assim, a troca legítima da representação primária PN/LID não é confundida com
troca de conta. Se todos os aliases mudarem ou se o fingerprint mudar, o fork
falha antes do CAS com `PROJECTION_INVALID`; checksum, material canônico,
persistência do device, lease, fencing token, generation, epoch, capability,
handoff e todos os gates SQL anteriores permanecem obrigatórios. Não foi
necessário criar outra migração nem aceitar o `p_expected_jid` contra qualquer
identidade arbitrária no banco.

O teste integral do store PostgreSQL do fork passou **110/110**, incluindo a
canonicalização legítima e o negativo em que JID e LID mudam. TypeScript,
build, `git diff --check` e empacotamento seco passaram. O lint global ainda
encontra 23 erros anteriores em módulos não tocados; depois da correção do
único apontamento na linha nova, não restou erro novo nesta mudança. Esse gate
preexistente é registrado como não concluído, não como aprovação.

O pacote `@whiskeysockets/baileys@1.0.40` foi commitado, enviado e publicado
no registry interno. O tarball possui shasum
`d0a1387dc179716044808c9c634c3bef5d112c86`, integrity
`sha512-1e4m5OHqxt/nD3XrYgaGJKejlVDbUKy+a6Yg6Tkfi37bmV+hrHToDsZn82EzNex9sjp3Hci40wrvQX4+bbHXXQ==`
e URL
`https://gitea.devunder.com/api/packages/underchat/npm/%40whiskeysockets%2Fbaileys/-/1.0.40/baileys-1.0.40.tgz`.

Na Underchat, `package.json`, `pnpm-lock.yaml` e a allowlist de builds passam
a fixar a `1.0.40`. O contrato da dependência real exige a nova versão, os
dois aliases, o fingerprint, a reseal final e a ausência do caminho antigo que
promovia diretamente com `candidate.expectedJid`. Os contratos de dependência,
store, conexão e migração passaram **4 suites / 140 testes**. O próximo passo
foi validado também por typecheck global, ESLint e Prettier dos arquivos
tocados, `git diff --check`, instalação congelada e build TypeScript do Worker
Baileys. Ainda é obrigatório fazer commit/push antes do build, gerar somente a
imagem Baileys pela tela, torná-la default, reinstalar visualmente o Server 2 e
repetir a extensão. A aprovação live exige revisão `secure_import` em
`active`, sessão `ready`, runtime online, ACK central verdadeiro, container sem
restart e limpeza local somente depois dessa confirmação.

## 2026-08-20 — Baileys: promoção única e durável para handoff e plug-in

### O rollout `1.0.40` e a condição residual

A imagem exclusiva do Worker Socket `v20260820125802095`, digest
`sha256:236a7b8377b7317a0199e45fd01f84e6d35700965e0e6b49381798af4f3440bc`,
foi construída pela interface, promovida a `under-worker-baileys:latest` e
instalada no canal do Server 2. O container confirmado no reteste executava
`@whiskeysockets/baileys@1.0.40`, generation `8`, estava `healthy`, com restart
zero. Portanto a nova ocorrência não veio de imagem anterior nem de instalação
parcial.

A tentativa recebida às `13:09:53.742Z` criou a revisão `3418`, origem
`secure_import`, sobre o rascunho pristine `3417`. O pacote continha um único
`creds.json`; o Baileys autenticou, persistiu as credenciais e publicou o estado
nativo `online` às `13:09:58.671Z`. O checkpoint final ficou durável às
`13:09:59.498Z`, com checksum, JID, LID, registration ID, Noise key, identity
key, signed pre-key, assinatura e fingerprint presentes. Mesmo assim, o CAS
foi recusado às `13:09:59.506Z` com SQLSTATE `23514` e `REVISION_INVALID`. A
compensação restaurou a revisão `3417` às `13:09:59.786Z`, sem restart do
processo e sem queda do gRPC.

Essa evidência eliminou falta de material, checksum ausente, imagem antiga e
o rascunho de origem como causas. A condição restante era uma janela TOCTOU no
fork: `sealPromotionCandidate()` drenava as gravações e executava o checkpoint,
mas devolvia a mesma referência mutável de credenciais que o socket continuava
possuindo. Um `creds.update` podia alterar `me.id` depois de os records e
`whatsapp_device` terem sido capturados, enquanto a persistência correspondente
aguardava atrás de `writesPaused`. A promoção projetava o JID dessa referência
mais nova, enquanto o PostgreSQL comparava o JID do snapshot durável anterior;
o gate SQL recusava corretamente a divergência.

### Reuso do mesmo caminho da migração

O caminho do plug-in não pode reutilizar a etapa de origem inteira do handoff
WWebJS → Baileys: a migração lê uma projeção canônica completa, com device,
Signal, app-state e linhagem autorizada, enquanto a extensão desta tentativa
entregou apenas o arquivo de credenciais. Criar uma revisão WWebJS artificial
somente para atravessar o handoff duplicaria estado e inventaria uma linhagem
que não existiu.

A partir do ponto em que a candidata já autenticou e foi persistida, porém, os
dois fluxos são equivalentes. O fork `1.0.41` remove a promoção final específica
do plug-in e introduz uma única `promoteSealedCandidate()`, usada tanto pelo
handoff canônico quanto pelo `secure_import`. Essa rotina:

- valida a candidata e os gates de app-state exigidos pelo handoff;
- pausa e drena todas as gravações;
- grava um checkpoint cercado;
- relê o `creds` do próprio record durável depois do checkpoint;
- valida e projeta a identidade dessa releitura imutável;
- envia ao mesmo CAS o JID que corresponde exatamente ao
  `whatsapp_device` selado.

O plug-in acrescenta somente sua prova específica de continuidade entre os
aliases/fingerprint recebidos e o device durável. Não existe um segundo CAS,
uma segunda selagem ou uma política alternativa de identidade. As cercas de
lease, generation, epoch, capability, fingerprint, source lineage, checksum e
rollback continuam compartilhadas e fail-closed.

O teste novo injeta exatamente a corrida: depois de o checkpoint persistir, o
objeto vivo recebe outro PN antes da chamada de promoção. A asserção comprova
que o CAS usa o JID relido do record durável, e não a referência mutada. A suíte
integral do store passou **111/111**; TypeScript, build, Prettier,
`git diff --check` e o empacotamento seco passaram. O ESLint seletivo não
encontrou erros; informou somente que os dois arquivos não pertencem à
configuração do fork, comportamento já existente.

O fork foi commitado e enviado em
`b4d281b0b1b004d6c3a79d30817761df55afcee5`. O pacote interno
`@whiskeysockets/baileys@1.0.41` possui shasum
`02d9bab33c490216c945ce3bd5dbfd7b9704a7dd`, integrity
`sha512-FYQpcjL13lRdr899D/FnQemJ27I/OllttMTkb6vIqSd92HhNe8I4bvm/yjOwbka8Zdr0JHzCOTtzD92V1H6Srg==`
e tarball
`https://gitea.devunder.com/api/packages/underchat/npm/%40whiskeysockets%2Fbaileys/-/1.0.41/baileys-1.0.41.tgz`.

Na Underchat, dependência, lockfile, allowlist de build e contrato da dependência
real passam a exigir a `1.0.41`, a releitura pós-checkpoint e o uso de
`promoteSealedCandidate()` pelos dois fluxos. Os quatro contratos focados
passaram **140/140**, o typecheck global e o build do Worker Baileys passaram.
O rollout da nova imagem e o reteste visual ainda são pendentes neste ponto do
registro; a aceitação continua exigindo a revisão `secure_import` em `active`,
sessão `ready`, ACK central verdadeiro, restart zero e ausência de
`REVISION_INVALID`.

## 2026-08-20 — Baileys: remover a segunda comparação de JID da promoção

O rollout e o reteste da `1.0.41` foram executados. O Worker Baileys estava
realmente usando a imagem `sha256:eb4d3940a340310d144e6c511c567e6de5268288d414e9c2961f67db6c44beef`,
com `@whiskeysockets/baileys@1.0.41`, generation `9`, estado `healthy` e
restart count zero. Portanto, a persistência do erro não era cache, imagem
antiga nem falta de instalação.

A tentativa real criou a candidata `3420` a partir da revisão `3419`. Ela foi
importada, ficou nativamente online, recebeu o checkpoint final e executou a
releitura durável introduzida na `1.0.41`. Treze milissegundos depois dessa
releitura, o CAS retornou SQLSTATE `23514`; a compensação restaurou a revisão
`3419` sem reiniciar o processo. A mensagem pública continuou como
`REVISION_INVALID`.

A inspeção somente leitura depois do rollback mostrou que a candidata tinha
checksum, JID, LID, material criptográfico obrigatório, provas ADV, fingerprint
v2 e timestamps de persistência/validação. A origem continuava sendo o draft
Baileys original de pairing, sem JID, LID, UUID, provas ADV ou fingerprint. Isso
descarta a hipótese de a referência viva ter mudado depois do checkpoint e
restringe a falha à comparação redundante de `p_expected_jid` no primeiro gate
do CAS. O valor era enviado separadamente da prova durável, apesar de o plug-in
já aceitar continuidade por qualquer alias (PN ou LID) e fingerprint.

### Correção compartilhada na `1.0.42`

A promoção continua única para o handoff canônico e para o plug-in por meio de
`promoteSealedCandidate()`. Não foi criado outro fluxo nem outra função SQL. A
mudança remove somente a segunda política de identidade baseada em um JID
isolado:

- a candidata ainda é validada, pausada, drenada, checkpointada e relida do
  record durável;
- o `secure_import` ainda exige interseção entre os aliases originais e finais,
  além do mesmo fingerprint;
- quando a API pública recebe `expectedJid`, ele é validado contra os aliases
  do device selado antes de entrar no CAS e uma divergência falha como
  `PROJECTION_INVALID`;
- o CAS passa a usar os oito parâmetros estruturais e deixa
  `p_expected_jid` no default `NULL`, eliminando a comparação duplicada de um
  único alias;
- o PostgreSQL continua bloqueando worker/sessão/revisões, exigindo lease,
  fencing token, generation, epoch, capability, status promovível, checksum,
  projeção completa, fingerprint e continuidade de identidade/fingerprint com
  a origem. A exceção de origem vazia continua restrita ao draft inicial nunca
  vinculado;
- os dois motivos estáticos de SQLSTATE `23514` agora geram somente códigos
  seguros (`candidate_identity_incomplete_or_mismatched` ou
  `candidate_identity_changed`) nos logs, sem expor JIDs.

O teste novo prova que um `expectedJid` ausente dos aliases duráveis é rejeitado
antes da chamada SQL. As regressões do plug-in confirmam que a promoção não
envia um nono parâmetro, inclusive quando o servidor canonicaliza o PN e quando
o objeto vivo muda depois do checkpoint. A suíte integral do store passou
**112/112**; TypeScript, build, Prettier e `git diff --check` passaram. O ESLint
seletivo retornou zero erros e apenas os dois avisos já conhecidos de arquivos
fora da configuração.

O fork foi commitado e enviado em
`822e0b073028f91b0790d11a791e42402bf742c1`. O pacote interno
`@whiskeysockets/baileys@1.0.42` foi publicado com shasum
`33ec69a23511c47c166cb8ac64ba9a5f1ac913cb`, integrity
`sha512-z3EgSICP+Hmei5Tg2ceGqffSL+nq5LaVWbsO7JCSbVxS5AVo3wGGbw1OTzJZZiEOmldzj/ZOj9tYBX5gw0enLg==`
e tarball
`https://gitea.devunder.com/api/packages/underchat/npm/%40whiskeysockets%2Fbaileys/-/1.0.42/baileys-1.0.42.tgz`.

Na Underchat, `package.json`, lockfile, allowlist de build e contrato da
dependência real passam a exigir a `1.0.42`. Esta correção não requer uma nova
migração PostgreSQL. O rollout da imagem `1.0.42` e o reteste real permanecem
como o próximo gate operacional; a aprovação continua condicionada à candidata
`secure_import` terminar `active`, sessão `ready`, ACK central verdadeiro,
restart zero e ausência de `REVISION_INVALID`.

## 2026-08-20 — Baileys: classificação segura da rejeição transacional

### Evidência do rollout `1.0.42`

A imagem exclusiva do Worker Socket `v20260820135536029`, digest
`sha256:75e25084a13c17dd98939cc36b57e44a727bab952705e2e12e70d86f1b15790c`,
foi tornada default, instalada nos dois servidores e usada para recriar os oito
Warms Baileys. O canal de teste do Server 2 avançou para generation `10`; seu
container permaneceu `running/healthy`, com restart zero e o pacote
`@whiskeysockets/baileys@1.0.42` confirmado dentro da imagem.

A tentativa real das revisões `3421` → `3422` recebeu o pacote da extensão,
autenticou, persistiu `112` records e concluiu o checkpoint final com checksum,
JID, LID, registration ID, Noise key, identity key, signed pre-key, assinatura,
provas ADV e fingerprint v2. Vinte milissegundos depois o CAS PostgreSQL
retornou SQLSTATE `23514`. O rollback marcou a candidata como failed e restaurou
integralmente a revisão fonte, sem reiniciar o processo nem derrubar o stream
gRPC. A inspeção read-only depois da compensação confirmou a origem pristine de
pairing e o alvo completo; portanto o erro restante está em uma das duas
garantias estáticas da promoção, não no upload, handshake, checkpoint, imagem,
material importado ou disponibilidade do worker.

O log seguro não informou qual garantia falhou porque a classificação da
`1.0.42` comparava a mensagem do driver por igualdade byte a byte. O PostgreSQL
devolveu a mesma rejeição envelopada, então o código público permaneceu
`REVISION_INVALID`, corretamente sem registrar a mensagem bruta, mas também sem
o `rejection_reason` allowlisted necessário para distinguir o primeiro gate do
gate de continuidade com a origem.

### Instrumentação `1.0.43`

O fork commitado e enviado em `d88992d100` normaliza caixa e espaços e procura
somente as duas assinaturas estáticas allowlisted, inclusive na cadeia `cause`.
Ele continua sem registrar mensagem, JID ou identidade bruta e produz apenas um
dos códigos `candidate_identity_incomplete_or_mismatched` ou
`candidate_identity_changed`. Testes de regressão cobrem mensagens prefixadas,
mudança de caixa, envelope em `cause` e ausência dos valores sensíveis nos logs.

A suíte integral do fork passou **40 suites / 607 testes**, incluindo
**114/114** do store PostgreSQL; TypeScript, build, Prettier e
`git diff --check` passaram. O pacote interno
`@whiskeysockets/baileys@1.0.43` possui shasum
`8b16b2ab719f24a4c95d9de8d0813cb3258a1d7f`, integrity
`sha512-1pjbLKZxLFNhMrYp7tQ6TbGRPbG8SH+kYqi0Sp3ABuRwxm4uoIq2t/LwmEy0a3FW/yhFuQiwciCOiiR3vK2wDA==`
e tarball
`https://gitea.devunder.com/api/packages/underchat/npm/%40whiskeysockets%2Fbaileys/-/1.0.43/baileys-1.0.43.tgz`.

Na Underchat, o commit `ba73aeb69` fixa a `1.0.43` na dependência, lockfile,
allowlist e contrato da dependência real. Os quatro contratos focados passaram
**4 suites / 140 testes**, além do typecheck global, instalação congelada e
build do Worker Baileys. Esta publicação é deliberadamente diagnóstica e não
afrouxa nenhuma regra de promoção. O build exclusivo, rollout no Server 2 e
reteste da extensão devem registrar qual garantia rejeita o estado transacional;
somente essa evidência autoriza a correção definitiva.

O build exclusivo foi concluído como `v20260820144835656`; o Harbor registrou
o digest `sha256:32961c9cea04c95d0240b0206575ea07846512ac7173d63b93ed53a080f9f400`.
O pareamento pela interface inseriu a versão no catálogo e a tornou default
somente para `under-worker-baileys`. O rollout diagnóstico prossegue no Server
2; os resultados do runtime e do novo secure import devem ser acrescentados
abaixo antes de considerar esta etapa encerrada.

## 2026-08-20 — Correção definitiva do primeiro vínculo Baileys pelo plug-in

### Causa raiz

O diagnóstico transacional da revisão `3424` comprovou que o upload, o
handshake, a autenticação, a persistência dos records e o checkpoint com
checksum estavam completos. A rejeição SQLSTATE `23514` vinha do trigger
`guard_whatsapp_session_fingerprint_v17()`: ao promover o primeiro device de
uma sessão Baileys pristine, ele comparava a versão ausente da origem (`NULL`)
com a versão v2 recém-derivada do device de destino e tratava essa primeira
atribuição de identidade como troca de versão.

Isso explica a diferença para uma migração comum entre sessões já vinculadas:
nesse fluxo a origem já possui fingerprint e versão, enquanto o primeiro
vínculo pelo plug-in parte legitimamente sem ambos. O primitive compartilhado
de promoção já prova, sob os mesmos locks e CAS, que a exceção é exclusiva do
draft Baileys inicial nunca vinculado; portanto não foi criado um segundo fluxo
de importação nem duplicada a lógica de migração.

### Ajuste do banco e garantias preservadas

A migração incremental `atlas/prod/20260820151000.sql` substitui somente a
função do trigger. A transição `NULL` → v2 agora é aceita apenas quando os dois
campos de identidade do header anterior também são nulos. Se o header antigo
já declarar fingerprint ou versão e o device fonte não tiver versão, a
operação continua falhando fechada com SQLSTATE `23514`. Diferenças entre
versões não nulas continuam rejeitadas e toda nova identidade pronta continua
obrigada a usar `underchat-whatsapp-device-fingerprint-v2`.

Permanecem intactos os requisitos de lease, fencing token, generation, epoch,
capability, status promovível, checksum selado, projeção completa, identidade
do device e continuidade com a origem. A função continua sem permissão pública
de execução. O `atlas.sum` foi recalculado; o hash da nova migração é
`h1:i1xo4RzA0bCx6RsM3uRF+Fvj4Nz6+r/DIxbiVIrS5hw=`.

### Verificação automatizada e PostgreSQL real

Os contratos da migração e do schema passaram **2 suites / 73 testes**, além
do typecheck global, Prettier e `git diff --check`. Em um banco PostgreSQL
descartável, o Atlas aplicou do zero **311 migrações / 1907 statements**. Um
teste executável do trigger confirmou três casos:

- origem pristine sem identidade → destino v2: promoção permitida;
- origem estabelecida v1 → destino v2: rejeição `23514` preservada;
- origem pristine → destino v1: rejeição `23514` preservada.

O verificador integral já existente também foi iniciado nesse banco, mas parou
antes deste cenário em uma asserção preexistente e não relacionada de projeção
de status nativo (`verifyNativeRuntimeStatusProjection`, `0 !== 1`). Por isso a
aceitação desta correção foi sustentada pelo contrato focado, pelo teste SQL do
trigger e pelo fluxo real ponta a ponta descrito abaixo.

### Aceitação real do plug-in

A migração `20260820151000` foi aplicada integralmente no banco central. Sem
alterar novamente a extensão, o fork ou a imagem, o mesmo fluxo real criou a
revisão `3425`, persistiu `112` records, selou o checkpoint final com checksum,
revalidou as credenciais e promoveu a candidata sobre a revisão `3423`. O
handoff terminou como `completed`, a sessão ficou `ready`, o device ativo ficou
com fingerprint v2 e o ACK central ficou verdadeiro.

O Worker Baileys permaneceu `running/healthy`, com restart zero, na imagem
`v20260820144835656`, digest
`sha256:32961c9cea04c95d0240b0206575ea07846512ac7173d63b93ed53a080f9f400`,
usando `@whiskeysockets/baileys@1.0.43`. Após a confirmação online não houve
novo encerramento de conexão, rejeição de promoção, `REVISION_INVALID` ou erro
fatal. A interface e a extensão confirmaram o canal online e disponível para
uso.

O checksum não precisa permanecer preenchido depois da promoção: o checkpoint
usado pelo CAS estava selado e possuía checksum; qualquer escrita ordinária
posterior de credenciais ou keys invalida deliberadamente esse campo até o
próximo checkpoint. Essa invalidação posterior foi observada e é o
comportamento esperado, não uma perda da prova usada na promoção.

Aceite operacional concluído: a conexão pelo plug-in com Baileys reutiliza o
mesmo primitive transacional da migração, promove a primeira identidade v2 com
as garantias anteriores preservadas e permanece online após o handoff.

## 2026-08-20 — WWebJS: importar a projeção canônica pelo plug-in

### Evidência da falha e causa raiz

Depois de Baileys e WhatsMeow concluírem o fluxo real da extensão, o WWebJS
continuava terminando com a mensagem pública de que o cliente não conseguiu
inicializar a partir da sessão importada. A mensagem do Manager era secundária:
o log do worker registrou a falha exata de `client.initialize()` como
`wwebjs_canonical_projection_incomplete`.

Uma reprodução headless sobre o pacote preservado da tentativa comprovou que
o perfil bruto do Chrome era criado e relido, mas a exportação canônica após o
reload não conseguia reconstruir as autoridades do device e do transporte. Os
bloqueios incluíam fingerprint, Noise key, identity key, registration ID,
platform, LID migration state e routing info ausentes. O defeito era de
fronteira: o plug-in tratava o snapshot cru do IndexedDB `signal-storage` como
autoridade suficiente, enquanto o caminho de migração do próprio fork já
exporta essas informações pela ABI privada do realm autenticado antes que o
perfil seja interrompido.

Não foi criado um segundo conversor criptográfico na Underchat. A extensão
passa a executar diretamente
`exportCanonicalSessionProjection()` de
`@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge.js` no mundo MAIN da
aba autenticada, usando o ADV secret já capturado. A projeção só entra no
pacote quando:

- o codec é exatamente `wwebjs-canonical-session-v1`;
- `complete=true` e a lista de blockers está vazia;
- a versão do WhatsApp Web coincide com a versão do perfil bruto;
- os limites continuam em 64 MiB e 200 mil records.

O exportador foi auditado também depois do bundle Vite minificado. A função
serializada permaneceu autocontida: suas únicas referências externas são APIs
globais disponíveis no realm da página, sem captura do escopo do service
worker. O bundle, portanto, pode ser entregue por
`chrome.scripting.executeScript()` sem copiar ou reimplementar helpers do fork.

### Reuso do store canônico existente

No worker, o pacote é normalizado pelo mesmo
`normalizeCanonicalProjection()` já usado nas migrações. O adapter PostgreSQL
mantém a criação cercada do perfil candidato por
`stageExternalBrowserProjection()` e, na mesma revisão, converte a projeção de
browser com `canonicalBrowserProjectionToStore()` e a persiste pelo primitive
nativo já existente
`persistExternalBrowserBootstrapCanonicalProjection()`.

Com a autoridade canônica pendente, `RemoteAuth.beforeClientInjected()` segue
o caminho normal de `consumePendingCanonicalProjection()` antes de qualquer
fallback de bootstrap bruto. Permanecem compartilhados com as migrações o
codec, as provas de identidade, o fingerprint, os records Signal/app-state,
o resync gate, a lease, generation, epoch, capability, fencing token,
checkpoint, promoção e rollback. O perfil bruto continua anexado à mesma
revisão como artefato Chromium; ele deixou apenas de ser usado como fonte
criptográfica autoritativa.

Pacotes antigos sem projeção canônica continuam no fallback anterior no
backend para compatibilidade, mas a extensão nova falha antes de quiescer ou
enviar a sessão se não conseguir produzir uma projeção completa. Assim uma
captura incompleta não desloga o WhatsApp Web local e não cria uma candidata
condenada a falhar depois.

### Versão da extensão e provas antes do rollout

A extensão foi incrementada para `1.0.4` e passou a declarar exatamente o fork
interno `@wwebjs/whatsapp-web.js@1.34.147`, que já contém o exportador e os
primitives nativos necessários. Não foi preciso alterar ou publicar outra
versão do fork. Os pacotes dev e prod foram construídos e publicados nos
objetos oficiais do MinIO com cache desabilitado. Os metadados públicos
confirmam a versão `1.0.4`; os SHA-256 dos arquivos são, respectivamente,
`f8a2835d4f38c4f46b6c679d2e7ed69393af18ed6b26b598f4cf2bc827cca59a` e
`3b9bcf58e9a356cf67ca489ff8e80fb368f7e2a9518e2af429751cdb46fb90ff`.

Os contratos focados de conexão e store passaram **2 suites / 189 testes**.
A regressão nova prova que perfil bruto e projeção canônica são persistidos na
mesma candidata e que o caminho canônico tem precedência; o contrato anterior
continua provando o fallback sem projeção. Builds dev/prod da extensão, build
TypeScript do Worker WWebJS, typecheck global, ESLint seletivo,
`git diff --check` e validação de serialização do exportador passaram.

Neste ponto do registro, a imagem nova, o default, as instalações, os warms e
o reteste real ainda são pendentes. O rollout deve afetar somente o Worker
WWebJS. A aceitação exige extensão `1.0.4`, pacote WWebJS `1.34.147`, candidata
`secure_import` promovida a `active`, sessão `ready`, canal online, ACK central
verdadeiro, restart zero e limpeza local somente depois da confirmação.

## 2026-08-20 — WWebJS: correção do carregamento ESM e rollout operacional

### Falha encontrada no primeiro rollout

O primeiro build com a projeção canônica, `v20260820173126468` (digest
`sha256:3f6526602714e45e2fdfb5640c224f34d74f20dfe1ad56c193731e1cf2f2d267`),
foi instalado nos dois servidores. Ao renovar os quatro warms, o pool chegou a
zero e o reconciliador começou a criar novas candidatas, mas todas terminaram
em `warm_worker_http_health_not_ready:http_health_not_ready`.

A inspeção direta dos containers comprovou que não era falha de rede ou do
healthcheck. O processo Node encerrava antes de abrir a porta:
`ERR_MODULE_NOT_FOUND` para
`@wwebjs/whatsapp-web.js/src/session/CanonicalSessionBridge`. O TypeScript usa
resolução `bundler` e os testes rodam sobre TS, por isso o specifier sem
extensão havia passado localmente; o Node 24 executando o JavaScript ESM
compilado exige o arquivo explícito `CanonicalSessionBridge.js`.

O commit `0eb4f1de6` acrescenta `.js` aos imports do worker, da extensão e às
declarações locais. O contrato da dependência real agora importa o specifier
exato com o Node e confere que os dois adapters de runtime usam esse caminho.
Além disso, o Dockerfile passou a importar, durante o build, o bridge e os
arquivos compilados de conexão/store sob `UNDERCHAT_ENV_SCOPE=public`. Assim o
mesmo erro impede a criação da imagem em vez de aparecer somente no primeiro
container de produção. Os três contratos focados passaram **3 suites / 204
testes**; o contrato específico passou **15/15**, e build do worker, build da
extensão, typecheck global, ESLint seletivo e `git diff --check` passaram.

Essa correção não altera o formato da projeção, o banco ou os primitives de
promoção. O bundle da extensão continua na versão `1.0.4`; a mudança do
specifier é necessária para o runtime ESM não empacotado do worker, enquanto o
Vite já incorporava o mesmo módulo ao bundle da extensão.

### Imagem corrigida, servidores e warms

O build exclusivo corrigido concluiu como `v20260820175122537`, versão de
catálogo `01a02051-2b00-7163-9ab9-c4ec1d208fbb`, e tornou-se default somente
para WWebJS. O digest instalado é
`sha256:1d02816fdf8f88b22265b935fbb3a77d480d3dfccaedfbda1b28b85ca2c2f197`.
Server 1 e Server 2 foram reinstalados sequencialmente e voltaram a `online`.
Em ambos, um smoke test efêmero importou o bridge e os dois adapters compilados
e confirmou o codec `wwebjs-canonical-session-v1`.

O reconciliador então convergiu novamente para quatro warms `ready`, dois por
servidor. A inspeção física de todos confirmou `running/healthy`, o mesmo
digest acima e `@wwebjs/whatsapp-web.js@1.34.147`:

- Server 1: `01a02053-9ded-716f-9846-256ad1814125` e
  `01a02053-9de2-7119-9736-d6f3297d8b74`;
- Server 2: `01a02054-9bcc-75db-8b81-f76a6ab7f95c` e
  `01a02054-9bba-714b-b48a-6896c664a83c`.

### Canal preparado para o reteste real

O canal WWebJS `01a01abe-61e7-70af-bcf3-1fcbf6661afe` ainda carregava a
projeção pública de erro da tentativa antiga
`wwebjs_canonical_projection_incomplete`. Como não possuía número nem sessão
válida, foi usado o reset explícito com limpeza de sessão, e não uma
reutilização silenciosa do material inválido. A operação
`01a02057-1582-76fd-b2dc-c4ba41221414` concluiu na generation `7`; o canal ficou
`disponible`, sem status nativo residual. Seu container está
`running/healthy`, no digest corrigido, com o fork `1.34.147`, e não apresenta
mais `ERR_MODULE_NOT_FOUND`.

O perfil ativo do Chrome registra a extensão Underchat unpacked diretamente em
`apps/underchat_chrome_extension/dist/dev`, cujo build local já contém a
versão `1.0.4`. O aceite ponta a ponta continua pendente de recarregar essa
extensão no Chrome e executar uma nova importação a partir da aba autenticada.
Não se deve reutilizar token/pacote anterior ao reset. O gate final permanece:
candidata `secure_import` promovida a `active`, sessão `ready`, canal online,
ACK central verdadeiro, restart zero e limpeza do WhatsApp Web local somente
depois da confirmação.

## 2026-08-20 — WWebJS: materialização da identidade do device no primeiro secure import

### `canonical_device_missing` e a fronteira correta do bootstrap

O reteste com a projeção canônica ultrapassou a carga ESM e chegou ao store,
mas foi recusado por `whatsapp_session_canonical_device_missing`. A sessão de
destino ainda era pristine: o pacote seguro já continha a autoridade canônica
do companion, porém a candidata PostgreSQL não possuía um device anterior a
ser usado como referência. A regra geral de continuidade não poderia ser
removida, porque continua necessária em checkpoints, recriações e migrações de
sessões previamente vinculadas.

O fork passou a admitir a materialização inicial somente no bootstrap externo
do plug-in, com source `secure_import`, projeção canônica completa e contexto
transacional da sessão. A primeira implementação, publicada como
`@wwebjs/whatsapp-web.js@1.34.148` no commit `76ce5bdb`, amarrou a exceção ao
estado `preparing`. O reteste real provou que essa hipótese era incorreta: a
função compartilhada `create_whatsapp_session_candidate()` muda a sessão para
`handoff` enquanto a candidata está ativa e só restaura `preparing` durante o
rollback. Portanto, a exceção nunca era alcançada no ponto de consumo.

A versão `1.34.149`, commit `f3c342bc`, passou a exigir `handoff` para o
bootstrap seguro e preservou `preparing` apenas no caminho legado de volume.
Ela não relaxa a continuidade de uma sessão estabelecida: a exceção continua
restrita ao primeiro device, ao source seguro e à candidata corrente. A suíte
do fork passou com **550 testes e 1 pending**. Na Underchat, os commits
`bff8974a5` e `e7cca916e` fixaram sucessivamente as versões `1.34.148` e
`1.34.149`, atualizaram lockfile e endureceram o contrato da dependência real.

O pacote `1.34.149` foi publicado com shasum
`97a1bc220bbfe90a1b11747992fd35155881b151` e integrity
`sha512-jomnpAU6F33SWZOAaFypPRKhtuWEShEFXWQU/Lxw8/aEKRd+x19rcC6VFcnIQ+2mVCWABcQlrAS/dbaXBMDwjA==`.
Os três contratos focados passaram **3 suites / 204 testes**, além de
instalação congelada, typecheck global, build do worker, builds dev/prod da
extensão e smoke ESM dos adapters compilados.

### Rollouts intermediários e evidência que deslocou a falha

A `1.34.148` foi entregue na imagem `v20260820184342331`, digest
`sha256:6ce0e015db08454f017d6b349c80355bd8e3fb129dea86f6d442ad197ff7aba7`,
catálogo `01a02081-6e80-77f6-acbb-b8ea16873399`. Depois da correção do estado,
a `1.34.149` foi entregue na imagem `v20260820190828996`, digest
`sha256:cb173d31143810cda2dc9a781884060616c6ef6dd0d72aa4c429414950c44973`,
catálogo `01a02098-316c-7129-bcfc-b9540f58b781`. Os dois servidores foram
instalados sequencialmente e os quatro warms substituídos. Todos ficaram
`running/healthy`, restart zero, no mesmo digest e com a versão correta do
pacote.

O reteste na generation `13` e candidata `3450` comprovou que essa etapa foi
resolvida. O worker registrou a projeção bruta do browser com `1255` records e
`387414` bytes, materializou a projeção canônica com `2191` records e `104276`
bytes, marcou `device_replaced=true` e source
`secure_import_browser_bootstrap`. A falha seguinte deixou de ser identidade e
passou a ser
`whatsapp_session_app_state_snapshot_resync_future_mutation_mac`.

## 2026-08-20 — WWebJS: normalização compartilhada dos MACs futuros do app-state

### Causa exata

A inspeção da candidata `3450` mostrou que as cinco coleções canônicas tinham
versão, hash, snapshot MAC e sync keys válidos. O problema estava nas filas
privadas do browser: o snapshot continha mutation MACs acima do watermark
confirmado de cada coleção. Esses MACs ainda não pertencem ao estado LT-hash
comprometido e o resync gate, corretamente, recusava persistir uma projeção que
alegasse futuro não confirmado.

A distribuição observada foi:

- `critical_block`: 1 MAC futuro, versão confirmada 2 e futura 3;
- `critical_unblock_low`: 663, confirmada 1 e futura 2;
- `regular`: 14, confirmada 2 e futuras 3–7;
- `regular_high`: 3, confirmada 1 e futuras 2–7;
- `regular_low`: 341, confirmada 3 e futuras 4–7.

No total, a candidata possuía **1022 mutation MACs futuros**. Não havia motivo
para reimplementar a regra no adapter PostgreSQL: o próprio
`BrowserSessionBridge.js` já expunha
`normalizeCanonicalAuthoritativeAppStateForPortablePersistence()`, usado pela
portabilidade entre providers para reter somente o app-state confirmado.

### Correção `1.34.150` sem duplicação

O commit `900a0bee` do fork reutiliza esse normalizador em
`PostgresSessionStore.persistExternalBrowserBootstrapCanonicalProjection()`.
Antes do resync gate, a projeção é normalizada somente quando
`canonicalProjectionHasFutureMutationMac()` detecta pelo menos um MAC acima do
watermark. A operação remove apenas esses MACs futuros e preserva versões
confirmadas, LT-hashes, snapshot MACs, MACs já comprometidos, sync keys,
identidade e demais records Signal. Quando não existe MAC futuro, o mesmo
objeto segue intacto, mantendo compatibilidade byte a byte com os fluxos
anteriores. O log novo
`secure_import.browser_canonical_app_state_normalized` publica apenas
contagens agregadas, sem material criptográfico.

As regressões novas provam os dois lados: um MAC v2 acima do watermark v1 é
removido enquanto o MAC v1 é mantido, e uma projeção sem futuro permanece a
mesma instância. A suíte completa do fork passou com **552 testes e 1
pending**, além de `npm run check`, `npm run prepack` e `git diff --check`.

O pacote `@wwebjs/whatsapp-web.js@1.34.150` foi publicado com shasum
`e8b04d4f56c3f96c00878090693a5011b84ddd43` e integrity
`sha512-/muBvFJFPaUAYUBAhvgMqUTLPuXmxfr+XjG5PkFCbReHVjy02rUnS3XMXySVHVY9jodWUxmWbp+tgui8lZhIzA==`.
Na Underchat, o commit `531bdc2da` fixa essa versão no root e na extensão,
mantém o lockfile mínimo e verifica no contrato da dependência real o helper,
o detector e o evento de normalização. Passaram **3 suites / 204 testes**,
instalação congelada, typecheck global, build do Worker WWebJS, builds dev/prod
da extensão, smoke ESM, Prettier, ESLint seletivo e `git diff --check`. Não há
migração de banco nesta correção.

### Rollout `1.34.150`, warms e canário

O build exclusivo `01a020ac-1b88-727e-8da9-3ed11451b655` produziu a imagem
`v20260820193545288`, catálogo
`01a020b0-f5e7-716b-96b2-cc80a87fef5f`, digest
`sha256:e90fa771e5e719e4afea21443dbeb607dda2a234f040a7e74ebdfbbe22cd3292`.
Ela se tornou default somente para WWebJS. Server 1 e Server 2 foram
reinstalados em sequência, voltaram a `online`, e um smoke físico em cada host
confirmou o digest e `@wwebjs/whatsapp-web.js@1.34.150`.

O pool foi renovado e convergiu para quatro warms `ready`; a inspeção física
confirmou `running/healthy`, restart zero, o digest acima e a versão `1.34.150`:

- Server 1: `01a020b7-6980-70e6-8026-d431014989d1`, container
  `37d63df0c38e`, e `01a020b7-694f-750d-8714-0273e336bf2f`, container
  `0d4e04e95af3`;
- Server 2: `01a020b7-6996-7299-bbf9-31ddcb830b01`, container
  `d2ae4684299c`, e `01a020b7-6964-7446-8b5a-293c1cce5299`, container
  `5230ae2f1a6b`.

O reset explícito do canal, operação
`01a020b8-cde7-741a-a32c-cd2c0ee5791b`, concluiu a generation `15`; o
container promovido `4a0eda571044` está `running/healthy`, restart zero, no
mesmo digest e pacote `1.34.150`. Uma tentativa manual coincidiu com esse reset:
a interface chegou a exibir conectado, mas a limpeza controlada da generation
`14` iniciou logo depois e retornou ao QR. O banco comprova que isso não foi um
rollback autônomo da `1.34.150`: após o reset há somente a revisão pairing
`3454`, staging e vazia, na generation `15`; nenhuma candidata secure import
foi criada nessa generation.

Não executar outro reset durante o canário. O reteste precisa usar token novo,
criado depois da operação acima. O aceite final continua pendente neste ponto
do registro e exige observar o evento de normalização, zero MACs acima dos
watermarks na candidata persistida, promoção `secure_import` para `active`,
sessão `ready`, canal online, ACK central verdadeiro, restart zero e limpeza
local somente depois da confirmação.

## 2026-08-20 — auditoria de latência do import por plugin no WWebJS

O canário seguinte, já na generation `18`, concluiu de ponta a ponta e tornou a
revisão `3471`, `secure_import`, ativa. O handoff
`3d390bdb-2cba-49d1-a8b6-6acb8b6eba47` terminou sem erro nem recovery, o
container permaneceu `running/healthy`, com restart zero, e o runtime ficou
online com sessão válida, envio, recepção e command ingress autorizados. A
demora percebida era real, mas não estava no upload do plugin nem em timeout de
gRPC.

### Linha do tempo medida

Os tempos abaixo usam os eventos do worker, as linhas de handoff/revisão e o
outbox PostgreSQL. Horários estão em UTC:

| Marco | Horário | Duração relevante |
| --- | --- | ---: |
| pacote recebido e restore assíncrono iniciado | `22:40:15.996`–`22:40:16.181` | `185 ms` |
| primeira inicialização WWebJS | `22:40:16.197`–`22:40:50.779` | `34,582 s` |
| segunda inicialização WWebJS | `22:40:50.807`–`22:42:27.202` | `96,395 s` |
| handoff criado até revisão promovida/persistida | `22:40:16.052`–`22:42:21.664` | `125,612 s` |
| pacote recebido até readiness forte do worker | `22:40:15.996`–`22:42:27.201` | `131,205 s` |
| primeiro RuntimeHealth totalmente pronto | `22:42:29.034` | `~1,8 s` após o ONLINE nativo |
| status outbox publicado | `22:42:29.374` | `160 ms` após criação |
| projeção legada do worker confirmada pelo Manager | `22:42:50.643` | `~21,6 s` após o primeiro health pronto |

A primeira inicialização não foi uma espera artificial. Depois das duas
importações offline e da promoção, o socket encerrou com `sync_failure`; o
credential guard observou `socket_logout_job`, invalidou essa instância e
iniciou a segunda tentativa imediatamente, sem backoff. Suprimir esse erro
seria inseguro: a instância havia sido invalidada pelo próprio WhatsApp. A
exceção estreita existente para um único logout sem motivo não se aplica a um
`sync_failure` conhecido.

Na segunda tentativa, cada passagem de import/limpeza do store Signal levou
aproximadamente `11 s`. O app-state passou `45,476 s` no catch-up: quatro das
cinco coleções convergiram, a quinta permaneceu sem progresso por `30 s`, e só
então o recovery controlado de um único realm foi autorizado. Depois disso as
cinco coleções ficaram iguais e os MACs futuros foram normalizados. Reduzir o
gate criptográfico de `30 s` com uma única amostra poderia interromper um sync
oficial ainda legítimo e, portanto, não foi feito.

Também não havia perfil reutilizável. A revisão anterior `3470`, criada por
pairing, não possuía fingerprint de device nem profile anchor; logo o resolver
corretamente recusou reuse. Ampliar o resolver ou pular a segunda importação
sem essas provas permitiria misturar identidade/perfil de outra revisão e não
é uma otimização aceitável.

### Comparação com a migração existente

Os seis canários limpos de migração cross-provider para WWebJS registrados
anteriormente ficaram em aproximadamente `40,9`–`42,5 s`, sem retry. O canário
do plugin não representa esse caminho normal: ele somou uma tentativa
descartada de `34,582 s` e um app-state excepcional que precisou do recovery
após `30 s` sem progresso. O mecanismo central de promoção continua sendo o
mesmo, mas o plugin parte de um perfil vivo do navegador e, neste caso, não
dispunha do profile anchor que uma revisão WWebJS previamente selada poderia
reutilizar.

Depois do readiness forte ainda existia uma duplicação mensurável no Manager.
`WorkerSecureConnectionSessionUseCase` aplicava a janela genérica de
estabilidade de `20 s`, embora o WWebJS atual só exponha RuntimeHealth pronto
depois de:

- checkpoint canônico e persistência da revisão ativa;
- duas amostras nativas ONLINE consecutivas;
- sessão autenticada com `can_send` e `can_receive_runtime` verdadeiros;
- command ingress Kafka atribuído e autorizado;
- provider/generation exatos e ausência de erro/degraded reason.

Os probes do balanceador responderam continuamente em milissegundos: falsos
até `22:42:28.021` e verdadeiros a partir de `22:42:29.034`. Isso elimina as
hipóteses de deadline gRPC e polling lento. Os `~20 s` restantes vieram
exatamente da janela genérica do Manager.

### Otimizações seguras aplicadas

O WWebJS passa a usar uma janela final específica de `5 s`, configurável por
`SECURE_CONNECTION_WWEBJS_WORKER_VALIDATION_STABLE_MS`, mantendo o piso de
cinco segundos. Com o poll de um segundo, ainda são observadas várias amostras
fortes e um logout imediatamente posterior continua abortando o aceite. O
Baileys mantém os `20 s` genéricos e o WhatsMeow conserva sua regra já
existente. Sob a mesma execução observada, isso remove aproximadamente `15 s`
da espera visível sem alterar import, promoção, app-state, Kafka ou ACK.

Foi corrigida ainda a corrida entre o evento `ready` e a resolução de
`client.initialize()`. O SDK pode emitir `ready` imediatamente antes de a
Promise de initialize encerrar; antes, o handler fazia um health check nesse
intervalo, publicava `client_initializing/connecting` transitório e somente o
state probe seguinte corrigia para conectado. Agora o evento é entregue ao
probe já existente, preservando `secureImportRestore` e `readyObserved`, e a
confirmação ocorre assim que initialize termina. Nenhuma chamada destrutiva ou
relaxamento de readiness foi introduzido.

Não foram reduzidos o no-progress de `30 s`, as duas passagens offline, os
checkpoints, a validação de fingerprint/identidade, as duas amostras ONLINE, a
barreira Kafka, o ACK central ou o retry fail-closed de `sync_failure`.

Validação local desta alteração:

- contratos WWebJS + secure connection: **2 suites / 152 testes**;
- builds Turborepo filtrados de `manager` e `worker_wwebjs`: **2/2**;
- ESLint seletivo e Prettier: aprovados;
- `git diff --check`: aprovado.

## 2026-08-21 — atualização do ZIP de produção da extensão no MinIO

O pacote de produção da extensão foi reconstruído a partir do `main` no commit
`e91dccbb0695055d1c1633951f106cd1859eda2d`, usando o script oficial
`package:prod` do workspace `underchat_chrome_extension`. O manifesto permanece
na versão `1.0.4`, aponta para `https://api-manager.underchat.com.br` e contém
somente os artefatos de produção, sem sourcemaps.

O objeto substituído foi exclusivamente:

`underchat/downloads/underchat-chrome-extension/prod/underchat-chrome-extension.zip`

Antes da escrita, o objeto público tinha SHA-256
`3b9bcf58e9a356cf67ca489ff8e80fb368f7e2a9518e2af429751cdb46fb90ff`,
ETag `255eb3333462d5f2493d24f198ff3638` e `63.499` bytes. O artefato novo tem
SHA-256 `3dca38658bdd7999c252e47d3955e5ee8130d50eb67354084b755d03487c88f6`,
ETag `85b774076afe8d766bd81175f56a4464` e também `63.499` bytes. Os metadados do
objeto registram versão `1.0.4`, commit de origem e SHA-256, com
`Content-Type: application/zip` e
`Cache-Control: no-cache, no-store, must-revalidate`.

A primeira tentativa pelo endpoint interno não alcançou a rede e uma tentativa
de escrita no endpoint público com o par de credenciais do endpoint interno foi
rejeitada por assinatura; ambas ocorreram antes de qualquer mutação. A escrita
foi então realizada com a configuração específica do endpoint público.

Após a substituição, o ZIP foi baixado novamente pela URL pública com cache
buster. O arquivo remoto ficou byte a byte igual ao artefato local, o SHA-256
foi confirmado e `unzip -t` validou todos os arquivos sem erro. Nenhum canal,
worker, warm, imagem ou outro objeto do bucket foi alterado nesta operação.

## 2026-08-22 — Underchat Authenticator unificado com a importação validada da extensão

### Divergência encontrada

O `Underchat Authenticator` possuía uma cópia própria e antiga da extração CDP
do WhatsApp Web. Baileys e WhatsMeow recebiam um pacote montado localmente no
processo Electron, enquanto WWebJS não passava pela projeção canônica que já
estava validada na extensão `1.0.4`: ele enviava somente uma cópia do perfil
Chromium coletada depois do fechamento do navegador. Essa diferença permitia
que uma correção da extensão não chegasse ao Authenticator e mantinha mais de
seiscentas linhas de conversão criptográfica duplicadas.

Não foi criado outro conversor. A extração da página, o gate de readiness, o
contexto do WhatsApp Web, o mapeamento de worker para provider e a construção
do pacote passaram para o workspace privado e JIT
`@underchat/whatsapp-web-session-browser`, em
`packages/whatsapp-web-session-browser`. A extensão conserva seus imports
anteriores por reexports finos, e o Authenticator consome exatamente o mesmo
módulo. O bundle Electron exclui apenas esse workspace da externalização para
incorporá-lo no `app.asar`; portanto, o instalador não depende da existência do
monorepo no computador do usuário.

O builder compartilhado agora recebe explicitamente a origem
`chrome_extension` ou `underchat_authenticator`, versão e plataforma. Isso
remove o uso implícito de uma constante exclusiva da extensão sem alterar o
formato `underchat-wa-web-session-v1`. O cliente HTTP do Authenticator também
estende o mesmo tipo compartilhado, em vez de repetir o contrato de upload.

### Material entregue a cada provider

| Provider  | Material produzido pelo Authenticator                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Baileys   | `whatsapp_web_creds`, resumo seguro e `baileys_multi_file_auth_state`, incluindo a identidade Signal canônica do companion           |
| WhatsMeow | `whatsapp_web_creds`, resumo seguro e perfil lossless disponível, sem fabricar auth state de Baileys                                 |
| WWebJS    | credenciais, `whatsapp_web_profile` lossless e `wwebjs_canonical_projection` gerada pelo `CanonicalSessionBridge` do fork `1.34.150` |

Para WWebJS permanecem os limites de `64 MiB` e `200.000` records da projeção.
O pacote falha fechado se a versão exata do WhatsApp Web não existir, se o
perfil tiver qualquer serialização com perda, se a projeção estiver incompleta,
contiver blockers ou declarar outra versão web. Depois da captura canônica, o
Chrome controlado é encerrado e o snapshot físico `wwebjs_local_auth` continua
sendo anexado como fallback compatível. Assim, o caminho novo não remove a
defesa que já existia; ele acrescenta a autoridade canônica que faltava.

As funções de página são serializadas com argumentos JSON validados e
executadas por CDP no próprio `web.whatsapp.com`. O bundle de produção foi
inspecionado e contém as funções compartilhadas e o bridge canônico, sem
referência runtime a `@underchat/whatsapp-web-session-browser` e sem o antigo
`EXTRACT_WHATSAPP_WEB_AUTH_DUMP_SCRIPT`.

### Versão, validação e artefatos

O Authenticator foi incrementado de `1.0.1` para `1.0.2`. Não houve alteração
de schema, migração, worker, warm ou protocolo do Manager. A validação local
concluiu com:

- contrato dos três providers: **1 suite / 5 testes**;
- typecheck global do monorepo;
- ESLint seletivo e Prettier;
- builds de produção da extensão e do Authenticator: **2/2**;
- empacotamento Linux `.deb`/AppImage e Windows NSIS;
- smoke do binário Linux empacotado em Xvfb até `app.ready`, criação, carga e
  exibição da janela de produção;
- inspeção do `.deb` confirmando pacote `underchat-authenticator`, versão
  `1.0.2` e arquitetura `amd64`.

Os artefatos locais finais são:

- Linux `.deb`: SHA-256
  `c07981da429ef7a0bf0a997f83ca2a51609ae33dd042c53a2adfea56f6bd24d5`;
- Linux AppImage: SHA-256
  `78216d9f5981b79864f1c2e7f53ef6b2c5bf0ef936372419cce63cb6b25cecb9`;
- Windows NSIS: SHA-256
  `610173bf34cdc4475cd6556f30b01e1fda4911f1015877a67ce6ca7df8945b48`;
- Windows blockmap: SHA-256
  `b724ec34d2ee401405745af80904b5345c40b06cc401d10e9d005c4a37628ce9`.

O instalador Windows foi assinado pelo mesmo certificado self-signed já usado
pelo pipeline atual; a assinatura foi aplicada com sucesso, mas não constitui
uma cadeia pública confiável. macOS não foi reconstruído neste host Linux. O
aceite operacional final do Authenticator continua sendo uma importação real
com a versão `1.0.2` para cada provider, exigindo a mesma candidata
`secure_import`, promoção, readiness forte, ACK central e limpeza local somente
depois da confirmação já documentados para a extensão.

### Publicação de produção e sincronização dos repositórios

O código foi registrado no `main` do Gitea pelo commit `3d6ae82d6` e enviado
ao `origin`. Os artefatos Linux e Windows foram então publicados nos quatro
objetos estáveis consumidos pelo catálogo:

- `underchat/downloads/underchat-authenticator/prod/linux.deb`;
- `underchat/downloads/underchat-authenticator/prod/linux.AppImage`;
- `underchat/downloads/underchat-authenticator/prod/windows.exe`;
- `underchat/downloads/underchat-authenticator/prod/windows.exe.blockmap`.

Um `PutObject` único foi recusado pelo proxy com HTTP `413` antes de qualquer
mutação. A publicação efetiva usou multipart S3 de `8 MiB`, respectivamente
com `13`, `17`, `14` e `1` partes. Todos os objetos registram nos metadados a
versão `1.0.2`, o source commit `3d6ae82d6` e o SHA-256 do artefato. Os ETags
finais são `e270160cb7603f5fab075c2cad14c89f-13`,
`d1f5d7ad1b6aee7646c61f7ac006cddf-17`,
`fb5383ef3f409b3e8ae1d1296fcd2264-14` e
`4c68accb9190c8364f41c6e1153a7dce-1`, na ordem acima.

Depois da escrita, os quatro objetos foram baixados pela URL pública com cache
buster e recalculados por streaming. Os hashes remotos coincidiram exatamente
com os quatro hashes locais documentados acima. Antes desta publicação, Linux
apontava para `1.0.1` e o instalador Windows ainda era a geração antiga de
julho; ambos agora servem `1.0.2`. Os objetos macOS permaneceram inalterados.

O `github/main` estava divergente: possuía 20 commits próprios, enquanto o
`main` atual carregava centenas de commits adicionais e objetos históricos de
instaladores acima do limite de `100 MB` do GitHub. Não houve force-push nem
reintrodução desses binários. Foi criado um commit fast-forward sobre o próprio
`github/main`, preservando seus commits e usando exatamente a árvore do commit
Gitea atualizado. A verificação posterior confirmou o mesmo tree SHA
`4933c8797460d88593232c30b2a8947c3ebf1476`, diff vazio entre as duas árvores e
`underchat_authenticator@1.0.2` no GitHub. A atualização documental subsequente
segue o mesmo modelo de snapshot sem arquivos de release.
