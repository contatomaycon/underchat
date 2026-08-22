---
title: Payloads dos webhooks de saída
description: Contrato do envelope v1, snapshots de chat, mensagem e contato e exemplos de eventos.
---

# Payloads dos webhooks de saída

Esta página detalha o corpo JSON recebido nos
[webhooks de saída](/guias/webhooks-saida). Todos os eventos usam o mesmo envelope
`api_version: "1"`; o tipo define o conteúdo de `data` e `previous`.

::: info Regra de consumo
Use `type` para rotear, `id` para deduplicar e o snapshot em `data` como estado
canônico do fato. `changes`, `previous` e `context` ajudam no diagnóstico, mas podem
ser parciais ou `null`.
:::

::: warning Dados pessoais e conteúdo de conversa
Snapshots podem conter telefone, email, documento, mensagem e metadados de mídia
da própria conta. Aplique controle de acesso, criptografia, retenção mínima e
mascaramento de logs no consumidor. A assinatura garante autenticidade em
trânsito; ela não substitui a proteção dos dados depois da recepção.
:::

## Envelope v1

```ts
type UnderchatWebhookEnvelopeV1 = {
  id: string;
  type: string;
  api_version: '1';
  occurred_at: string;
  account_id: string;
  aggregate: {
    type: 'chat' | 'message' | 'contact' | 'webhook';
    id: string;
  };
  data: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  context: {
    channel_ids: string[];
    source: string;
    actor: {
      type: 'user' | 'customer' | 'automation' | 'system';
      id?: string | null;
    } | null;
  };
};
```

