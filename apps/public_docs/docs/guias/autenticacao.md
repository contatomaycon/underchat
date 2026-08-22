---
title: Autenticação keyapi
description: Como identificar a conta com keyapi, selecionar o executor e tratar falhas.
---

# Autenticação por conta e executor

As operações públicas de chat, etiquetas, setores e usuários usam `keyapi`. Em
todas as operações de negócio, exceto a descoberta de executores, o header
`x-underchat-user-id` também é obrigatório para selecionar o executor:

| Header                | Obrigatório | Responsabilidade                                              |
| --------------------- | ----------- | ------------------------------------------------------------- |
| `keyapi`              | Sim         | Autentica a chave permanente e identifica a conta.            |
| `x-underchat-user-id` | Sim\*       | Seleciona o usuário executor e seu escopo dinâmico de acesso. |

\* `GET /v1/user/all` é a única operação de negócio que dispensa o executor. Ela
permite descobrir os usuários ativos elegíveis da própria conta usando apenas
`keyapi`.

```http
GET /v1/chat?status=my_chats HTTP/1.1
Host: api.seu-ambiente.com
Accept: application/json
keyapi: uc_live_substitua_pelo_token
x-underchat-user-id: 0195b2fc-7d8d-7d3e-a5d1-83d6b5f90a11
```

## Requisição com cURL

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/sector?current_page=1&per_page=20" \
  --header "Accept: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID"
```

## Requisição com JavaScript no servidor

```js
const response = await fetch(`${process.env.UNDERCHAT_API_URL}/v1/sector`, {
  headers: {
    accept: 'application/json',
    keyapi: process.env.UNDERCHAT_API_TOKEN,
    'x-underchat-user-id': process.env.UNDERCHAT_USER_ID,
  },
  signal: AbortSignal.timeout(10_000),
});

if (!response.ok) {
  throw new Error(`Underchat respondeu com ${response.status}`);
}

const payload = await response.json();
```

Este exemplo deve executar em backend, worker ou função serverless. Embutir o
segredo em uma aplicação web ou mobile permite que qualquer usuário o extraia.

## Como a autorização é decidida

Uma chave válida não garante acesso irrestrito. Em cada chamada, a API verifica:

1. se o hash corresponde a um token ativo;
2. se a conta vinculada está válida;
3. se o plano permite a operação;
4. se `x-underchat-user-id` é um UUID de usuário ativo, não excluído e da mesma conta;
5. se o usuário possui a permissão específica do endpoint;
6. o escopo do executor exigido pela operação e, para vínculos recebidos, se
   papéis, canais e setores pertencem à conta da chave.

O horário de atendimento não bloqueia chamadas da API pública. As demais regras
operacionais e de isolamento entre contas permanecem ativas. Desativar ou alterar
o usuário que gerou a chave não afeta a credencial; somente o executor informado na
chamada participa da autorização.

::: warning Seletor de contexto, não segundo fator
`x-underchat-user-id` não é um segredo e não autentica uma pessoa. Quem possui
`keyapi` pode selecionar qualquer usuário ativo da conta. Proteja a chave como uma
credencial privilegiada e preserve o UUID do executor nos registros de auditoria.
:::

## Formatos não aceitos

Não envie o token em:

- `Authorization: Bearer ...`;
- query string, como `?keyapi=...`;
- cookie;
- body JSON;
- parâmetro de path, exceto a chave própria do endpoint de webhook.

Também não envie o executor em body ou query string. Use exatamente o header
`x-underchat-user-id`; valores ausentes ou fora do formato UUID retornam `400`.

## Falhas comuns

| Status | Causa provável                                                      | Ação                                               |
| ------ | ------------------------------------------------------------------- | -------------------------------------------------- |
| `400`  | Executor ausente ou `x-underchat-user-id` não é UUID.               | Informe um UUID retornado por `/v1/user/all`.      |
| `401`  | `keyapi` ausente, inválida, revogada ou rotacionada.                | Confirme o secret e o nome exato do header.        |
| `402`  | Plano da conta vencido ou indisponível.                             | Regularize a conta e repita a chamada.             |
| `403`  | Executor inválido, inativo, fora da conta, sem permissão ou escopo. | Revise usuário, papel, canais e setores no painel. |
| `429`  | Mais de 120 requisições compartilhadas pela chave.                  | Respeite `Retry-After` e aplique backoff.          |

::: danger Proteja observabilidade e suporte
Ao compartilhar uma requisição para diagnóstico, substitua o valor por
`keyapi: [REDACTED]`. Configure também seu proxy, APM e logger para remover esse
header antes de persistir eventos. O UUID do executor pode permanecer em uma trilha
de auditoria protegida, mas não deve ser confundido com identidade autenticada.
:::

## Testar na referência

A [referência interativa](/referencia-api) permite informar os dois headers e
executar uma operação. O portal configura o Scalar com `persistAuth: false`: a
credencial fica somente na memória da página e não é gravada em `localStorage`.
Fechar ou recarregar a página remove o valor informado.
