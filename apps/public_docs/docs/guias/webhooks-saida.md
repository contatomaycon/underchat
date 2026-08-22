---
title: Webhooks de saída
description: Receba eventos da Underchat com assinatura HMAC, retentativas e histórico de entregas.
---

# Webhooks de saída

Os **webhooks de saída** enviam fatos da Underchat para sistemas sob seu controle:
CRM, data warehouse, automações, auditoria ou serviços internos. Cada endpoint tem
URL, canal, eventos inscritos, status e segredo de assinatura independentes. Cada
endpoint é vinculado obrigatoriamente a **um único canal**. Você pode manter vários
endpoints para a mesma conta, inclusive mais de um endpoint para o mesmo canal.

Este fluxo é o inverso do [webhook de entrada para CRM](/guias/webhook), que recebe
um payload externo e o transforma em contato, mensagem ou chat na Underchat.

::: info Contrato em uma frase
Cada entrega é um `POST` JSON assinado com HMAC-SHA256. A entrega é **pelo menos
uma vez**, a ordem é de melhor esforço e o consumidor deve ser idempotente.
:::

Para implementar o consumidor, consulte também a
[referência de payloads](/guias/webhooks-saida-payloads) e o
[guia do receptor em produção](/guias/webhooks-saida-receptor).

## Antes de configurar

O envio real, o teste, a ativação e o reenvio exigem que a conta e o plano sejam
elegíveis:

- a conta deve estar ativa, não excluída e acessível pelo usuário autenticado;
- o plano mais recente deve estar ativo, não excluído e com vigência futura;
- o endpoint deve estar vinculado a um canal existente da mesma conta;
- o endpoint deve ter ao menos um evento selecionável para salvar a configuração;
- cada conta pode manter até 25 endpoints de webhook de saída;
- para **ativar**, a versão atual da URL, canal e segredo deve ter concluído um
  teste assinado com resposta HTTP `2xx`.

É possível preparar endpoints enquanto estão inativos. Se a conta ou o plano
deixar de ser elegível, entregas pendentes são suprimidas em vez de contornar a
regra comercial.

Canais offline podem ser selecionados: o vínculo representa a origem dos eventos,
não o estado momentâneo da conexão. Um canal excluído deixa de ser elegível, seus
endpoints são desativados e nenhuma nova entrega é criada para eles.

## Configuração segura

1. Abra **Integração → Webhooks de saída** e selecione **Novo endpoint**.
2. Informe um nome, uma URL HTTPS pública e selecione exatamente um canal.
3. Selecione os eventos necessários.
4. Crie o endpoint. Ele sempre começa **inativo**.
5. Copie o segredo `uc_whsec_…`: o valor completo aparece somente nessa resposta.
6. Implemente a verificação HMAC no consumidor.
7. Selecione **Enviar teste assinado** e responda com HTTP `2xx`.
8. Depois que o teste for concluído, ative o endpoint.
9. Monitore **Entregas e tentativas**.

Alterar a URL, trocar o canal ou girar o segredo incrementa a versão de
configuração, desativa o endpoint e invalida a verificação anterior. Atualize o
consumidor, salve o novo segredo quando houver rotação e execute outro teste antes
de reativar.

A configuração armazena apenas um segredo atual: depois da rotação, use o novo
valor completo, incluindo o prefixo `uc_whsec_`, como chave do HMAC. Entregas da
versão anterior que ainda não iniciaram são suprimidas no preflight.

::: warning Tentativa já em voo
Rotacionar o segredo, alterar a URL ou o canal, desativar ou excluir o endpoint não
consegue recolher uma requisição que já iniciou a conexão. Por até o timeout máximo
de 10 segundos, uma tentativa em voo pode chegar com a URL, inscrição e segredo da
versão anterior. Para revogação imediata, rejeite o segredo antigo no receptor;
para uma troca sem erro, mantenha-o somente durante essa pequena drenagem e
remova-o em seguida. Tentativas que ainda não começaram revalidam a versão
congelada e são suprimidas se ela deixou de ser a atual; somente fatos novos usam a
nova configuração.
:::

