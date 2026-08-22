---
title: Chat e atendimento
description: Fluxos de conversa, mensagens, contatos, transferência, canais e automação.
---

# Chat e atendimento

O domínio `chat` cobre o ciclo operacional completo: localizar ou criar um contato,
iniciar uma conversa, consultar histórico, enviar mensagens, classificar, transferir
e encerrar o atendimento. As operações respeitam canais, setores e permissões do
usuário selecionado em `x-underchat-user-id`; a chave identifica somente a conta.

## Fluxo recomendado

1. Localize o contato por lista, telefone ou ID.
2. Crie o contato se ele ainda não existir.
3. Inicie o chat escolhendo worker/canal e, opcionalmente, setor.
4. Entre no atendimento quando a situação exigir.
5. Consulte o histórico antes de responder.
6. Envie texto, mídia, localização ou contato.
7. Adicione etiquetas ou transfira para outro destino.
8. Finalize o atendimento com status e comentário de encerramento.

## 1. Listar conversas

<span class="method method--get">GET</span> `/v1/chat`

`status` é obrigatório. Use `my_chats` para obter os chats atribuídos ao usuário
executor ou uma situação do fluxo: `ura`, `queue`, `in_chat`, `ura_output`,
`ura_schedule`, `ura_webhook`, `closed` ou `transmission`.

```bash
curl --get "$UNDERCHAT_API_URL/v1/chat" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "status=in_chat" \
  --data-urlencode "current_page=1" \
  --data-urlencode "per_page=20" \
  --data-urlencode "filter_unread_conversations=true"
```

Filtros opcionais permitem restringir por etiqueta, worker, usuário, setor, nome,
telefone, protocolo, período e conversas não lidas. Consulte [paginação e filtros](/guias/paginacao-filtros).

## 2. Localizar ou criar o contato

Use a busca mais específica disponível:

| Método e endpoint                                                               | Uso                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------- |
| <span class="method method--get">GET</span> `/v1/chat/contacts`                 | Lista contatos com filtros e paginação.      |
| <span class="method method--get">GET</span> `/v1/chat/contacts/:contact_id`     | Consulta um contato da conta.                |
| <span class="method method--get">GET</span> `/v1/chat/contacts/by-phone`        | Localiza por telefone nos canais permitidos. |
| <span class="method method--post">POST</span> `/v1/chat/contacts/batch`         | Consulta vários contatos em uma chamada.     |
| <span class="method method--post">POST</span> `/v1/chat/contacts`               | Cria um novo contato.                        |
| <span class="method method--patch">PATCH</span> `/v1/chat/contacts/:contact_id` | Atualiza os campos permitidos.               |

Também existem endpoints protegidos para email, telefone, documento, foto, validação
e canais do contato. A API sempre aplica `account_id` e o escopo de canais do
executor; um ID de outra conta não concede acesso ao registro.

## 3. Iniciar com um contato

<span class="method method--post">POST</span> `/v1/chat/start-with-contact`

```json
{
  "contact_id": "cdd1518c-95b2-47f1-a1a6-51ab628d15e8",
  "worker_id": "743ef1bb-83b7-462a-8995-a6e1151437db",
  "sector_id": "4ae578ec-1556-4ea2-8056-5e5482f3c02c"
}
```

| Campo               | Tipo   | Obrigatório | Finalidade                                                  |
| ------------------- | ------ | ----------- | ----------------------------------------------------------- |
| `contact_id`        | UUID   | Sim         | Contato que receberá o atendimento.                         |
| `worker_id`         | UUID   | Sim         | Canal/worker usado para iniciar a conversa.                 |
| `sector_id`         | UUID   | Não         | Setor inicial do chat.                                      |
| `official_template` | object | Não         | Template obrigatório para abrir algumas conversas oficiais. |

Em `official_template`, `name` e `language` são obrigatórios. `variables` contém
`key`, `component_type` (`HEADER`, `BODY`, `FOOTER` ou `BUTTON`), `index`, `value`
e, para botões, `button_index`.

## 4. Consultar mensagens

<span class="method method--get">GET</span> `/v1/chat/:chat_id`

Essa operação retorna o histórico conforme paginação e filtros do contrato. Para
buscar texto dentro de um chat, use `GET /v1/chat/:chat_id/search`; para uma busca
mais ampla de chats, use `GET /v1/chat/search`.

Antes de responder, mantenha o `chat_id`, o ID da última mensagem e a situação
atual. Esses dados reduzem respostas em chats já transferidos ou encerrados.

## 5. Enviar mensagem

<span class="method method--post">POST</span> `/v1/chat/:chat_id`

Mensagem de texto:

```json
{
  "type": "text",
  "message": "Olá, Maria. Seu pedido foi localizado."
}
```

