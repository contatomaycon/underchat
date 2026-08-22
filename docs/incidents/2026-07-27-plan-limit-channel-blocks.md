# Incidente de canais marcados como parados — 2026-07-27

## Escopo

Foram investigadas cinco contas reportadas pelo suporte:

| Conta      | ID da conta                            | Canais do plano | Canais ativos |
| ---------- | -------------------------------------- | --------------: | ------------: |
| AST        | `019cb3a3-7e09-717b-990d-21e30efc68d0` |               2 |             2 |
| Bella Casa | `019d4ea2-e792-75d5-a419-cd363add9c10` |               1 |             1 |
| Akila Juni | `019dd520-e25f-72ea-ab45-df2ea0dd75bd` |               1 |             1 |
| JULIANA MA | `019cdd37-82d9-7255-bd71-0f6175da84df` |               1 |             1 |
| PRIMELOJAS | `019c6786-b27d-71af-a81e-45885dd13e46` |               2 |             2 |

As consultas de produção foram somente leitura. Os horários desta análise
estão em UTC.

## Conclusão

As cinco contas estão dentro do limite e não possuem adicional de canais.
Bella Casa e Akila Juni tiveram apenas um worker em toda a sua história e seus
planos já estavam válidos antes da primeira execução do fiscalizador. Não há
evidência autoritativa de excesso nessas contas.

Não é possível atribuir retroativamente os cinco estados `stopped` ao
fiscalizador de plano. O checkpoint existente guarda apenas os horários da
última execução e o último erro; ele não registra limite, uso, candidato,
origem ou mutação. Redis, Kafka e os containers também não retêm o histórico
necessário.

Há dois escritores independentes para o mesmo estado:

1. `PlanLimitEnforcementService`, quando calcula excesso de recursos;
2. `WorkerMonitorService`, quando encontra um canal `offline`, `mismatched` ou
   `disponible` sem atividade por mais de 24 horas.

Ambos gravam `worker_status_id = stopped`. O restante da aplicação interpreta
todo `stopped` como bloqueio por plano. Assim, o estado atual não permite
distinguir bloqueio de limite, parada por inatividade ou intervenção manual.
O worker BALCÃO-WEB da PRIMELOJAS tinha atividade antiga e é compatível com o
fluxo de inatividade.

## Falhas encontradas no fiscalizador de plano

- A cota e o uso eram lidos em consultas independentes e paralelas no pool
  read-only.
- O pool alterna entre réplicas PostgreSQL. Durante a análise, o atraso de
  replay observado ficou aproximadamente entre 1,7 e 2,4 segundos.
- A consulta do plano não selecionava deterministicamente o plano corrente.
- Os candidatos eram lidos novamente da réplica depois do cálculo.
- A alteração era feita no primário sem revalidar o excesso e sem compare-and-
  set do estado observado.
- Um bloqueio de worker disparava limpeza de runtime, aumentando o impacto de
  qualquer decisão incorreta.
- Execuções bem-sucedidas não registravam a decisão; erros ainda adiavam uma
  nova tentativa por 24 horas.

Essa arquitetura permite combinar a cota de um snapshot antigo com o uso de
outro snapshot. A fragilidade é real, embora o histórico disponível não
permita afirmar que ela foi a origem dos cinco relatos.

## Dados adicionais de produção

- Existem 1.235 contas com `plan_account` e nenhuma possui mais de uma linha,
  inclusive histórica. Logo, plano duplicado não explica este incidente.
- As cinco primeiras execuções registradas no checkpoint ocorreram em
  2026-07-10; os checkpoints atuais não possuem erro.
- Quarenta e uma contas com plano vigente possuem 51 workers `stopped` mesmo
  quando a soma de ativos e parados cabe no limite contratado. Isso confirma
  que `stopped` não representa exclusivamente excesso de plano.
- Os onze hosts de workers só executam as ordens de lifecycle; o cálculo do
  limite ocorre no backend central.
- Os sete canais das cinco contas estavam em execução ao final da inspeção,
  sem OOM ou ciclo de reinício.

## Correção

O fiscalizador passa a:

1. ler plano, itens, adicionais e uso em uma única consulta no banco primário;
2. selecionar o plano corrente com ordenação determinística;
3. falhar de forma aberta para automação quando não há um plano vigente
   inequívoco;
4. revalidar o excesso antes de cada bloqueio;
5. adquirir advisory lock transacional por conta e produto, recalcular o uso
   dentro da transação e aplicar a alteração com compare-and-set;
6. executar efeitos externos somente depois do commit;
7. registrar decisões estruturadas com conta, recurso, permitido, ativo,
   disponível e excesso;
8. não avançar `last_checked_at` quando a execução falha.
9. preservar a sessão autenticada ao remover o runtime de um canal bloqueado,
   reduzindo o impacto e permitindo recuperação sem novo pareamento.

Além disso, a consulta compartilhada de quantidade passa a escolher
deterministicamente o plano corrente e somar somente itens válidos.

O monitor de inatividade passa a:

1. consultar a saúde real do runtime antes de marcar um canal como parado;
2. manter o canal inalterado quando a sessão está ativa ou quando o probe é
   inconclusivo;
3. não marcar como parado um canal cujo container já está ausente, pois nesse
   caso não há runtime capaz de confirmar ausência de sessão;
4. exigir no compare-and-set que `updated_at` e
   `last_connection_check_at` continuem exatamente iguais aos valores
   revalidados no primário;
5. registrar a origem `inactivity_monitor` nos logs estruturados quando a
   alteração realmente ocorre.

## Rollout e verificação

- Publicar primeiro os processos que executam cron e, em seguida, as APIs que
  ativam ou desbloqueiam recursos.
- Antes de habilitar a rotina, executar uma rodada de observação sem mutações e
  comparar `allowed`, `active` e `excess` no primário.
- Alertar para qualquer decisão com `planIsActive=false`, falha de
  compare-and-set ou excesso não resolvido.
- Como evolução de observabilidade, criar auditoria append-only do motivo de
  cada transição (`plan_limit`, `inactivity` ou `manual`). O patch atual inclui
  a origem nos logs estruturados e no journal de lifecycle, mas uma trilha no
  banco permitiria retenção independente da infraestrutura de logs.
