---
title: Usuários
description: Integre usuários, dados pessoais, papéis, horários, fotos, setores e canais com isolamento por conta.
---

# Usuários

O domínio `user` permite sincronizar a equipe operacional da conta. As operações
públicas permitem listar, criar, consultar, alterar, bloquear e relacionar
usuários. Rotas exclusivas de administração da plataforma não fazem parte da API
PUBLIC.

## Executor e usuário-alvo

Estes dois identificadores têm finalidades diferentes:

| Identificador         | Onde vai | Finalidade                                                          |
| --------------------- | -------- | ------------------------------------------------------------------- |
| `x-underchat-user-id` | Header   | Usuário que executa a chamada; define permissões, canais e setores. |
| `:user_id`            | Path     | Usuário-alvo que será consultado ou alterado.                       |
| `user_id`             | Body     | Usuário de destino quando o schema da operação o exigir.            |

O executor e o alvo podem ser diferentes, mas ambos precisam pertencer à conta da
chave. Um alvo de outra conta responde como recurso não encontrado, sem confirmar
sua existência.

::: danger A chave permite escolher o executor
`x-underchat-user-id` é um seletor de contexto, não uma autenticação independente.
Quem possui `keyapi` pode escolher qualquer usuário ativo da conta. Mantenha a
chave somente em serviços confiáveis, autorize cada fluxo internamente e registre o
executor usado em operações sensíveis.
:::

## Mapa de operações

### Coleção e ciclo de vida

| Método e caminho                                                          | Finalidade                            | Executor       |
| ------------------------------------------------------------------------- | ------------------------------------- | -------------- |
| <span class="method method--get">GET</span> `/v1/user`                    | Lista paginada com filtros.           | Obrigatório    |
| <span class="method method--get">GET</span> `/v1/user/all`                | Lista enxuta de executores elegíveis. | **Dispensado** |
| <span class="method method--post">POST</span> `/v1/user`                  | Cria um usuário na conta da chave.    | Obrigatório    |
| <span class="method method--get">GET</span> `/v1/user/:user_id`           | Consulta os dados do usuário-alvo.    | Obrigatório    |
| <span class="method method--patch">PATCH</span> `/v1/user/:user_id`       | Altera os campos enviados.            | Obrigatório    |
| <span class="method method--delete">DELETE</span> `/v1/user/:user_id`     | Exclui logicamente o usuário.         | Obrigatório    |
| <span class="method method--post">POST</span> `/v1/user/:user_id/block`   | Bloqueia o acesso do usuário.         | Obrigatório    |
| <span class="method method--post">POST</span> `/v1/user/:user_id/unblock` | Desbloqueia o usuário.                | Obrigatório    |

### Dados pessoais e foto

| Método e caminho                                                            | Dado retornado ou ação               |
| --------------------------------------------------------------------------- | ------------------------------------ |
| <span class="method method--get">GET</span> `/v1/user/:user_id/email`       | Email descriptografado.              |
| <span class="method method--get">GET</span> `/v1/user/:user_id/phone`       | DDI e telefone descriptografados.    |
| <span class="method method--get">GET</span> `/v1/user/:user_id/document`    | Tipo e documento descriptografado.   |
| <span class="method method--get">GET</span> `/v1/user/:user_id/address1`    | Endereço principal descriptografado. |
| <span class="method method--get">GET</span> `/v1/user/:user_id/address2`    | Complemento/endereço secundário.     |
| <span class="method method--post">POST</span> `/v1/user/:user_id/photo`     | Envia ou substitui a foto.           |
| <span class="method method--delete">DELETE</span> `/v1/user/:user_id/photo` | Remove a foto atual.                 |

### Papel, horários e escopo

