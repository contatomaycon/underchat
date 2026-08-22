---
title: Webhook de entrada para CRM
description: Receba dados de CRMs, formulários e automações e transforme-os em conversas.
---

# Webhook de entrada para CRM

O **Webhook de entrada** recebe payloads de CRMs, formulários e automações para
criar contatos, mensagens e chats na Underchat. Ele é configurável: primeiro você
envia uma amostra, depois mapeia os campos do sistema de origem e só então ativa o
fluxo.

```http
POST /v1/webhook/:keyapi HTTP/1.1
Content-Type: application/json
```

O `:keyapi` do caminho identifica a configuração e o canal/worker do webhook. Ele é
diferente do token enviado no header `keyapi` das APIs `/v1`.

::: danger A URL inteira é uma credencial bearer
O contrato atual autentica a chamada pela chave no caminho e não exige assinatura
HMAC do sistema de origem. Quem obtiver a URL consegue enviar payloads para essa
configuração. Use HTTPS, compartilhe a URL somente com o produtor autorizado e
remova o caminho completo de logs, traces, histórico de comandos e dashboards.
:::

## Sequência de configuração

1. Abra **Integração → Webhooks de entrada**.
2. Selecione **Novo webhook** e informe nome e canal de destino.
3. Copie a URL exclusiva mostrada pela Underchat.
4. Configure seu CRM para enviar um payload representativo.
5. Use **Enviar amostra** ou dispare um evento real de teste.
6. Em **Mapear**, associe campos de contato, mensagem e contexto.
7. Revise os dados reconhecidos e marque a integração como **Ativa**.

## Payload de entrada

O webhook não impõe um body universal porque o mapeamento interpreta a estrutura
do sistema externo. Um exemplo de amostra seria:

```json
{
  "event": "lead.created",
  "lead": {
    "id": "crm-98321",
    "name": "Maria Silva",
    "phone": "+5561999999999",
    "email": "maria@example.com"
  },
  "message": "Quero falar com o time comercial",
  "campaign": {
    "source": "landing-page",
    "name": "Produto Enterprise"
  }
}
```

Os nomes acima são ilustrativos. O que importa é que a amostra contenha todos os
campos e variações que serão usados no mapeamento.

## Campos recomendados na origem

| Informação       | Por que enviar                                             |
| ---------------- | ---------------------------------------------------------- |
| ID externo       | Correlaciona reenvios e auditoria no CRM.                  |
| Nome             | Identifica o contato para o atendente.                     |
| Telefone com DDI | Permite localizar ou criar o contato no canal correto.     |
| Email/documento  | Ajuda a enriquecer e desambiguar contatos.                 |
| Texto inicial    | Cria contexto para o primeiro atendimento.                 |
| Origem/campanha  | Pode ser mapeada para contexto, etiqueta ou mensagem.      |
| Data do evento   | Facilita auditoria e ordenação de integrações assíncronas. |

## Envio

```bash
curl --request POST \
  --url "https://api.seu-ambiente.com/v1/webhook/CHAVE_EXCLUSIVA_DO_WEBHOOK" \
  --header "Content-Type: application/json" \
  --data @evento-crm.json
```

Use HTTPS e trate a URL inteira como segredo. Não publique a chave em tickets,
prints ou scripts executados no navegador.

Uma resposta aceita usa o envelope padrão da API. Considere o processamento
confirmado somente quando o HTTP for `200` **e** `data.success` for `true`:

```json
{
  "status": true,
  "message": "Webhook recebido com sucesso",
  "data": {
    "success": true
  }
}
```

O texto de `message` pode ser localizado. Não o use para decidir a lógica do
produtor. HTTP `401` indica chave ausente ou inválida; falhas `5xx` podem ser
transitórias.

## Retentativas e duplicidade

O endpoint não anuncia uma chave de idempotência nem proteção contra replay. Uma
retentativa pode repetir o efeito de negócio, principalmente se a resposta se
perder depois que o processamento começar.

- inclua um ID imutável do evento do CRM no payload e preserve-o nos reenvios;
- aguarde uma resposta conclusiva e use backoff limitado em `5xx`;
- não repita automaticamente depois de timeout sem antes reconciliar o resultado;
- limite no sistema de origem quem pode ler e acionar a URL;
- se precisar de garantias adicionais, aplique allowlist, limite de taxa e
  auditoria no produtor ou na borda sob seu controle.

Headers de assinatura enviados pelo CRM não são verificados pelo contrato público
descrito nesta rota. Não presuma autenticação mútua ou deduplicação implícita.

## Evolução do payload

Quando o CRM mudar sua estrutura:

1. mantenha os campos antigos durante uma janela de transição;
2. envie uma nova amostra;
3. atualize o mapeamento;
4. valide em um contato de teste;
5. ative a nova versão e monitore erros.

Campos ausentes ou em formato diferente podem impedir a identificação do contato ou
a criação do chat. Faça validação no sistema de origem e acompanhe as respostas
HTTP do webhook.

## Webhook ou API pública?

| Necessidade                                                   | Use                                     |
| ------------------------------------------------------------- | --------------------------------------- |
| Receber um evento flexível de CRM e mapear campos visualmente | Webhook de entrada                      |
| Listar chats ou mensagens existentes                          | API `/v1/chat`                          |
| Enviar mídia, transferir ou finalizar atendimento             | API `/v1/chat`                          |
| Administrar etiquetas e setores                               | API `/v1/label-template` e `/v1/sector` |

Os dois recursos podem trabalhar juntos: o webhook inicia o fluxo e a API consulta
ou atualiza o atendimento depois.
