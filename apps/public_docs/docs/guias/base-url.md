---
title: Base URL e versionamento
description: Como montar URLs da API v1 e localizar o contrato OpenAPI.
---

# Base URL e versionamento

A origem muda por ambiente; as rotas de negócio usam o prefixo estável `/v1`.
Neste build, a base versionada é:

<ApiBaseUrl />

## Composição de uma URL

```text
{origem}/{versão}/{recurso}/{identificador}
```

Exemplo:

```text
https://api.seu-ambiente.com/v1/chat/0195b2fc-7d8d-7d3e-a5d1-83d6b5f90a11
```

| Parte         | Exemplo                        | Descrição                                                 |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| Origem        | `https://api.seu-ambiente.com` | Host da API PUBLIC no ambiente.                           |
| Versão        | `v1`                           | Versão maior do contrato HTTP.                            |
| Recurso       | `chat`                         | Domínio público: chat, label-template, sector ou user.    |
| Identificador | UUID/ULID                      | Presente apenas em operações sobre um recurso específico. |

Não acrescente `/v1` duas vezes e evite barra final ao concatenar caminhos.

## Rotas de infraestrutura em `/v1`

Health e webhook também usam a base versionada, embora não façam parte dos quatro
domínios de negócio:

| Método e caminho                                                    | Autenticação             | Finalidade                                   |
| ------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| <span class="method method--get">GET</span> `/v1/health/check`      | Nenhuma                  | Disponibilidade básica do serviço.           |
| <span class="method method--post">POST</span> `/v1/webhook/:keyapi` | Chave do webhook no path | Entrada flexível de dados de CRM/automações. |

O token do card **API pública** não substitui `:keyapi` do webhook.

## Contrato OpenAPI

O JSON usado por este portal está disponível em:

<ApiBaseUrl kind="openapi" />

Esse documento é a fonte de verdade para métodos, paths, parâmetros, schemas,
obrigatoriedade e respostas. Gere clientes somente quando o OpenAPI do ambiente
estiver acessível e versionado junto à sua integração.

## Política de versão

- alterações compatíveis entram em `/v1` sem mudar o prefixo;
- remoções ou mudanças incompatíveis exigem uma nova versão maior;
- novos endpoints não devem ser inferidos pelo cliente: use o OpenAPI publicado;
- consumidores devem ignorar campos de resposta desconhecidos para tolerar adições;
- campos enviados devem seguir o schema, pois bodies e queries podem rejeitar
  propriedades não documentadas.

## Ambientes

Mantenha URL e token separados para desenvolvimento, homologação e produção. Um
token pertence a uma única conta e não deve ser promovido entre ambientes.

```dotenv
UNDERCHAT_API_URL=https://api.seu-ambiente.com
UNDERCHAT_API_TOKEN=uc_live_segredo_do_ambiente
```
