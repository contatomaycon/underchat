---
title: Primeiros passos
description: Gere um token e faça sua primeira chamada autenticada à API pública da Underchat.
---

# Primeiros passos

A API pública leva os recursos operacionais da Underchat para CRMs, ERPs,
automações e produtos próprios. Todas as rotas de negócio ficam sob `/v1` e usam o
mesmo contexto de conta, usuário, permissões, canais e setores do painel. A chave
identifica a conta; cada chamada informa explicitamente quem é o executor.

## Antes de começar

Você precisa de:

- uma conta Underchat com plano ativo;
- um usuário ativo com acesso às operações que a integração executará;
- o UUID desse usuário para enviar em `x-underchat-user-id`;
- a permissão para gerar a chave da integração;
- acesso HTTPS à origem da API em seu ambiente.

::: tip Chave da conta, executor por chamada
O token não fica operacionalmente vinculado ao usuário que o gerou. O header
`x-underchat-user-id` seleciona um usuário ativo da mesma conta, e a API aplica
continuamente as permissões, canais e setores desse executor. O gerador exibido no
painel é apenas um registro de auditoria.
:::

## 1. Gere o token

No painel da Underchat, abra **Integração → API pública** e selecione **Gerar
token**. Confirme a operação e copie a credencial iniciada pelo prefixo exibido na
tela.

O token não expira automaticamente e continua válido após o logout do painel.
Guarde-o em um cofre de segredos do servidor; não o inclua em JavaScript entregue
ao navegador, aplicativos distribuídos ou repositórios Git.

[Entenda geração, rotação e revogação →](/guias/token)

## 2. Configure a URL base

Use a origem correspondente ao ambiente em que sua conta está disponível. Este
portal foi compilado para a origem abaixo:

<ApiBaseUrl />

Em um shell, mantenha URL e token fora do histórico sempre que possível:

```bash
export UNDERCHAT_API_URL="https://api.seu-ambiente.com"
export UNDERCHAT_API_TOKEN="uc_live_substitua_pelo_token"
export UNDERCHAT_USER_ID="0195b2fc-7d8d-7d3e-a5d1-83d6b5f90a11"
```

## 3. Valide a disponibilidade

O health check não exige o token, mas compartilha a base versionada da API:

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/health/check"
```

Uma resposta `2xx` confirma que o processo público está acessível. Ela não valida
o token, as permissões ou o plano da conta.

## 4. Faça uma chamada autenticada

Envie a credencial no header `keyapi` e o UUID do executor em
`x-underchat-user-id`. A listagem de chats exige o filtro `status`; `my_chats`
limita a visão aos atendimentos associados ao executor informado.

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/chat?status=my_chats&current_page=1&per_page=20" \
  --header "Accept: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID"
```

Não use `Authorization: Bearer`. A API PUBLIC lê `keyapi` e
`x-underchat-user-id`. A única exceção de negócio é `GET /v1/user/all`, que usa
somente a chave para descobrir usuários executores elegíveis da conta.

## 5. Use a referência como contrato

A [referência interativa](/referencia-api) é carregada do OpenAPI publicado pela
própria API. Para cada operação, consulte:

- parâmetros de path e query;
- campos do body, tipos e obrigatoriedade;
- conteúdo aceito, inclusive `multipart/form-data`;
- respostas por status HTTP;
- enums, formatos, limites e exemplos.

## Checklist de produção

- [ ] Token armazenado em secret manager, nunca no código-fonte.
- [ ] URL HTTPS configurada por ambiente.
- [ ] Timeout e política de retry definidos no cliente.
- [ ] Respostas `401`, `403`, `429` e `5xx` tratadas explicitamente.
- [ ] Logs removem o valor de `keyapi` e tratam o UUID do executor como dado de auditoria.
- [ ] Rotação testada sem interrupção da integração.

Próximo passo: [autentique sua integração com segurança](/guias/autenticacao).