`type` é obrigatório. Os principais valores operacionais são `text`, `image`,
`video`, `video_note`, `audio`, `document`, `location`, `contact_card` e `contacts`.
Outros valores do enum atendem ações internas do fluxo; use apenas combinações
descritas pelo OpenAPI.

Campos complementares:

| Campo                                     | Obrigatório      | Uso                                                    |
| ----------------------------------------- | ---------------- | ------------------------------------------------------ |
| `message`                                 | Conforme tipo    | Texto ou legenda.                                      |
| `message_quoted_id`                       | Não              | ID da mensagem respondida.                             |
| `link_preview`                            | Não              | Preview previamente validado por `/chat/link-preview`. |
| `images`, `documents`, `videos`, `audios` | Conforme tipo    | Arquivos em multipart.                                 |
| `location_latitude`, `location_longitude` | Para localização | Coordenadas; nome e endereço são opcionais.            |
| `contacts`                                | Para contato(s)  | ID ou lista conforme schema.                           |
| `quick_message_template_id`               | Não              | Template de mensagem rápida.                           |

Veja [uploads e mídia](/guias/uploads) para exemplos multipart.

## 6. Reagir, editar, excluir ou encaminhar

| Método e endpoint                                                                                | Ação                                             |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| <span class="method method--post">POST</span> `/v1/chat/:chat_id/message/:message_id/react`      | Adiciona ou remove reação conforme body.         |
| <span class="method method--post">POST</span> `/v1/chat/:chat_id/message/:message_id/edit`       | Edita mensagem quando o canal permite.           |
| <span class="method method--post">POST</span> `/v1/chat/:chat_id/message/:message_id/delete`     | Solicita exclusão no canal.                      |
| <span class="method method--post">POST</span> `/v1/chat/:chat_id/message/:message_id/forward`    | Encaminha para destinos permitidos.              |
| <span class="method method--post">POST</span> `/v1/chat/:chat_id/message/:message_id/transcribe` | Transcreve áudio com a permissão correspondente. |

Essas ações dependem da capacidade e da janela do canal. Uma resposta HTTP aceita
indica que a Underchat processou a solicitação; leia o payload para o resultado
específico.

## 7. Entrar, sair e transferir

Use `POST /v1/chat/:chat_id/join` para assumir e `POST /v1/chat/:chat_id/leave` para
sair quando o fluxo exigir. Consulte destinos antes de transferir:

- `GET /v1/chat/transfer-options`;
- `GET /v1/chat/transfer/users`;
- `GET /v1/chat/transfer/sectors`;
- `GET /v1/chat/transfer/sectors/:sector_id/users`.

<span class="method method--post">POST</span> `/v1/chat/:chat_id/transfer`

```json
{
  "sector_id": "4ae578ec-1556-4ea2-8056-5e5482f3c02c",
  "user_id": "41e3e61e-f816-4108-a5df-0d5ca497633e",
  "annotation": "Cliente solicitou análise financeira.",
  "keep_in_chat": false,
  "send_message_on_transfer": true
}
```

| Campo                      | Tipo             | Obrigatório | Descrição                                  |
| -------------------------- | ---------------- | ----------- | ------------------------------------------ |
| `worker_id`                | UUID             | Não         | Move para outro canal quando permitido.    |
| `user_id`                  | UUID             | Não         | Atendente de destino.                      |
| `sector_id`                | UUID             | Não         | Setor de destino.                          |
| `chatbot_id`               | UUID             | Não         | Chatbot de destino.                        |
| `annotation`               | string, até 5000 | Não         | Contexto interno da transferência.         |
| `keep_in_chat`             | boolean          | Não         | Mantém o executor no chat; padrão `false`. |
| `send_message_on_transfer` | boolean          | Não         | Controla mensagem automática configurada.  |

O body aceita destinos opcionais porque o comportamento depende da modalidade de
transferência. Envie apenas a combinação exibida por `transfer-options`.

## 8. Etiquetar e finalizar

<span class="method method--patch">PATCH</span> `/v1/chat/:chat_id/label`

Associa os IDs de templates permitidos. Para remover uma etiqueta específica do
contato, existe `DELETE /v1/chat/contacts/:contact_id/labels/:label_template_id`.

<span class="method method--patch">PATCH</span> `/v1/chat/:chat_id/status`

```json
{
  "status": "closed",
  "send_message_on_finish_attendance": true,
  "closure_comment": "Solicitação resolvida e confirmada pelo cliente."
}
```

| Campo                               | Tipo             | Obrigatório | Descrição                                    |
| ----------------------------------- | ---------------- | ----------- | -------------------------------------------- |
| `status`                            | enum             | Sim         | Nova situação do chat.                       |
| `send_message_on_finish_attendance` | boolean          | Não         | Dispara mensagem de finalização configurada. |
| `closure_comment`                   | string, até 1000 | Não         | Observação interna de encerramento.          |