| Campo         | Semântica                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`          | ID imutável do fato. É igual a `X-Underchat-Event-Id` e permanece igual em retries e reenvios.                           |
| `type`        | Nome exato do evento selecionado. É igual a `X-Underchat-Event`.                                                         |
| `api_version` | Versão maior do envelope, representada como string.                                                                      |
| `occurred_at` | Data ISO 8601 do fato; não é o horário da tentativa HTTP.                                                                |
| `account_id`  | Conta que originou o fato. Use também como chave de isolamento no consumidor.                                            |
| `aggregate`   | Recurso principal afetado e seu ID.                                                                                      |
| `data`        | Snapshot posterior à mutação e contexto específico do tipo.                                                              |
| `previous`    | Snapshot anterior quando capturado; pode ser `null` inclusive em atualizações.                                           |
| `context`     | Escopo imutável em `channel_ids`, origem diagnóstica e ator conhecido. Exemplos de origem: `public_api` e `manager_api`. |

IDs devem ser tratados como strings opacas. As amostras usam UUIDs, mas o
consumidor não deve extrair data, ordenação ou significado do formato.

### `context.channel_ids` e roteamento

`context.channel_ids` sempre contém um ou mais IDs de canal e faz parte do corpo
assinado. Ele representa o escopo congelado do fato, não apenas o canal exibido no
snapshot posterior. Somente endpoints ativos vinculados a um desses canais podem
receber o evento.

- chat: união dos canais anterior e atual;
- mensagem e `message.delivery.*`: canal da mensagem;
- contato criado: canais atuais mais a origem explícita conhecida;
- contato atualizado: união dos canais anteriores e atuais;
- contato excluído: canais anteriores;
- `webhook.test`: canal do endpoint testado.

Um contato sem canal atual, anterior ou de origem conhecida não gera uma entrega.
Em uma transferência entre canais, o array contém origem e destino; endpoints de
ambos podem receber o mesmo `id`. Consumidores que convergem vários endpoints na
mesma inbox devem deduplicar por `account_id + id`.

## Formatos por família

| Família                                 | `data`                                          | `previous`              |
| --------------------------------------- | ----------------------------------------------- | ----------------------- |
| `chat.*`                                | `{ chat, changes }`                             | `{ chat }` ou `null`    |
| `message.*` exceto `message.delivery.*` | `{ message, changes }`                          | `{ message }` ou `null` |
| `message.delivery.*`                    | `{ message, delivery_status }`                  | `null`                  |
| `contact.*`                             | `{ contact }` e, em algumas mutações, `changes` | `{ contact }` ou `null` |
| `webhook.test`                          | `{ verification }`                              | `null`                  |

`changes` não é um JSON Patch e não deve ser reaplicado mecanicamente. Ele
explica a operação com campos como direção, destino, status ou IDs alterados. O
snapshot pode conter mudanças adicionais que não aparecem nesse objeto.

### Exceção compacta acima de 1 MiB

O corpo HTTP nunca ultrapassa 1 MiB. Quando um snapshot sanitizado excederia esse
limite, a Underchat mantém a identidade e o roteamento do fato, define
`previous: null` e envia `data` somente com o marcador de omissão:

```json
{
  "id": "0197e406-047a-7a4f-8dc6-6d6521c23e93",
  "type": "message.media.updated",
  "api_version": "1",
  "occurred_at": "2026-07-10T15:30:11.504Z",
  "account_id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
  "aggregate": {
    "type": "message",
    "id": "0197e2c8-1680-7a9e-94af-dbb92d9fc315"
  },
  "data": {
    "payload_omitted": true,
    "omission_reason": "payload_too_large"
  },
  "previous": null,
  "context": {
    "channel_ids": ["0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d"],
    "source": "message_update",
    "actor": {
      "type": "system"
    }
  }
}
```

Esse é um evento válido e assinado, não uma falha de entrega. Grave e deduplique o
`id`, trate o fato conforme `type` e consulte o recurso indicado por `aggregate`
pela API pública se precisar do estado completo. Verifique
`data.payload_omitted === true` antes de validar o formato normal da família. O
único valor atual de `omission_reason` é `payload_too_large`; aceite valores novos
de forma compatível.

## Snapshot de chat

`data.chat` e `previous.chat` usam os campos públicos abaixo. Campos condicionais
podem ser `null`, arrays vazios ou estar ausentes no objeto interno correspondente.

| Campo                                                 | Tipo e uso                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `chat_id`                                             | ID do chat.                                                                                             |
| `account`                                             | `{ id, name }` da conta.                                                                                |
| `worker`                                              | Canal da conversa: `{ id, name, type_id?, is_official? }`.                                              |
| `sector`                                              | Setor atual `{ id, name, color? }` ou `null`.                                                           |
| `user`                                                | Atendente principal `{ id, name, photo?, entered_at? }` ou `null`.                                      |
| `secondary_users`                                     | Atendentes adicionais no chat.                                                                          |
| `contact`                                             | Resumo do contato `{ id, name, phone, phone_ddi?, photo?, responsible_attendant?, ignore? }` ou `null`. |
| `photo`, `name`, `phone`                              | Identificação exibida no atendimento.                                                                   |
| `status`                                              | `ura`, `queue`, `in_chat`, `ura_output`, `ura_schedule`, `ura_webhook`, `closed` ou `transmission`.     |
| `date`, `started_at`, `closed_at`                     | Datas do ciclo quando disponíveis.                                                                      |
| `protocol_ura`, `protocol_start`, `protocol_transfer` | Listas de protocolos públicos.                                                                          |
| `labels`                                              | Etiquetas `{ label_template_id, label, color }`.                                                        |
| `forward_to_output_chatbot`                           | Sinaliza encaminhamento ao chatbot de saída.                                                            |
| `official_window`                                     | Estado público da janela oficial quando aplicável.                                                      |
| `satisfaction_response`                               | Pergunta, opções, resposta e analista quando houver pesquisa.                                           |

Contadores de interface, presença, digitação, metadados internos de automação e
marcadores técnicos de persistência não fazem parte do snapshot.

## Snapshot de mensagem

| Campo                | Tipo e uso                                                               |
| -------------------- | ------------------------------------------------------------------------ |
| `message_id`         | ID da mensagem; também é o `aggregate.id`.                               |
| `chat_id`            | Chat ao qual a mensagem pertence.                                        |
| `message_key`        | Chave pública e opaca do canal ou `null`; não a use como chave primária. |
| `type_user`          | `operator`, `client`, `bot` ou `system`.                                 |
| `account`            | `{ id, name }` da conta.                                                 |
| `worker`             | `{ id, name, type_id?, is_official? }` do canal.                         |
| `user`               | Autor interno `{ id, name, photo? }` ou `null`.                          |
| `phone`, `phone_ddi` | Destinatário/remetente no contexto do canal.                             |
| `content`            | Conteúdo sanitizado ou `null`; a estrutura depende de `content.type`.    |
| `summary`            | Flags `is_sent`, `is_delivered`, `is_seen` e `is_sent_to_internal`.      |
| `date`               | Data persistida da mensagem.                                             |
| `deleted`            | Indica exclusão ou revogação persistida.                                 |
| `has_quoted`         | Indica associação a mensagem citada.                                     |
| `sent_from_platform` | Origem pela plataforma quando conhecida, ou `null`.                      |

Valores atuais de `content.type` incluem `text`, `location`, `contact_card`,
`contacts`, `image`, `video`, `video_note`, `audio`, `sticker`, `document`,
`official_template`, `official_interactive`, `view_once`, `annotation` e tipos de
controle. Trate valores desconhecidos de forma compatível.

Objetos de mídia contêm metadados públicos, nunca os bytes do arquivo nem
thumbnails embutidos em base64. URLs e
metadados podem expirar ou mudar conforme o provedor; copie a informação necessária
seguindo sua política de privacidade, sem usar o webhook como storage permanente.

`message.annotation.created` transporta uma nota interna de atendimento e
`message.system.created` transporta uma entrada durável de sistema. Assine esses
tipos somente quando o consumidor tiver a mesma autorização e retenção do painel.

### Exemplo de mensagem recebida

```json
{
  "id": "0197e2c9-29d4-7ec3-b68e-f2d613ff4b36",
  "type": "message.received",
  "api_version": "1",
  "occurred_at": "2026-07-10T15:10:04.126Z",
  "account_id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
  "aggregate": {
    "type": "message",
    "id": "0197e2c8-1680-7a9e-94af-dbb92d9fc315"
  },
  "data": {
    "message": {
      "message_id": "0197e2c8-1680-7a9e-94af-dbb92d9fc315",
      "chat_id": "0197dfde-ca22-74df-b245-e29d4458bdaa",
      "message_key": {
        "from_me": false,
        "id": "PROVIDER_MESSAGE_ID",
        "is_view_once": false
      },
      "type_user": "client",
      "account": {
        "id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
        "name": "Conta exemplo"
      },
      "worker": {
        "id": "0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d",
        "name": "WhatsApp Suporte",
        "is_official": true
      },
      "user": null,
      "phone": "5511999999999",
      "phone_ddi": "55",
      "content": {
        "type": "text",
        "message": "Preciso de ajuda com meu pedido"
      },
      "summary": {
        "is_sent": true,
        "is_delivered": true,
        "is_seen": false,
        "is_sent_to_internal": true
      },
      "date": "2026-07-10T15:10:03.908Z",
      "deleted": false,
      "has_quoted": false,
      "sent_from_platform": false
    },
    "changes": {
      "direction": "inbound"
    }
  },
  "previous": null,
  "context": {
    "channel_ids": ["0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d"],
    "source": "whatsapp_official",
    "actor": {
      "type": "customer"
    }
  }
}
```

Os valores são ilustrativos. Campos presentes dependem do canal e do tipo da
mensagem.

## Status de entrega

Eventos `message.delivery.*` existem somente para mensagens de **saída** e usam um
snapshot atualizado de `message` com `delivery_status`: `queued`, `sent`,
`delivered`, `read` ou `failed`. Uma mensagem recebida usa `message.received` e não
gera eventos desta família.

```json
{
  "id": "0197e2ed-e21f-7044-aa39-99e4ae5bd02f",
  "type": "message.delivery.read",
  "api_version": "1",
  "occurred_at": "2026-07-10T15:18:22.000Z",
  "account_id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
  "aggregate": {
    "type": "message",
    "id": "0197e2c8-1680-7a9e-94af-dbb92d9fc315"
  },
  "data": {
    "message": {
      "message_id": "0197e2c8-1680-7a9e-94af-dbb92d9fc315",
      "chat_id": "0197dfde-ca22-74df-b245-e29d4458bdaa",
      "type_user": "operator",
      "summary": {
        "is_sent": true,
        "is_delivered": true,
        "is_seen": true,
        "is_sent_to_internal": true
      }
    },
    "delivery_status": "read"
  },
  "previous": null,
  "context": {
    "channel_ids": ["0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d"],
    "source": "provider_ack",
    "actor": {
      "type": "system"
    }
  }
}
```

`queued` informa que a mensagem persistida entrou na fila do provedor; é diferente
de `message.sent`, que registra sua persistência para envio. Os demais estados
representam marcos de entrega. Um ACK de leitura pode fazer com que marcos anteriores
sejam confirmados muito próximos no tempo. Não dependa da ordem de chegada; aplique
somente avanços conhecidos e deduplique cada `id`.

## Snapshot de contato

| Campo                                               | Tipo e uso                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `contact_id`                                        | ID do contato.                                                                 |
| `name`, `last_name`, `nickname`                     | Identificação do contato.                                                      |
| `email`, `phone_ddi`, `phone`                       | Canais de contato quando disponíveis. `email` e `phone` são sempre mascarados. |
| `photo`, `birthday`, `notes`                        | Dados opcionais do cadastro.                                                   |
| `document`, `contact_document_type_id`              | Documento mascarado e seu tipo quando disponíveis no snapshot.                 |
| `responsible_attendant`, `responsible_attendant_id` | Responsável atual.                                                             |
| `label_templates`                                   | Etiquetas associadas.                                                          |
| `channel_ids`                                       | IDs dos canais vinculados.                                                     |
| `contact_groups`                                    | Grupos associados.                                                             |
| `ignore`                                            | Configuração pública de tratamento/ignorar.                                    |
| `is_valided`                                        | Indica se o telefone do contato foi validado pelo canal.                       |
| `created_at`, `updated_at`, `deleted_at`            | Datas conhecidas do ciclo.                                                     |

Os campos relacionais `label_templates`, `channel_ids` e `contact_groups` só
aparecem quando foram carregados no snapshot canônico do evento. A ausência de
um desses campos não significa uma lista vazia. `contact.updated` cobre mutações
diretas do contato, validação e mudanças de associação. Operações globais de
grupo também geram um evento por contato efetivamente afetado: criação com
membros, renomeação, inclusão/remoção de membros e exclusão. Nesses eventos,
`data.changes.contact_group_id` identifica o grupo e
`data.changes.contact_group_operation` vale `created`, `updated` ou `deleted`.
Alterar apenas a descrição do grupo, ou editar globalmente nome/cor de uma
etiqueta, não muda o snapshot público do contato e não gera fan-out.

Em `contact.deleted`, `data.contact.deleted_at` identifica a exclusão e
`previous.contact` preserva o snapshot anterior quando disponível.

## Evento de teste

`webhook.test` não é selecionável e valida a versão atual da URL, do canal e do
segredo. Ele usa o mesmo transporte, assinatura e política de resposta dos
eventos reais.

```json
{
  "id": "0197e343-ce6e-7581-a954-75b12620b7bb",
  "type": "webhook.test",
  "api_version": "1",
  "occurred_at": "2026-07-10T15:24:41.210Z",
  "account_id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
  "aggregate": {
    "type": "webhook",
    "id": "0197dff4-44e2-72f0-a98b-7ab6b9fb2013"
  },
  "data": {
    "verification": {
      "webhook_id": "0197dff4-44e2-72f0-a98b-7ab6b9fb2013",
      "config_version": 3,
      "requested_at": "2026-07-10T15:24:41.210Z"
    }
  },
  "previous": null,
  "context": {
    "channel_ids": ["0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d"],
    "source": "integration_test",
    "actor": {
      "type": "user",
      "id": "0196e23a-1a1d-7afd-821b-a19434201e6f"
    }
  }
}
```

Trate o teste como evento de controle: verifique a assinatura, persista-o se sua
arquitetura exigir e responda `2xx`, mas não execute automações de chat.

## Compatibilidade

Dentro da versão `1`, consumidores devem aceitar:

- novas propriedades em qualquer objeto;
- novos valores em campos diagnósticos, como `context.source`;
- propriedades opcionais ausentes ou `null`;
- `data.payload_omitted: true` no lugar do snapshot normal da família;
- um tipo de conteúdo de mensagem ainda desconhecido;
- eventos fora de ordem e eventos repetidos.

Não confunda a `api_version` do envelope com `config_version` do endpoint. A
primeira versiona o contrato do payload; a segunda identifica a configuração
atual de URL, canal e segredo usada na verificação. Para eventos reais, os
destinatários e a `config_version` correspondente são congelados quando o fato
entra no journal.
Uma alteração posterior de endpoint, canal ou inscrição não faz backfill nem migra
uma entrega pendente para outra versão; o preflight pode suprimi-la se a
configuração capturada deixou de ser elegível. O reenvio histórico também é
bloqueado quando o canal atual do endpoint não pertence a `context.channel_ids`.

Próximo passo: [implemente e teste o receptor](/guias/webhooks-saida-receptor).
