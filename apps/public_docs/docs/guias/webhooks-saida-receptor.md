---
title: Receptor de webhook em produção
description: Implemente validação HMAC, inbox idempotente, processamento assíncrono e troubleshooting.
---

# Receptor de webhook em produção

Um receptor confiável faz pouco trabalho na requisição HTTP: limita o corpo,
verifica a assinatura, valida o envelope, grava o evento em uma inbox idempotente
e responde `2xx`. Regras de CRM, chamadas externas e tarefas demoradas executam
depois, fora do timeout de 10 segundos.

```text
POST assinado → verificar bytes brutos → INSERT idempotente → 204
                                             └→ fila/worker → efeito de negócio
```

Antes de continuar, leia o [contrato de entrega](/guias/webhooks-saida) e a
[referência de payloads](/guias/webhooks-saida-payloads).

## Ordem obrigatória de validação

1. aceite somente `POST` e `Content-Type: application/json`;
2. rejeite o corpo acima do limite que você definiu, no máximo 1 MiB;
3. preserve os bytes recebidos sem parse ou normalização;
4. valide timestamp e HMAC com o segredo do endpoint;
5. faça parse do JSON e valide o envelope mínimo;
6. confira header `Event-Id`/`Event` contra `id`/`type` assinados no corpo;
7. valide `context.channel_ids` como array não vazio de IDs de canal;
8. grave `account_id + id` com restrição única;
9. confirme de forma durável a fila ou inbox e responda `204`;
10. processe o evento de forma assíncrona.

Não responda sucesso antes da persistência: se o processo cair nesse intervalo,
a Underchat considerará a entrega concluída e não haverá retry automático.

## Exemplo com Node.js e Express

O middleware `express.raw` deve ser aplicado antes de qualquer parser JSON nessa
rota. O exemplo usa o segredo completo, inclusive `uc_whsec_`, armazenado no
ambiente apenas para simplificar a demonstração.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';

const app = express();
const secret = process.env.UNDERCHAT_WEBHOOK_SECRET;

if (!secret) throw new Error('UNDERCHAT_WEBHOOK_SECRET ausente');

function oneHeader(value) {
  return Array.isArray(value) ? value[0] : String(value ?? '');
}

