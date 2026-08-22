---
title: Paginação e filtros
description: Parâmetros de página, ordenação e filtros das coleções públicas.
---

# Paginação e filtros

Listagens paginadas usam `current_page` e `per_page`. Os filtros pertencem a cada
recurso e são combinados pela API antes da resposta.

## Parâmetros comuns

| Campo          | Tipo   | Obrigatório | Padrão | Restrição                     |
| -------------- | ------ | ----------- | ------ | ----------------------------- |
| `current_page` | number | Não         | `1`    | Inteiro maior ou igual a `1`. |
| `per_page`     | number | Não         | `10`   | De `1` a `200`.               |

```bash
curl --get "$UNDERCHAT_API_URL/v1/sector" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "current_page=2" \
  --data-urlencode "per_page=50"
```

## Metadados da resposta

Coleções padronizadas retornam `results` e `pagings`:

```json
{
  "pagings": {
    "current_page": 1,
    "total_pages": 4,
    "per_page": 20,
    "count": 20,
    "total": 73
  },
  "results": []
}
```

| Campo          | Significado                                   |
| -------------- | --------------------------------------------- |
| `current_page` | Página devolvida.                             |
| `total_pages`  | Quantidade total de páginas no tamanho atual. |
| `per_page`     | Limite aplicado à página.                     |
| `count`        | Quantidade de itens nesta resposta.           |
| `total`        | Total de itens que atendem aos filtros.       |

Nem toda rota usa exatamente esse envelope. A listagem de chat e endpoints
auxiliares possuem respostas próprias; valide o schema na referência.

## Ordenação

Etiquetas e setores aceitam `sort_by` como uma lista de objetos:

| Campo   | Tipo                     | Obrigatório | Descrição                     |
| ------- | ------------------------ | ----------- | ----------------------------- |
| `key`   | string                   | Sim         | Campo permitido para ordenar. |
| `order` | `asc`, `desc` ou boolean | Não         | Direção da ordenação.         |

A forma de serializar arrays em query está descrita no exemplo de cada endpoint no
OpenAPI. Prefira o cliente gerado ou `URLSearchParams` e valide a URL final.

## Filtros de chat

`GET /v1/chat` exige `status` e aceita uma situação, uma lista de situações ou
`my_chats`. Valores de status disponíveis incluem `ura`, `queue`, `in_chat`,
`ura_output`, `ura_schedule`, `ura_webhook`, `closed` e `transmission`.

Filtros opcionais:

- `filter_label_template_id`, `filter_worker_id`, `filter_user_id` e
  `filter_sector_id` — UUIDs;
- `filter_name`, `filter_phone` e `filter_protocol` — texto;
- `filter_date_start` e `filter_date_end` — período;
- `filter_unread_conversations` — boolean.

```bash
curl --get "$UNDERCHAT_API_URL/v1/chat" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "status=in_chat" \
  --data-urlencode "filter_sector_id=4ae578ec-1556-4ea2-8056-5e5482f3c02c" \
  --data-urlencode "current_page=1" \
  --data-urlencode "per_page=30"
```

## Filtros de etiquetas e setores

`GET /v1/label-template` aceita `label` e `label_status`. `GET /v1/sector` aceita
`name`, `account`, `sector_status` e `color`, além da paginação e ordenação.

Não dependa da ordem padrão para sincronização. Defina uma ordenação suportada e
use IDs como chave local; nomes e cores são editáveis.