## Mapa completo do domínio

### Conversas e preferências

| Método          | Caminho                                  | Finalidade                                 |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| GET             | `/chat`                                  | Listar chats.                              |
| GET             | `/chat/kanban`                           | Visão de chats para kanban.                |
| GET/POST/DELETE | `/chat/pinned` e `/chat/pinned/:chat_id` | Consultar, fixar e desafixar.              |
| POST            | `/chat/start-with-contact`               | Iniciar conversa.                          |
| POST            | `/chat/link-preview`                     | Obter preview seguro de URL pública.       |
| GET/PUT         | `/chat/notification-settings`            | Ler e alterar preferências do executor.    |
| GET             | `/chat/unread-summary`                   | Resumo de não lidas.                       |
| GET             | `/chat/:chat_id/attendants`              | Atendentes relacionados ao chat.           |
| PUT             | `/chat/user`                             | Atualizar atribuição de usuário nos chats. |

### Operações do atendimento

| Método    | Caminho                                    | Finalidade                                            |
| --------- | ------------------------------------------ | ----------------------------------------------------- |
| GET/POST  | `/chat/:chat_id`                           | Histórico e envio de mensagem.                        |
| GET       | `/chat/:chat_id/search`                    | Buscar mensagens no chat.                             |
| PATCH     | `/chat/:chat_id/status`                    | Alterar situação/finalizar.                           |
| POST      | `/chat/:chat_id/clear-summary`             | Limpar resumo gerado.                                 |
| POST      | `/chat/:chat_id/join`                      | Entrar no atendimento.                                |
| POST      | `/chat/:chat_id/leave`                     | Sair do atendimento.                                  |
| POST      | `/chat/:chat_id/transfer`                  | Transferir.                                           |
| POST      | `/chat/bulk-action`                        | Executar ação em lote conforme schema.                |
| PATCH     | `/chat/:chat_id/label`                     | Atualizar etiquetas.                                  |
| PATCH     | `/chat/:chat_id/forward-to-output-chatbot` | Controlar encaminhamento ao chatbot de saída.         |
| GET/PATCH | `/chat/:chat_id/attendance-inactivity`     | Ler e alterar inatividade.                            |
| POST      | `/chat/:chat_id/ai-generate`               | Gerar sugestão com IA, mediante permissão específica. |

### Contexto oficial e destinos

| Método | Caminho                                        | Finalidade                               |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| GET    | `/chat/worker/:worker_id/config`               | Configuração pública necessária ao chat. |
| GET    | `/chat/official-opening/context`               | Contexto para abertura oficial.          |
| GET    | `/chat/:chat_id/official-conversation/context` | Janela e contexto oficial do chat.       |
| POST   | `/chat/:chat_id/official-template`             | Enviar template oficial.                 |
| GET    | `/chat/workers`                                | Workers/canais permitidos.               |
| GET    | `/chat/users`                                  | Usuários permitidos.                     |
| GET    | `/chat/sectors`                                | Setores permitidos ao chat.              |
| GET    | `/chat/offline-channels`                       | Canais offline.                          |
| GET    | `/chat/channels-status`                        | Situação dos canais.                     |

### Contatos e recursos auxiliares

| Método | Caminho                               | Finalidade                                 |
| ------ | ------------------------------------- | ------------------------------------------ |
| GET    | `/chat/contact-channels`              | Canais disponíveis para contatos.          |
| GET    | `/chat/contacts/:contact_id/channels` | Canais de um contato.                      |
| GET    | `/chat/contacts/:contact_id/email`    | Email protegido.                           |
| GET    | `/chat/contacts/:contact_id/phone`    | Telefone protegido.                        |
| GET    | `/chat/contacts/:contact_id/document` | Documento protegido.                       |
| DELETE | `/chat/contacts/:contact_id/photo`    | Remover foto.                              |
| POST   | `/chat/contacts/:contact_id/validate` | Validar dados do contato.                  |
| GET    | `/chat/label-templates`               | Etiquetas disponíveis no contexto do chat. |
| GET    | `/chat/quick-message-templates`       | Mensagens rápidas permitidas.              |

Todos os caminhos desta seção recebem o prefixo `/v1`. Para bodies, queries,
respostas e permissões operação por operação, use a [referência interativa](/referencia-api).

## Segurança e efeitos externos

- `link-preview` aceita apenas destinos públicos e limita redirects, tamanho e
  timeout; não use a rota para acessar redes privadas;
- consultas de email, telefone e documento exigem conta e canal permitidos;
- IA e transcrição exigem permissões adicionais e podem consumir serviços externos;
- envio e edição de mensagem têm efeito no canal real; teste em um contato controlado;
- IDs retornados pela conta devem ser tratados como opacos.
