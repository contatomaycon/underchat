---
title: Etiquetas
description: Crie, liste, consulte, altere e remova modelos de etiqueta.
---

# Etiquetas

Etiquetas dão contexto visual a contatos e chats. A API pública expõe o CRUD dos
**modelos de etiqueta** da conta; a associação ao atendimento é feita pelo domínio
de chat.

## Endpoints

| Método e caminho                                                                          | Finalidade                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| <span class="method method--get">GET</span> `/v1/label-template`                          | Lista paginada com filtros e status.         |
| <span class="method method--get">GET</span> `/v1/label-template/all`                      | Lista enxuta de todos os modelos permitidos. |
| <span class="method method--post">POST</span> `/v1/label-template`                        | Cria um modelo.                              |
| <span class="method method--get">GET</span> `/v1/label-template/:label_template_id`       | Consulta um modelo.                          |
| <span class="method method--patch">PATCH</span> `/v1/label-template/:label_template_id`   | Altera campos enviados.                      |
| <span class="method method--delete">DELETE</span> `/v1/label-template/:label_template_id` | Exclui o modelo.                             |

Todas as leituras e mutações são limitadas por `account_id`. Um UUID pertencente a
outra conta é tratado como indisponível.

## Listar

```bash
curl --get "$UNDERCHAT_API_URL/v1/label-template" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "current_page=1" \
  --data-urlencode "per_page=50" \
  --data-urlencode "label=VIP"
```

Filtros opcionais:

| Campo          | Tipo             | Descrição                         |
| -------------- | ---------------- | --------------------------------- |
| `label`        | string ou `null` | Busca pelo texto da etiqueta.     |
| `label_status` | string ou `null` | Restringe pela situação.          |
| `sort_by`      | array            | Lista de `{ key, order }`.        |
| `current_page` | number           | Página, padrão `1`.               |
| `per_page`     | number           | Itens por página, de `1` a `200`. |

Use `/all` para seletores e caches pequenos. A resposta enxuta contém
`label_template_id`, `label` e `color`, sem envelope de paginação.

## Criar

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/label-template" \
  --header "Content-Type: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data '{
    "label": "Cliente VIP",
    "color": "#C63131",
    "label_status": {
      "label_status_id": "ac9c99ee-d45d-4ea0-aeaf-89bfbe622fe1"
    }
  }'
```

| Campo                          | Tipo   | Obrigatório | Descrição                                      |
| ------------------------------ | ------ | ----------- | ---------------------------------------------- |
| `label`                        | string | Sim         | Nome mostrado aos operadores.                  |
| `color`                        | string | Sim         | Cor do modelo; prefira hexadecimal CSS válido. |
| `label_status`                 | object | Sim         | Objeto da situação inicial.                    |
| `label_status.label_status_id` | UUID   | Sim         | ID de uma situação válida da conta.            |

Use IDs de situação devolvidos pelos modelos existentes/configuração da conta. Não
crie IDs no cliente.

## Atualizar

O `PATCH` é parcial: envie somente campos que devem mudar.

```bash
curl --request PATCH \
  --url "$UNDERCHAT_API_URL/v1/label-template/$LABEL_TEMPLATE_ID" \
  --header "Content-Type: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data '{
    "label": "VIP · renovação",
    "color": "#B83280"
  }'
```

`label`, `color` e `label_status` são opcionais e aceitam `null` conforme o
contrato. Não envie `null` apenas para indicar “sem alteração”; omita a propriedade.

## Associar ao chat

Criar o modelo não o aplica automaticamente. Use:

- `PATCH /v1/chat/:chat_id/label` para definir etiquetas do atendimento;
- `DELETE /v1/chat/contacts/:contact_id/labels/:label_template_id` para remover uma
  etiqueta específica do contato;
- `GET /v1/chat/label-templates` para listar modelos no contexto do chat.

## Excluir com segurança

Antes de `DELETE`, verifique se automações externas dependem do ID. O nome e a cor
podem mudar, por isso integrações devem persistir `label_template_id` como chave.
Após exclusão, remova o ID de caches, regras e mapeamentos do CRM.

::: warning Permissões independentes
Visualizar, criar, alterar e excluir etiquetas usam permissões distintas. Um token
pode listar modelos e ainda receber `403` em uma mutação.
:::
