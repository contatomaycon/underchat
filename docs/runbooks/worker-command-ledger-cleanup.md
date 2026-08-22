# Runbook de limpeza integral dos ledgers Redis legados

Objetivo: remover integralmente os namespaces V2/V3 antigos depois que Kafka
de comandos estiver permanentemente fechado. Esta entrega apenas documenta a
operação; ela não executou `SCAN`, `UNLINK`, `DEL` ou qualquer escrita no Redis
de produção.

## Contrato V4 que deve estar ativo primeiro

Redis continua sendo apenas a barreira curta contra repetição do efeito e o
estado operacional de lanes/recovery. Ele não recebe fila nem payload original
do comando. Os tempos são hardcoded e iguais em TypeScript e Go:

| Estado/recurso V4                 |                                         Prazo máximo |
| --------------------------------- | ---------------------------------------------------: |
| comando JetStream                 |                                                5 min |
| retry público do mesmo ID         |                                                2 min |
| dedupe de publish JetStream       |                                                5 min |
| `reserved`                        |                                               30 min |
| `provider_invoked`                | 1 h; watchdog converte para `ambiguous` em até 5 min |
| `succeeded`                       |                                                 12 h |
| `failed` / `expired`              |                                                  2 h |
| `ambiguous`                       |                                                 24 h |
| lane/predecessor                  |                                               15 min |
| identidade de admissão            |                     24 h; impede renascer o mesmo ID |
| evidência de deadline             |                         24 h; identidade sem payload |
| recovery de resultado             |   24 h; removido imediatamente após todos os PubAcks |
| tentativa operacional de schedule |                                                 24 h |

Leituras, polling e detecção de duplicata não renovam TTL terminal. Depois da
projeção global confirmada, o ledger é compactado para tombstone de até 1 KiB,
sem texto, `meta_json`, `result_json`, `recovery_json`, owner ou erro detalhado.

## Allowlist exata de exclusão

Somente estes quatro patterns podem entrar no manifest:

```text
message-send:idempotency:v3:*
message-send:recovery:v3:*
{schedule-status}:message-attempt:v2:*
{schedule-status}:reconciliation:v1:*
```

O quarto pattern inclui seus índices `deadlines` e `versions`. Nenhum outro
prefixo é permitido. Em especial, nunca apagar:

- `message-send:idempotency:v4:*`;
- `message-send:recovery:v4:*` ou o diretório de recovery V4;
- `message-send:lane:v1:*`;
- `{schedule-status}:message-attempt:v3:*`;
- `{schedule-status}:reconciliation:v2:*`;
- sessão WhatsApp, QR Code, Centrifugo, cache, spool ou qualquer chave cujo
  nome apenas contenha `v2`/`v3` sem casar byte a byte com a allowlist.

Não usar `KEYS`, `FLUSHDB`, `FLUSHALL`, wildcard em `DEL` nem apagar o prefixo
pai `message-send:*`.

## Barreira obrigatória

A limpeza integral só é segura quando uma operação antiga não pode mais voltar
ao provider. Execute na ordem:

1. implante todos os writers e readers V4 em Node e Go;
2. prove individualmente que envio direto, schedule, notification, profile/status, provider official, email e auto-reply escrevem/leem V4. Nenhum desses fluxos pode conservar fallback V2/V3; testes golden Node↔Go devem confirmar constantes, formato das chaves e máquina de estados;
3. bloqueie novas admissões Kafka de comandos;
4. pare producers, consumers e recoveries V2/V3;
5. mude epochs legados para `draining`;
6. espere zero handlers, zero chamadas SDK em voo, zero `reserved` e zero
   `provider_invoked` nos quatro namespaces antigos;
7. converta qualquer invocação incerta para `ambiguous` pelo código suportado;
8. escoe somente resultados globais ainda necessários;
9. marque os epochs legados como `closed` e mantenha o tombstone sem TTL;
10. exclua os tópicos e groups Kafka legados conforme o runbook de migração;
11. ative o guard permanente: comando sem o novo `origin_epoch` ou anterior ao
    `cutover_at` nunca cruza a fronteira do provider;
12. prove por inventário de imagens/processos que nenhum writer antigo ainda
    pode iniciar.

Se qualquer item falhar, não apague chave alguma. Depois dessa barreira, os
dados antigos foram declarados efêmeros e podem ser eliminados integralmente;
não é necessário preservar backlog, lag ou payload Kafka.

## Dry-run obrigatório