::: warning Segredo de uso único
Não existe endpoint para recuperar o segredo completo. Guarde-o em um cofre de
segredos e limite o acesso. A tela e as respostas posteriores mostram somente uma
prévia. A Underchat nunca envia o segredo bruto em um header.
:::

## Requisição recebida

Cada tentativa usa `POST` com `Content-Type: application/json` e os headers:

| Header                               | Uso                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `X-Underchat-Signature`              | Assinatura no formato `v1=<hex hmac-sha256>`.                          |
| `X-Underchat-Timestamp`              | Unix timestamp, em segundos, incluído na assinatura.                   |
| `X-Underchat-Event`                  | Tipo do evento, por exemplo `message.received`.                        |
| `X-Underchat-Event-Id`               | ID estável do fato; chave recomendada para deduplicação.               |
| `X-Underchat-Delivery-Id`            | ID da entrega; muda em um reenvio manual.                              |
| `X-Underchat-Attempt`                | Número da tentativa desta entrega, iniciado em `1`.                    |
| `X-Underchat-Webhook-Config-Version` | Versão da configuração usada no preflight; apenas diagnóstico/rotação. |

Cada corpo enviado tem no máximo 1 MiB. O endpoint deve concluir a resposta em até
10 segundos. Retorne qualquer status `2xx` assim que a requisição estiver validada
e persistida; processe trabalho demorado de forma assíncrona.

Nomes de header HTTP não diferenciam maiúsculas de minúsculas. O timestamp e a
assinatura são gerados novamente em cada tentativa. O ID do evento e o ID da
entrega permanecem iguais nas retentativas automáticas; o número da tentativa
aumenta. Um reenvio manual preserva o ID do evento, mas cria outro ID de entrega e
reinicia a tentativa em `1`.

::: warning O que a assinatura cobre
O HMAC cobre o timestamp e o corpo bruto. `X-Underchat-Event-Id` e
`X-Underchat-Event` repetem valores do corpo assinado: valide se eles coincidem com
`id` e `type`. Os headers de entrega, tentativa e versão de configuração servem
para auditoria e não devem autorizar efeitos de negócio. A versão de configuração
não é coberta pelo HMAC; use-a para escolher um segredo candidato somente antes de
validar a assinatura, nunca como prova de autenticidade.
:::

## Envelope de evento

Todos os tipos usam o mesmo envelope. O conteúdo de `data` e `previous` depende do
evento, mas credenciais, payloads brutos de provedores e conteúdo binário são
removidos antes da persistência.

O recorte abaixo abrevia os snapshots de chat, mas preserva a estrutura real:
`data.chat`, `data.changes` e `previous.chat`.

```json
{
  "id": "0197e02f-15ae-7c65-9e87-4cf52c95c4fd",
  "type": "chat.transferred",
  "api_version": "1",
  "occurred_at": "2026-07-10T14:32:18.442Z",
  "account_id": "0196d90d-a41f-7357-a8dd-37bbf4e7cbbb",
  "aggregate": {
    "type": "chat",
    "id": "0197dfde-ca22-74df-b245-e29d4458bdaa"
  },
  "data": {
    "chat": {
      "chat_id": "0197dfde-ca22-74df-b245-e29d4458bdaa",
      "status": "queue",
      "sector": {
        "id": "0196e22f-0993-70f0-aa22-e42cc186d86a",
        "name": "Suporte"
      },
      "user": null
    },
    "changes": {
      "target_type": "sector",
      "target_sector_id": "0196e22f-0993-70f0-aa22-e42cc186d86a",
      "previous_status": "in_chat",
      "status": "queue"
    }
  },
  "previous": {
    "chat": {
      "chat_id": "0197dfde-ca22-74df-b245-e29d4458bdaa",
      "status": "in_chat",
      "sector": null,
      "user": {
        "id": "0196e23a-1a1d-7afd-821b-a19434201e6f",
        "name": "Ana"
      }
    }
  },
  "context": {
    "channel_ids": [
      "0196e1bf-46b9-7a5f-9dc6-c77cb1c8fe8d",
      "0196e256-4a48-76f0-98ea-407bd7f2612e"
    ],
    "source": "manager_api",
    "actor": {
      "type": "user",
      "id": "0196e23a-1a1d-7afd-821b-a19434201e6f"
    }
  }
}
```

