---
title: Setores
description: Organize áreas, status e usuários para rotear atendimentos.
---

# Setores

Setores representam áreas de atendimento como Comercial, Financeiro ou Suporte. A
API permite administrar os setores da conta e consultar os usuários vinculados,
mantendo as mesmas regras de acesso do painel.

## Endpoints

| Método e caminho                                                          | Finalidade                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| <span class="method method--get">GET</span> `/v1/sector`                  | Lista setores com paginação, filtros e ordenação. |
| <span class="method method--get">GET</span> `/v1/sector/:sector_id`       | Consulta um setor.                                |
| <span class="method method--post">POST</span> `/v1/sector`                | Cria um setor.                                    |
| <span class="method method--patch">PATCH</span> `/v1/sector/:sector_id`   | Altera nome, cor ou situação.                     |
| <span class="method method--delete">DELETE</span> `/v1/sector/:sector_id` | Exclui o setor.                                   |
| <span class="method method--get">GET</span> `/v1/sector/:sector_id/users` | Lista usuários vinculados.                        |

## Listar

```bash
curl --get "$UNDERCHAT_API_URL/v1/sector" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "current_page=1" \
  --data-urlencode "per_page=50" \
  --data-urlencode "name=Comercial"
```

Filtros opcionais:

| Campo           | Tipo             | Descrição                                |
| --------------- | ---------------- | ---------------------------------------- |
| `name`          | string ou `null` | Nome do setor.                           |
| `account`       | string ou `null` | Filtro de conta permitido pelo contexto. |
| `sector_status` | string ou `null` | Situação do setor.                       |
| `color`         | string ou `null` | Cor armazenada.                          |
| `sort_by`       | array            | Objetos `{ key, order }`.                |

A resposta paginada contém `results` e `pagings`. Cada item pode incluir:

| Campo           | Tipo             | Descrição                                  |
| --------------- | ---------------- | ------------------------------------------ |
| `sector_id`     | UUID             | Identificador estável.                     |
| `name`          | string           | Nome atual.                                |
| `color`         | string           | Cor exibida no painel.                     |
| `account`       | object ou `null` | Conta vinculada, quando presente na visão. |
| `sector_status` | object ou `null` | ID e nome da situação.                     |
| `created_at`    | date-time/string | Momento de criação.                        |

## Criar

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/sector" \
  --header "Content-Type: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data '{
    "name": "Pós-venda",
    "color": "#2F80ED"
  }'
```

| Campo   | Tipo   | Obrigatório | Restrição                                 |
| ------- | ------ | ----------- | ----------------------------------------- |
| `name`  | string | Sim         | Máximo de 100 caracteres.                 |
| `color` | string | Sim         | Máximo de 20 caracteres; prefira hex CSS. |

## Atualizar

<span class="method method--patch">PATCH</span> `/v1/sector/:sector_id`

```json
{
  "name": "Sucesso do cliente",
  "color": "#00A889",
  "sector_status_id": "5cc08923-ad8b-4913-90e5-5fd77dcd03db"
}
```

Os três campos são opcionais; omita o que não deve mudar.

| Campo              | Tipo            | Descrição                      |
| ------------------ | --------------- | ------------------------------ |
| `name`             | string, até 100 | Novo nome.                     |
| `color`            | string, até 20  | Nova cor.                      |
| `sector_status_id` | UUID            | Nova situação válida da conta. |

## Consultar usuários

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/sector/$SECTOR_ID/users" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID"
```

Use a resposta para montar seletores de transferência ou validar se um atendente
pode receber o chat. Não confunda essa rota com `GET /v1/chat/transfer/sectors/:sector_id/users`,
que devolve usuários elegíveis no contexto específico de transferência.

## Usar no fluxo de chat

- informe `sector_id` em `POST /v1/chat/start-with-contact` para iniciar já no setor;
- consulte `GET /v1/chat/transfer/sectors` para destinos válidos;
- informe `sector_id` em `POST /v1/chat/:chat_id/transfer`;
- filtre conversas com `filter_sector_id` em `GET /v1/chat`.

## Exclusão e sincronização

Antes de excluir um setor:

1. verifique chats em fila ou atendimento;
2. transfira fluxos e automações para outro destino;
3. remova o ID de configurações externas;
4. execute `DELETE /v1/sector/:sector_id`;
5. invalide caches locais.

Persistir o ID é correto; exibir o nome deve sempre usar o valor mais recente, pois
nome, cor e situação podem mudar.

::: warning Isolamento e permissão
View, create, edit e delete usam permissões independentes. Todas as operações
validam a conta do token e o setor acessível ao executor.
:::