Execute no primary autoritativo com credencial operacional restrita:

1. capture `INFO memory`, `INFO persistence`, replication offsets, CPU, p95/p99
   e `lazyfree_pending_objects`;
2. percorra um pattern de cada vez com
   `SCAN <cursor> MATCH <pattern> COUNT 500`;
3. para cada chave, registre `TYPE`, `PTTL`, estado quando aplicável e amostra
   bounded de `MEMORY USAGE`;
4. registre apenas SHA-256 da chave em logs/manifest; não grave telefone,
   conteúdo, payload ou credencial;
5. grave checkpoint reiniciável a cada 10.000 chaves ou 30 segundos;
6. repita a varredura completa até o cursor retornar `0` para os quatro
   patterns e consolide duplicatas do `SCAN` pelo hash da chave;
7. compare contagem com zero writers antigos, epochs fechados e ausência dos
   tópicos Kafka antes de autorizar apply.

O inventário read-only de 13/08/2026 estimou aproximadamente 893.100 chaves V3,
média amostrada de 4.036 bytes e 99,2% em `succeeded`: cerca de 3,4 GiB. Esses
números são referência; a decisão usa a coleta imediatamente anterior.

## Apply reiniciável

O processo consome o manifest aprovado e nunca decide/apaga por um glob cego:

1. revalide barrier, `cutover_at`, epochs fechados, primary `run_id`, hash do
   manifest e allowlist antes de cada lote;
2. leia novamente `TYPE` e confirme que a chave ainda pertence exatamente ao
   pattern esperado;
3. envie `UNLINK` em batches máximos de 100 chaves;
4. limite inicialmente a 500 chaves/s e aguarde 200 ms entre batches;
5. salve cursor, pattern, contagens e último lote confirmado em checkpoint;
6. trate chave já ausente como idempotência individual, nunca como aprovação
   de um pattern diferente;
7. ao terminar, execute novos `SCAN` até os quatro patterns retornarem zero;
8. aguarde `lazyfree_pending_objects=0` ou a linha de base.

Para 893 mil chaves, 500/s produz piso de cerca de 30 minutos. O teto absoluto
é 1.000/s, apenas após provar saúde. `UNLINK` move a liberação para lazy free;
ele não elimina custo de CPU/memória.

## Stop conditions

Pause automaticamente o próximo lote se:

- Redis p99 ficar acima de 10 ms por três minutos;
- CPU do primary superar 70%;
- replica lag superar 1 s ou 5 MiB;
- `lazyfree_pending_objects` ultrapassar 100 mil e continuar crescendo;
- blocked clients crescerem mais de 10% sobre o baseline.

Cancele imediatamente se:

- Redis p99 ultrapassar 20 ms;
- `aof_delayed_fsync > 0`, houver erro AOF ou troca de primary/run_id;
- uma réplica desconectar;
- ocorrer qualquer eviction;
- blocked clients crescerem mais de 25%;
- surgir writer V2/V3, comando Kafka novo, epoch reaberto ou chamada duplicada
  ao provider;
- o processo encontrar chave fora da allowlist.

Preserve o checkpoint após pausa/cancelamento. Nunca compense um alerta
reduzindo TTL V4 automaticamente.

## Backup e reversibilidade

Os quatro namespaces foram declarados efêmeros; não é necessário backup lógico
individual nem export do valor das chaves. `UNLINK` é irreversível. Os
mecanismos de segurança são a barreira, o epoch fechado, o guard de
`cutover_at`, o dry-run, o manifest e os checkpoints. Um snapshot operacional
já existente pode continuar segundo a política normal do Redis, mas não é
pré-requisito deste cleanup nem autorização para reabrir epoch antigo.

## Verificação e liberação

1. execute duas varreduras completas dos quatro patterns, separadas por cinco
   minutos; todas devem retornar zero;
2. confirme `lazyfree_pending_objects` na linha de base e a redução de memória;
3. prove ausência de writers antigos e zero tentativa de recriação Kafka;
4. valide V4 intacta por contagem/TTL de cada estado e recovery/lane saudáveis;
5. confirme `duplicate_provider_invocation_total=0`;
6. libere tráfego em 5% por cinco minutos, 25% por dez minutos e 100%;
7. arquive manifest, hash, checkpoints, contagens e métricas antes/depois.

A limpeza termina somente com zero chave nos quatro patterns, zero writer
antigo, epochs fechados e todos os SLOs Redis/provider preservados.