### Formatos por agregado

Os snapshots são públicos e sanitizados. Campos secretos, hashes internos,
payloads brutos de provedores e binários nunca fazem parte do contrato. Campos
adicionais podem surgir de forma compatível dentro da mesma `api_version`.

| Família de evento                                         | `data`                                                                            | `previous`                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| `chat.*`                                                  | `chat` com o snapshot canônico e `changes` com a alteração que originou o fato    | `{ "chat": ... }` ou `null`    |
| `message.received`, `message.sent` e mudanças de mensagem | `message` e `changes`                                                             | `{ "message": ... }` ou `null` |
| `message.delivery.*`                                      | `message` e `delivery_status` (`queued`, `sent`, `delivered`, `read` ou `failed`) | `null`                         |
| `contact.*`                                               | `contact` sanitizado e, em algumas mutações, `changes`                            | `{ "contact": ... }` ou `null` |
| `webhook.test`                                            | `verification` com `webhook_id`, `config_version` e `requested_at`                | `null`                         |

O snapshot de chat inclui identificação da conta/canal, responsável, setor,
participantes, contato, status e datas, protocolos, etiquetas, roteamento público,
janela oficial e satisfação quando disponíveis. Contadores derivados de interface,
presença, digitação e hidratação técnica de IDs do provedor não originam eventos.

O snapshot de mensagem inclui IDs da mensagem e do chat, chave pública do canal,
direção/autor, conta/canal, conteúdo sanitizado, resumo de entrega, data e estado de
exclusão. Objetos de mídia incluem somente metadados públicos; bytes e payloads
brutos não são enviados.

`changes` é um contexto compacto da mutação, não um patch exaustivo nem um
schema independente. Use o snapshot como estado canônico e trate propriedades de
`changes` como aditivas. A [referência de payloads](/guias/webhooks-saida-payloads)
documenta os campos públicos de cada snapshot e traz exemplos das demais famílias.

Campos do envelope:

| Campo         | Descrição                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `id`          | ID imutável do evento; corresponde a `X-Underchat-Event-Id`.                                        |
| `type`        | Tipo selecionado no catálogo.                                                                       |
| `api_version` | Versão do envelope; atualmente `1`.                                                                 |
| `occurred_at` | Instante ISO 8601 em que o fato ocorreu.                                                            |
| `account_id`  | Conta isolada que originou o evento.                                                                |
| `aggregate`   | Recurso principal (`chat`, `message`, `contact` ou `webhook`) e ID.                                 |
| `data`        | Estado público associado ao fato.                                                                   |
| `previous`    | Estado anterior quando ele é relevante e está disponível; pode ser `null`.                          |
| `context`     | Canais de roteamento, origem interna e ator público (`user`, `customer`, `automation` ou `system`). |

`occurred_at` registra o fato de negócio e não muda em uma retentativa. Já
`X-Underchat-Timestamp` registra a tentativa HTTP atual e participa da proteção
contra replay. `context.source` é diagnóstico: por exemplo, `public_api`
identifica uma chamada aceita pela API pública e `manager_api`, uma chamada do
painel/API gerencial. Ele pode ganhar novos valores; não o use como enum fechado
nem como decisão de autorização.

### Escopo e roteamento por canal

`context.channel_ids` contém o escopo imutável usado para escolher os endpoints
daquele fato. A Underchat cria entregas somente para webhooks ativos cuja conta,
plano, inscrição e canal vinculado sejam elegíveis. O canal do endpoint precisa
estar presente nesse array tanto na captura quanto na revalidação anterior ao
envio.

As regras de composição do escopo são:

- eventos de chat usam a união dos canais do snapshot anterior e do atual;
- em uma transferência entre canais A e B, os endpoints inscritos de **A e B**
  recebem o mesmo evento `chat.transferred`, com o mesmo `id`;
- mensagens e status de entrega usam o canal da mensagem;
- `contact.created` usa os canais atuais e o canal explícito de origem quando ele
  é conhecido;
- `contact.updated` usa a união dos canais anteriores e atuais;
- `contact.deleted` usa os canais anteriores;
- um contato sem canal atual, anterior ou de origem conhecida não gera entrega;
- `webhook.test` usa o canal configurado no próprio endpoint.

O array pode conter mais de um ID em eventos que cruzam o limite de um canal. Se
o mesmo consumidor estiver configurado em endpoints para ambos os canais, ele pode
receber duas entregas do mesmo evento; deduplicar por `account_id + id` evita
executar o efeito de negócio duas vezes.

Trocar o canal não faz backfill nem redireciona entregas históricas. A alteração
desativa o endpoint e exige outro teste assinado. Um reenvio histórico é bloqueado
quando o canal atual do endpoint não pertence ao escopo congelado do evento. Se o
canal for excluído, entregas que ainda não iniciaram são suprimidas; uma tentativa
HTTP já em voo continua sujeita à janela descrita em **Tentativa já em voo**.

### Payload excepcionalmente grande

Se o snapshot sanitizado ultrapassar 1 MiB, o evento não é descartado. A Underchat
preserva `id`, `type`, `occurred_at`, `account_id`, `aggregate` e `context`, envia
`previous: null` e substitui `data` por este marcador compacto:

```json
{
  "payload_omitted": true,
  "omission_reason": "payload_too_large"
}
```

Esse marcador informa que o fato ocorreu, mas o snapshot não cabe no contrato de
transporte. Persista e deduplique o evento normalmente; antes de acessar
`data.chat`, `data.message` ou `data.contact`, verifique `data.payload_omitted`.
Quando precisar do estado completo, reconcilie o recurso indicado por `aggregate`
pela API pública. A [referência de payloads](/guias/webhooks-saida-payloads) mostra
um envelope compacto completo.

## Verificar a assinatura HMAC

Assine os **bytes exatos** recebidos, antes de fazer parse do JSON. A mensagem do
HMAC é:

```text
<X-Underchat-Timestamp>.<raw request body>
```

