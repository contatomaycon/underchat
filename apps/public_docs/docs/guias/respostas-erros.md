---
title: Respostas e erros
description: Status HTTP, payloads de erro e estratégias seguras de recuperação.
---

# Respostas e erros

A API usa o status HTTP para indicar o resultado e JSON para respostas estruturadas.
Algumas operações de exclusão ou ação podem responder sem body; confirme a resposta
de cada endpoint na [referência da API](/referencia-api).

## Status mais frequentes

| Status                       | Significado                                              | Comportamento recomendado                        |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| `200 OK`                     | Leitura ou alteração concluída.                          | Consuma o schema de resposta.                    |
| `201 Created`                | Recurso criado.                                          | Persista o identificador retornado.              |
| `204 No Content`             | Ação concluída sem payload.                              | Não tente interpretar JSON.                      |
| `400 Bad Request`            | Campo inválido ou header de executor ausente/malformado. | Corrija a requisição; não faça retry automático. |
| `401 Unauthorized`           | `keyapi` ausente ou inválida.                            | Recarregue o secret ou rotacione a chave.        |
| `402 Payment Required`       | Plano da conta vencido ou indisponível.                  | Regularize a conta antes de repetir.             |
| `403 Forbidden`              | Executor inválido, sem permissão ou fora do escopo.      | Revise o usuário executor e a conta.             |
| `404 Not Found`              | Rota ou recurso não encontrado no escopo da conta.       | Confirme path e identificador.                   |
| `409 Conflict`               | Estado atual impede a operação.                          | Releia o recurso antes de decidir.               |
| `413 Payload Too Large`      | Upload excedeu o limite do ambiente.                     | Reduza ou compacte o arquivo.                    |
| `415 Unsupported Media Type` | `Content-Type` incompatível.                             | Use JSON ou multipart conforme o endpoint.       |
| `422 Unprocessable Entity`   | Estrutura válida, mas regra de negócio rejeitada.        | Exiba a mensagem e ajuste os dados.              |
| `429 Too Many Requests`      | Limite do token atingido.                                | Aguarde `Retry-After`.                           |
| `5xx`                        | Falha temporária do serviço ou dependência.              | Faça retry limitado com jitter.                  |

## Corpo de erro

Erros de validação e execução usam a estrutura anunciada no OpenAPI. Quando o erro
for produzido pela camada HTTP, espere ao menos estes conceitos:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Descrição do campo ou regra inválida"
}
```

| Campo        | Tipo                            | Descrição                                            |
| ------------ | ------------------------------- | ---------------------------------------------------- |
| `statusCode` | integer                         | Mesmo status enviado na linha HTTP.                  |
| `error`      | string                          | Categoria curta e legível do erro.                   |
| `message`    | string ou estrutura documentada | Motivo específico; pode ser localizado pelo serviço. |

O endpoint pode acrescentar dados específicos. Não use o texto de `message` como
identificador estável de lógica: prefira status e campos explicitamente descritos
no contrato.

## Retry seguro

Faça retry automático apenas em `429`, timeouts e erros transitórios `5xx`.

```js
const retryable = response.status === 429 || response.status >= 500;
const retryAfter = Number(response.headers.get('retry-after') ?? 0);
```

Use backoff exponencial com jitter e um número máximo de tentativas. Operações de
escrita não anunciam uma chave de idempotência global; antes de repetir `POST`,
confirme se a primeira tentativa produziu efeito para evitar mensagens ou recursos
duplicados.

## Validação local

- envie datas e identificadores no formato indicado pelo schema;
- respeite `enum`, `minLength`, `maxLength`, mínimo e máximo;
- não envie `null` quando o campo for apenas opcional;
- ajuste `Content-Type` ao body real;
- trate respostas vazias antes de chamar `response.json()`.

::: tip Diagnóstico sem expor credenciais
Registre método, path, status, duração e um identificador interno da operação.
Nunca registre `keyapi`, conteúdo sensível de mensagens ou dados pessoais sem uma
política explícita de mascaramento e retenção. Preserve `x-underchat-user-id` apenas
quando houver uma finalidade legítima de auditoria.
:::