| Método e caminho                                                                  | Finalidade                              |
| --------------------------------------------------------------------------------- | --------------------------------------- |
| <span class="method method--get">GET</span> `/v1/user/roles`                      | Lista papéis disponíveis na conta.      |
| <span class="method method--get">GET</span> `/v1/user/:user_id/role`              | Consulta o papel do usuário.            |
| <span class="method method--post">POST</span> `/v1/user/:user_id/role`            | Atribui um papel permitido.             |
| <span class="method method--get">GET</span> `/v1/user/:user_id/attendance-hours`  | Consulta regras semanais.               |
| <span class="method method--put">PUT</span> `/v1/user/:user_id/attendance-hours`  | Substitui as regras semanais.           |
| <span class="method method--get">GET</span> `/v1/user/me/attendance-hours/status` | Calcula o estado do **executor** agora. |
| <span class="method method--get">GET</span> `/v1/user/sectors`                    | Lista setores disponíveis na conta.     |
| <span class="method method--get">GET</span> `/v1/user/:user_id/sectors`           | Lista setores do usuário-alvo.          |
| <span class="method method--get">GET</span> `/v1/user/channels`                   | Lista canais disponíveis na conta.      |
| <span class="method method--get">GET</span> `/v1/user/:user_id/channels`          | Lista canais do usuário-alvo.           |

Rotas administrativas de sessão e troca de conta pertencem ao painel e não fazem
parte do contrato PUBLIC deste portal.

## 1. Descobrir um executor

`GET /v1/user/all` é a única operação de negócio autenticada que usa somente
`keyapi`. Ela retorna a lista resumida de usuários ativos, não excluídos e com papel
ativo na conta da chave.

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/user/all" \
  --header "Accept: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN"
```

Escolha o `user_id` retornado, valide-o contra a política do seu sistema e use-o nas
demais chamadas:

```bash
export UNDERCHAT_USER_ID="0195b2fc-7d8d-7d3e-a5d1-83d6b5f90a11"
```

Não trate `/user/all` como diretório público e não exponha sua resposta ao
navegador. Se o usuário deixar de ser elegível, chamadas posteriores com seu UUID
retornarão `403`.

## 2. Listar usuários

<span class="method method--get">GET</span> `/v1/user`

```bash
curl --get "$UNDERCHAT_API_URL/v1/user" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data-urlencode "current_page=1" \
  --data-urlencode "per_page=20" \
  --data-urlencode "search=ana"
```

| Query                | Tipo             | Obrigatório | Uso                                               |
| -------------------- | ---------------- | ----------- | ------------------------------------------------- |
| `current_page`       | integer          | Não         | Página, iniciando em `1`.                         |
| `per_page`           | integer          | Não         | Quantidade por página dentro do limite do schema. |
| `sort_by`            | array de objetos | Não         | Ordenação por chaves e direções aceitas.          |
| `user_status`        | string ou `null` | Não         | Filtra a situação do usuário.                     |
| `sector_id`          | UUID ou `null`   | Não         | Restringe a um setor da conta.                    |
| `permission_role_id` | UUID ou `null`   | Não         | Restringe a um papel permitido.                   |
| `search`             | string ou `null` | Não         | Busca textual nos campos indexados pela listagem. |

`account_id` não faz parte do contrato PUBLIC. A conta vem da chave e propriedades
adicionais são rejeitadas.

## 3. Criar um usuário

<span class="method method--post">POST</span> `/v1/user`

A criação usa `multipart/form-data` porque pode incluir `photo`. Campos simples são
serializados conforme o schema multipart exibido na referência OpenAPI.

| Campo                | Tipo             | Obrigatório | Finalidade                                  |
| -------------------- | ---------------- | ----------- | ------------------------------------------- |
| `email`              | string           | Sim         | Login/email do novo usuário.                |
| `password`           | string           | Sim         | Senha inicial, conforme a política vigente. |
| `name`               | string           | Sim         | Nome.                                       |
| `last_name`          | string           | Sim         | Sobrenome.                                  |
| `phone_ddi`          | string           | Não         | Código internacional do telefone.           |
| `phone`              | string           | Não         | Número do telefone.                         |
| `birth_date`         | string ou `null` | Não         | Data de nascimento no formato anunciado.    |
| `document_type_id`   | UUID             | Não         | Tipo de documento permitido.                |
| `document`           | string           | Não         | Número do documento.                        |
| `country_id`         | integer          | Não         | País do endereço.                           |
| `zip_code`           | string           | Não         | Código postal.                              |
| `address1`           | string           | Não         | Endereço principal.                         |
| `address2`           | string ou `null` | Não         | Complemento/endereço secundário.            |
| `city_fiscal_code`   | string ou `null` | Não         | Código fiscal do município.                 |
| `state_fiscal_code`  | string ou `null` | Não         | Código fiscal do estado.                    |
| `district`           | string           | Não         | Bairro/distrito.                            |
| `photo`              | arquivo          | Não         | Foto inicial do perfil.                     |
| `permission_role_id` | UUID ou `null`   | Não         | Papel ativo e atribuível da conta.          |
| `sector_ids`         | UUID[]           | Não         | Setores pertencentes à conta.               |
| `channel_ids`        | UUID[]           | Não         | Canais pertencentes à conta.                |
| `user_status_id`     | UUID ou `null`   | Não         | Situação inicial permitida.                 |

O cliente não pode enviar `account_id`: a API sempre cria o usuário na conta
autenticada por `keyapi`. IDs de papel, setor ou canal inexistentes ou de outra
conta retornam `400`. Papéis protegidos da plataforma não podem ser atribuídos.

## 4. Consultar e editar

Use `GET /v1/user/:user_id` para carregar o cadastro e `PATCH` para alterar apenas
os campos enviados.

```bash
curl --request PATCH \
  --url "$UNDERCHAT_API_URL/v1/user/$TARGET_USER_ID" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --form 'name=Ana' \
  --form 'last_name=Silva'