O algoritmo é HMAC-SHA256 e o resultado esperado é `v1=` seguido do digest
hexadecimal. Este exemplo em Node.js recebe o `Buffer` original:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyUnderchatWebhook({ rawBody, headers, secret }) {
  const timestamp = String(headers['x-underchat-timestamp'] ?? '');
  const received = String(headers['x-underchat-signature'] ?? '');
  const unixSeconds = Number(timestamp);

  if (!Number.isSafeInteger(unixSeconds)) return false;

  // Limite a janela para reduzir replay; cinco minutos é uma escolha comum.
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
```

Checklist de verificação:

1. capture o corpo bruto sem reserializar JSON;
2. rejeite timestamps ausentes, inválidos ou fora da sua janela de replay;
3. calcule o HMAC com o segredo do endpoint correto;
4. compare em tempo constante;
5. confira `X-Underchat-Event-Id`/`Event` contra `id`/`type` do corpo;
6. valide `Content-Type`, tamanho e o schema mínimo do envelope;
7. registre o ID do evento de forma atômica antes do efeito de negócio;
8. responda `2xx` somente depois que o evento estiver duravelmente aceito.

Não registre o segredo, o header de assinatura nem o corpo completo sem uma política
de retenção e mascaramento.

## Entrega, retentativas e respostas HTTP

Uma resposta `2xx` encerra a entrega com sucesso. A Underchat tenta novamente em
falhas de rede, timeout, HTTP `408`, `425`, `429` e `5xx`. O header `Retry-After` é
considerado quando enviado em segundos ou data HTTP e é limitado a 24 horas.
Redirects não são seguidos.

São feitas no máximo **7 tentativas**. Sem `Retry-After`, o atraso é sorteado com
jitter entre zero e o teto da etapa:

| Após a tentativa | Próxima janela máxima |
| ---------------: | --------------------: |
|                1 |              1 minuto |
|                2 |             5 minutos |
|                3 |            30 minutos |
|                4 |               2 horas |
|                5 |               8 horas |
|                6 |              24 horas |

Um `Retry-After` válido pode elevar o atraso acima do teto de jitter da etapa,
sempre limitado a 24 horas. A resposta do consumidor é armazenada somente para
diagnóstico e tem limite de 64 KiB; prefira `204 No Content`. Uma resposta acima
desse limite é tratada como falha transitória e pode provocar nova tentativa.

Outros status `3xx` e `4xx` são falhas definitivas. HTTP `410 Gone` suspende o
endpoint imediatamente. Cinco entregas reais consecutivas que terminem em falha
definitiva também suspendem o endpoint; testes e reenvios manuais não aumentam esse
contador. Uma entrega real bem-sucedida zera o contador.

## Pelo menos uma vez, deduplicação e ordem

A entrega usa leases e oferece semântica **at-least-once**: o mesmo evento pode
chegar mais de uma vez, inclusive depois de o consumidor tê-lo processado e a
resposta ter se perdido.

Essa garantia começa depois que o fato entra com sucesso no journal de webhooks.
Uma falha excepcional antes dessa captura inicial não desfaz a operação principal
e o evento correspondente pode não ser entregue. Depois que o fato foi capturado e
a mutação de negócio foi aplicada, uma falha tardia na finalização ou criação das
entregas permanece registrada e é recuperada de forma assíncrona; ela não transforma
uma operação de chat ou contato já concluída em erro nem perde o fato capturado.

Portanto, não trate o webhook como um log matematicamente completo: quando uma
eventual lacuna anterior à captura não for aceitável, reconcilie periodicamente o
estado pela API pública. O envelope compacto também exige essa reconciliação para
recuperar o snapshot omitido.

- use `id` ou `X-Underchat-Event-Id` como chave idempotente do efeito de negócio;
- grave a chave e o resultado na mesma transação sempre que possível;
- use `X-Underchat-Delivery-Id` e `X-Underchat-Attempt` apenas para auditoria;
- mantenha a deduplicação por pelo menos a janela operacional de 30 dias;
- não deduplique somente por tipo, aggregate ou timestamp.

A ordem é de **melhor esforço**. Endpoints e eventos podem ser processados em
paralelo; uma retentativa atrasada pode chegar depois de um fato mais recente.
Projete atualizações idempotentes, use `occurred_at` como contexto e consulte o
estado atual pela API quando a decisão não puder tolerar reordenação.

## Filtros e inscrições

Cada endpoint recebe somente os tipos exatos salvos em `event_types`. Não existem
wildcards nem filtros arbitrários de payload. Para reduzir acoplamento e tráfego:

- crie endpoints separados por consumidor ou domínio;
- vincule cada endpoint ao único canal que ele deve observar;
- selecione o menor conjunto de eventos possível;
- trate eventos desconhecidos como compatíveis e ignore campos adicionais;
- não use eventos fallback junto com inferências locais do mesmo fato.

`webhook.test` é reservado, não selecionável e enviado diretamente ao endpoint
durante a verificação, usando o canal configurado como escopo. Ele nunca representa
atividade real de cliente.

No momento em que um fato entra no journal, a Underchat congela a lista de
destinatários e a `config_version` de cada endpoint elegível. Alterar inscrições,
criar outro endpoint ou ativar um endpoint depois disso não adiciona destinatários
ao evento já capturado e não gera backfill. As alterações passam a valer na
captura de fatos novos.

Antes de cada tentativa, o sistema ainda revalida endpoint, inscrição, versão de
configuração, canal, conta e plano. Por isso, desativar uma inscrição ou endpoint,
excluí-lo, suspendê-lo ou trocar URL/canal/segredo pode suprimir uma entrega
pendente que já constava no journal; a configuração nova nunca assume essa entrega
antiga. No histórico, `channel_unavailable` indica canal excluído e
`channel_scope_mismatch`, canal atual fora do escopo imutável do evento. Reativar
a configuração também não recria entregas que já foram suprimidas.

## Catálogo de eventos

O catálogo v1 possui **37 tipos**: 36 eventos selecionáveis e o evento de controle
não selecionável `webhook.test`.

### Chat: ciclo de vida

| Evento                     | Quando é emitido                                                   |
| -------------------------- | ------------------------------------------------------------------ |
| `chat.created`             | Um chat é criado com seu estado inicial.                           |
| `chat.queued`              | Um chat entra na fila de atendimento humano.                       |
| `chat.attended`            | O atendente principal aceita o chat.                               |
| `chat.joined`              | Um atendente adicional entra no chat ativo.                        |
| `chat.left`                | Um atendente adicional sai do chat ativo.                          |
| `chat.transferred`         | O chat é transferido para atendente, setor, canal ou automação.    |
| `chat.closed`              | O chat chega ao estado finalizado.                                 |
| `chat.reopened`            | Um chat finalizado é reaberto.                                     |
| `chat.automation.started`  | O chat entra em um fluxo automatizado.                             |
| `chat.automation.finished` | O chat sai do fluxo automatizado.                                  |
| `chat.status.changed`      | **Fallback:** mudança durável sem evento de ciclo mais específico. |

`chat.status.changed` não é emitido ao lado de um evento específico para a mesma
transição de status.

### Chat: alterações

| Evento                      | Quando é emitido                                                          |
| --------------------------- | ------------------------------------------------------------------------- |
| `chat.assignment.changed`   | Muda atendente, setor, canal ou participante fora de transferência.       |
| `chat.labels.changed`       | Etiquetas são adicionadas, alteradas ou removidas.                        |
| `chat.protocol.updated`     | Um protocolo público de atendimento, automação ou transferência é gerado. |
| `chat.satisfaction.updated` | A resposta de satisfação muda.                                            |
| `chat.updated`              | Outro metadado público do chat muda.                                      |

### Mensagens

| Evento                          | Quando é emitido                                                 |
| ------------------------------- | ---------------------------------------------------------------- |
| `message.received`              | Uma mensagem do cliente é persistida.                            |
| `message.sent`                  | Uma mensagem de saída é persistida para envio.                   |
| `message.annotation.created`    | Uma anotação interna é persistida na linha do tempo.             |
| `message.system.created`        | Uma mensagem durável do sistema é persistida na linha do tempo.  |
| `message.edited`                | O conteúdo persistido é editado.                                 |
| `message.deleted`               | A mensagem é excluída ou revogada.                               |
| `message.reaction.updated`      | Uma reação é adicionada, alterada ou removida.                   |
| `message.pin.updated`           | O estado de fixação muda.                                        |
| `message.disappearing.updated`  | A configuração de mensagem temporária muda.                      |
| `message.media.updated`         | Metadados públicos duráveis da mídia ficam disponíveis ou mudam. |
| `message.transcription.updated` | Uma transcrição de áudio fica disponível ou muda.                |
| `message.updated`               | **Fallback:** outro campo público durável muda.                  |

`message.updated` é o fallback para mutações sem um evento mais específico.

Anotações podem conter informações internas e são enviadas somente quando
`message.annotation.created` foi selecionado explicitamente. Aplique ao receptor a
mesma política de acesso e retenção usada no painel de atendimento.

### Status de entrega da mensagem

| Evento                       | Quando é emitido                                 |
| ---------------------------- | ------------------------------------------------ |
| `message.delivery.queued`    | A mensagem de saída entra na fila do provedor.   |
| `message.delivery.sent`      | O canal aceita a mensagem de saída.              |
| `message.delivery.delivered` | A mensagem chega ao dispositivo do destinatário. |
| `message.delivery.read`      | O destinatário lê a mensagem.                    |
| `message.delivery.failed`    | A entrega chega a uma falha durável.             |

Esses cinco eventos existem somente para mensagens de **saída**. Mensagens
recebidas usam `message.received` e não originam `message.delivery.*`. Os marcos
podem chegar próximos ou fora de ordem; `message.sent` (persistência para envio) e
`message.delivery.queued` (entrada na fila do provedor) são fatos distintos.

### Contatos e controle

| Evento            | Selecionável | Quando é emitido                                           |
| ----------------- | :----------: | ---------------------------------------------------------- |
| `contact.created` |     Sim      | Um contato usado por chats é criado.                       |
| `contact.updated` |     Sim      | Dados públicos, validação ou associações do contato mudam. |
| `contact.deleted` |     Sim      | O contato é excluído.                                      |
| `webhook.test`    |     Não      | A tela de integração solicita uma verificação assinada.    |

Campos sensíveis de contato são enviados somente em formato mascarado. Além das
mutações diretas do cadastro e da validação, criar, renomear, alterar membros ou
excluir um grupo faz fan-out de `contact.updated` para cada contato cujo snapshot
público de `contact_groups` mudou. O receptor pode identificar essa origem em
`data.changes.contact_group_id` e `data.changes.contact_group_operation`
(`created`, `updated` ou `deleted`). Alterar somente a descrição do grupo não
altera o snapshot do contato e, portanto, não gera esse fan-out. Edições globais
nos metadados de uma etiqueta continuam sem gerar um evento para cada associado.

## Histórico e reenvio manual

Por padrão, a tela mantém por **30 dias** as entregas e tentativas, junto do evento
e payload associados. Ela mostra o payload público sanitizado, status HTTP,
resposta limitada, duração e erro de cada tentativa. Segredos, assinaturas e
headers sensíveis não são retornados no histórico. O reenvio manual é a exceção de
retenção descrita abaixo.

O reenvio manual:

- só está disponível para entrega real em estado `dead` ou `suppressed`;
- exige endpoint ativo, conta/plano elegíveis, evento ainda selecionado, canal
  atual disponível e presente em `context.channel_ids`, além de estar dentro dos
  30 dias;
- cria um novo `X-Underchat-Delivery-Id` e preserva o mesmo ID de evento;
- renova atomicamente a retenção do evento, do payload e da nova entrega por 30
  dias contados da solicitação; por consequência, todo o histórico já associado
  ao mesmo evento permanece armazenado até o novo prazo;
- não altera nem apaga a entrega original.

O reenvio é uma ação explícita que prolonga o armazenamento do payload, das
entregas e das tentativas ligadas ao evento. O campo de expiração da entrega
original não é reescrito, mas o registro permanece associado ao evento e, por
isso, continua retido até o prazo renovado do evento. Reenvios sucessivos
elegíveis podem renovar esse prazo novamente; considere essa extensão na política
de privacidade e retenção da sua organização.

Como o ID do evento é preservado, um consumidor idempotente normalmente ignorará
o reenvio já processado. Para uma reexecução intencional, remova ou libere a chave
de deduplicação no consumidor antes de solicitar o reenvio.

## Política de URL e rede

Em produção, o destino deve usar HTTPS na porta `443`, sem credenciais ou fragmento
na URL. Endereços privados, loopback, link-local, redes reservadas e resultados DNS
inseguros são bloqueados. O endereço resolvido é validado e fixado para a conexão,
reduzindo risco de SSRF e DNS rebinding. Redirects ficam visíveis como resposta e
não são seguidos.

Para uma operação saudável:

- exponha um endpoint dedicado e mínimo;
- mantenha TLS e DNS estáveis;
- aceite apenas `POST` e limite o tamanho antes do parse;
- verifique assinatura e timestamp antes de confiar no JSON;
- responda rapidamente e processe em fila;
- monitore falhas definitivas e endpoints suspensos;
- gire o segredo se houver suspeita de exposição.

Veja sintomas, causas e testes de caos no
[guia do receptor em produção](/guias/webhooks-saida-receptor).