function validSignature(rawBody, headers) {
  const timestamp = oneHeader(headers['x-underchat-timestamp']);
  const received = oneHeader(headers['x-underchat-signature']);
  const unixSeconds = Number(timestamp);

  if (!Number.isSafeInteger(unixSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - unixSeconds) > 300) return false;

  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest('hex');
  const expected = Buffer.from(`v1=${digest}`, 'utf8');
  const supplied = Buffer.from(received, 'utf8');

  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

app.post(
  '/webhooks/underchat',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (request, response) => {
    const rawBody = request.body;
    if (
      !Buffer.isBuffer(rawBody) ||
      !validSignature(rawBody, request.headers)
    ) {
      return response.sendStatus(401);
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return response.sendStatus(400);
    }

    const eventId = oneHeader(request.headers['x-underchat-event-id']);
    const eventType = oneHeader(request.headers['x-underchat-event']);
    const channelIds = event?.context?.channel_ids;
    if (
      event?.api_version !== '1' ||
      event?.id !== eventId ||
      event?.type !== eventType ||
      typeof event?.account_id !== 'string' ||
      !Array.isArray(channelIds) ||
      channelIds.length === 0 ||
      !channelIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return response.sendStatus(400);
    }

    // Deve fazer INSERT ... ON CONFLICT DO NOTHING e commit antes de retornar.
    await webhookInbox.acceptOnce({
      accountId: event.account_id,
      eventId: event.id,
      eventType: event.type,
      occurredAt: event.occurred_at,
      channelIds,
      payload: event,
    });

    return response.sendStatus(204);
  }
);
```

`webhookInbox.acceptOnce` representa sua camada de persistência. Ela precisa ser
atômica; uma sequência `SELECT` seguida de `INSERT` permite corrida entre duas
tentativas simultâneas.

## Inbox idempotente com PostgreSQL

Um modelo mínimo separa recebimento de processamento:

```sql
CREATE TABLE underchat_webhook_inbox (
  account_id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  routing_channel_ids text[] NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  PRIMARY KEY (account_id, event_id)
);
```

Aceite a primeira cópia e considere duplicatas já recebidas:

```sql
INSERT INTO underchat_webhook_inbox (
  account_id,
  event_id,
  event_type,
  occurred_at,
  routing_channel_ids,
  payload
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (account_id, event_id) DO NOTHING;
```

Responda `2xx` também quando o conflito indicar uma duplicata válida. O efeito de
negócio deve ser idempotente por evento ou executado na mesma transação que marca
`processed_at`. Se o worker falhar, reprocese a inbox internamente; não dependa de
forçar um reenvio HTTP.

Mantenha a chave de deduplicação por pelo menos 30 dias. Se sua auditoria ou
reprocessamento tiver retenção maior, preserve a chave pelo mesmo período.

Uma transferência entre canais pode entregar o mesmo `id` a dois endpoints que
convergem para este receptor: um vinculado à origem e outro ao destino. Isso é uma
duplicata esperada para a inbox e confirma por que a chave deve ser
`account_id + event_id`, nunca `delivery_id` ou canal.

## Roteamento seguro

Use um `switch` por `type` e ignore de forma observável o que ainda não conhece:

```js
switch (event.type) {
  case 'message.received':
    await queueMessage(event);
    break;
  case 'chat.transferred':
  case 'chat.closed':
    await syncChat(event);
    break;
  case 'webhook.test':
    break;
  default:
    logger.info({ eventId: event.id, type: event.type }, 'evento ignorado');
}
```

Não falhe toda a entrega apenas porque o payload ganhou um campo adicional. Para
um tipo desconhecido, persistir, registrar e responder `2xx` evita uma sequência
de retries que não tornará o consumidor compatível.

Antes de acessar o snapshot normal da família, trate o envelope compacto usado em
casos excepcionais:

```js
if (event.data?.payload_omitted === true) {
  await queueAggregateReconciliation({
    accountId: event.account_id,
    aggregate: event.aggregate,
    eventId: event.id,
    reason: event.data.omission_reason,
  });
  return;
}
```

`payload_omitted` não indica falha HTTP e não deve provocar retry. O evento já foi
autenticado e aceito; use `aggregate` para buscar o estado atual pela API pública.

Se o mesmo serviço recebe vários endpoints Underchat, associe cada path interno a
um segredo específico. Não tente todos os segredos da conta e não selecione o
segredo usando um header não assinado.

Você pode associar esse mesmo path a um canal esperado e, depois de validar o
HMAC, conferir se ele aparece em `event.context.channel_ids`. O array faz parte do
corpo assinado e pode conter origem e destino. Não exija que ele tenha tamanho 1.

Use o HMAC como autenticação do protocolo. Uma allowlist de IP pode complementar
a defesa de borda, mas não substitui a assinatura e deve ser coordenada com a
infraestrutura da Underchat antes de bloquear tráfego; endereços de origem não
fazem parte do contrato do payload.

## Códigos de resposta do seu endpoint

| Resposta              | Quando usar                                                          | Efeito                                                           |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `200`, `202` ou `204` | Assinatura válida e evento duravelmente aceito, inclusive duplicata. | Encerra a entrega.                                               |
| `400`                 | JSON ou envelope inválido.                                           | Falha definitiva; não há retry automático.                       |
| `401` ou `403`        | Assinatura inválida/segredo incorreto.                               | Falha definitiva.                                                |
| `408`, `425`, `429`   | Receptor temporariamente incapaz de aceitar.                         | Gera retry; envie `Retry-After` em `429` quando souber a janela. |
| `410`                 | Endpoint removido de forma permanente.                               | Suspende imediatamente o endpoint Underchat ativo.               |
| `5xx`                 | Falha transitória antes da aceitação durável.                        | Gera retry com backoff.                                          |

Evite responder `5xx` depois de ter gravado o evento: isso é seguro somente se a
inbox deduplicar a próxima tentativa.

## Troubleshooting

| Sintoma                                | Causa provável                                                                                                                                            | Verificação                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Assinatura sempre inválida             | O framework reserializou JSON ou o segredo perdeu caracteres.                                                                                             | Capture o body bruto e use o segredo completo com prefixo.                                                          |
| Assinatura antiga logo após rotação    | Uma tentativa já havia concluído o preflight antes da troca.                                                                                              | Decida entre rejeição imediata ou uma drenagem máxima de 10 s; valide sempre o HMAC, não apenas o header de versão. |
| Assinatura falha só em alguns payloads | Conversão de encoding, quebra de linha ou proxy alterando o corpo.                                                                                        | Compare tamanho recebido e bytes usados no HMAC antes do parse.                                                     |
| Timestamp rejeitado                    | Relógio fora de sincronia ou fila local acima da janela.                                                                                                  | Sincronize NTP e meça a diferença sem desativar a proteção.                                                         |
| Duplicatas                             | Resposta perdida, lease recuperado ou reenvio manual.                                                                                                     | Confirme PK por `account_id + event_id` e responda `2xx` ao conflito.                                               |
| Eventos fora de ordem                  | Paralelismo ou retry atrasado.                                                                                                                            | Compare estado, use `occurred_at` como contexto e reconcilie pela API quando necessário.                            |
| `data.payload_omitted`                 | O snapshot sanitizado excederia o limite de 1 MiB.                                                                                                        | Aceite e deduplique o evento; reconcilie o recurso de `aggregate` pela API pública.                                 |
| Retries apesar de `2xx`                | Resposta excedeu 64 KiB, conexão caiu ou terminou após 10 s.                                                                                              | Responda `204` rapidamente e mova trabalho para uma fila.                                                           |
| Nenhuma entrega real                   | Endpoint inativo/suspenso, canal diferente do fato, evento não inscrito na captura, conta ou plano inelegível. Inscrições posteriores não fazem backfill. | Revise canal, status, inscrições e histórico na tela.                                                               |
| Entrega `suppressed`                   | Canal indisponível ou fora do escopo, inscrição, elegibilidade ou `config_version` congelada mudou antes do envio.                                        | Veja `last_error`; a configuração nova não assume a entrega e entregas suprimidas não voltam sozinhas.              |
| Endpoint suspenso                      | `410` ou cinco entregas reais consecutivas terminaram mortas.                                                                                             | Corrija o receptor, faça novo teste assinado e reative conscientemente.                                             |

## Testes antes de ativar

Além do teste assinado da tela, automatize estes casos no consumidor:

- corpo e assinatura válidos;
- um byte do corpo alterado;
- assinatura com outro segredo;
- timestamp ausente, futuro e expirado;
- `Event-Id` ou `Event` diferente do corpo;
- mesmo evento recebido duas vezes e simultaneamente;
- evento desconhecido com propriedades adicionais;
- envelope compacto com `data.payload_omitted: true`;
- `context.channel_ids` ausente, vazio, com valor inválido, com um canal e com
  origem mais destino;
- o mesmo `id` recebido pelos endpoints dos canais de origem e destino;
- dois eventos do mesmo agregado fora de ordem;
- fila indisponível antes e depois do commit da inbox;
- resposta vazia dentro do timeout;
- rotação com rejeição imediata do segredo antigo e com uma drenagem explícita de
  no máximo 10 segundos para tentativas já em voo;
- `X-Underchat-Webhook-Config-Version` adulterado, provando que ele não substitui
  a validação HMAC.

Em produção, monitore latência de aceitação, proporção de respostas não `2xx`,
duplicatas, idade da inbox não processada e suspensões. Nunca inclua o segredo ou o
header de assinatura em logs e traces.