```

O `PATCH` aceita, como opcionais, os mesmos dados cadastrais da criação e também
`photo_url`. `password` altera a senha quando informado. `sector_ids` e
`channel_ids` substituem os vínculos conforme o formato multipart do OpenAPI.
Omitir um campo significa “não alterar”; `null` só deve ser usado quando o schema
do campo o permitir.

Na PUBLIC, `account_id` é removido e rejeitado tanto na criação quanto na edição.
Uma integração nunca move usuários entre contas.

## 5. Bloquear, desbloquear e excluir

As três operações recebem apenas `:user_id` no path e não precisam de body:

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/user/$TARGET_USER_ID/block" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID"
```

- `block` impede novas atuações do alvo, inclusive como executor da API PUBLIC;
- `unblock` restaura o acesso se as demais condições continuarem válidas;
- `DELETE /user/:user_id` exclui logicamente o cadastro conforme as regras de negócio.

Releia a lista após a operação. Não repita automaticamente uma mutação quando a
primeira resposta for incerta.

## 6. Consultar dados pessoais

Email, telefone, documento e endereços possuem rotas separadas para que a API possa
aplicar permissões específicas e registrar acesso a dados sensíveis:

```bash
curl --request GET \
  --url "$UNDERCHAT_API_URL/v1/user/$TARGET_USER_ID/email" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID"
```

Todas recebem um único parâmetro obrigatório, `user_id` em formato UUID. A resposta
de telefone pode separar DDI e número; documento pode incluir seu tipo; endereços
podem retornar `null` quando não cadastrados. Use o schema específico de cada rota
como fonte de verdade.

::: warning PII e isolamento
Mesmo executores com acesso amplo continuam limitados à conta da chave. Não use
estas rotas para testar a existência de UUIDs externos. Mascare respostas em logs,
restrinja retenção e conceda acesso somente ao fluxo que realmente precisa do dado.
:::

## 7. Gerenciar foto

Para enviar ou substituir uma foto:

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/user/$TARGET_USER_ID/photo" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --form "photo=@./perfil.jpg;type=image/jpeg"
```

| Campo     | Tipo              | Obrigatório | Descrição                             |
| --------- | ----------------- | ----------- | ------------------------------------- |
| `user_id` | UUID no path      | Sim         | Usuário que terá a foto alterada.     |
| `photo`   | arquivo multipart | Sim         | Binário e MIME aceitos pelo ambiente. |

`DELETE /v1/user/:user_id/photo` remove a foto e não recebe body. Não defina o
boundary multipart manualmente e respeite os limites de upload do ambiente.

## 8. Papéis e permissões

1. Liste opções com `GET /v1/user/roles`;
2. consulte o vínculo atual em `GET /v1/user/:user_id/role`;
3. atribua com `POST /v1/user/:user_id/role`.

```bash
curl --request POST \
  --url "$UNDERCHAT_API_URL/v1/user/$TARGET_USER_ID/role" \
  --header "Content-Type: application/json" \
  --header "keyapi: $UNDERCHAT_API_TOKEN" \
  --header "x-underchat-user-id: $UNDERCHAT_USER_ID" \
  --data '{
    "permission_role_id": "720356f5-214d-4ed9-84f0-9da6edb11833"
  }'
```

| Campo                | Tipo         | Obrigatório | Descrição                                      |
| -------------------- | ------------ | ----------- | ---------------------------------------------- |
| `user_id`            | UUID no path | Sim         | Usuário que receberá o papel.                  |
| `permission_role_id` | UUID no body | Sim         | Papel ativo, atribuível e pertencente à conta. |

A atribuição exige a permissão pública de alteração de usuário. `account_id` não é
aceito em `/user/roles`. Mesmo que um papel protegido de plataforma seja visível
em uma consulta, ele não pode ser atribuído nem forçado por UUID pela PUBLIC.

## 9. Horários de atendimento

`GET /v1/user/:user_id/attendance-hours` consulta a agenda semanal. `PUT` substitui
o conjunto completo de regras:

```json
{
  "rules": [
    {
      "weekday": "monday",
      "start_time": "08:30",
      "end_time": "18:00"
    },
    {
      "weekday": "tuesday",
      "start_time": "08:30",
      "end_time": "18:00"
    }
  ]
}
```

| Campo        | Tipo   | Obrigatório | Restrição                                      |
| ------------ | ------ | ----------- | ---------------------------------------------- |
| `rules`      | array  | Sim         | Conjunto completo; pode conter várias janelas. |
| `weekday`    | enum   | Sim         | `monday` a `sunday`.                           |
| `start_time` | string | Sim         | Horário `HH:mm`, de `00:00` a `23:59`.         |
| `end_time`   | string | Sim         | Horário `HH:mm`, de `00:00` a `23:59`.         |

`GET /v1/user/me/attendance-hours/status` interpreta `me` como o usuário de
`x-underchat-user-id`. A resposta informa timezone, bloqueio atual, regras de hoje,
próximas transições e horário do servidor.

O horário não impede a autenticação da API PUBLIC; esta rota existe para que a
integração tome decisões operacionais consistentes com o painel.

## 10. Setores e canais

Use as coleções da conta antes de criar ou editar vínculos:

- `GET /v1/user/sectors`: setores disponíveis;
- `GET /v1/user/channels`: canais disponíveis;
- `GET /v1/user/:user_id/sectors`: setores atuais do alvo;
- `GET /v1/user/:user_id/channels`: canais atuais do alvo.

As quatro rotas exigem o executor; as duas rotas por usuário também exigem
`:user_id` UUID. `account_id` não é aceito em query. Ao criar ou editar, envie
somente IDs devolvidos por essas coleções. Um ID malformado ou pertencente a outra
conta rejeita a requisição inteira.

## Respostas e falhas esperadas

| Status         | Significado neste domínio                                             |
| -------------- | --------------------------------------------------------------------- |
| `200`          | Leitura ou mutação concluída no envelope padrão.                      |
| `400`          | Executor ausente/malformado, campo inválido ou vínculo fora da conta. |
| `401`          | `keyapi` ausente, inválida, revogada ou rotacionada.                  |
| `402`          | Plano da conta indisponível.                                          |
| `403`          | Executor inativo, excluído, fora da conta ou sem permissão.           |
| `404`          | Usuário-alvo não existe no escopo da conta.                           |
| `409` ou `422` | Estado atual ou regra de negócio impede a alteração.                  |
| `429`          | Cota compartilhada da chave atingida.                                 |

Para nomes exatos de propriedades de resposta, limites de arquivo, enums e exemplos
gerados pelo contrato vigente, consulte a [referência interativa](/referencia-api).
