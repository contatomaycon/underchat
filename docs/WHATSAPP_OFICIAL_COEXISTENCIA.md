# WhatsApp Oficial - Coexistencia Meta

Este documento registra a decisao de integracao do WhatsApp Oficial no Underchat.
O fluxo implementado e de coexistencia entre o WhatsApp Business App do cliente e
a Cloud API da Meta, tambem chamado pela Meta de onboarding de usuarios do
WhatsApp Business App.

## Escopo atual

- O canal `EWorkerType.whatsapp` representa WhatsApp Oficial em coexistencia.
- A conexao deve ser feita pelo Meta Embedded Signup configurado para WhatsApp
  Business App onboarding.
- O backend troca o `code` retornado pela Meta por token, valida WABA/telefone e
  salva token, WABA ID e phone number ID para uso futuro.
- A versao da Graph API deve ser sempre a configurada em `WhatsApp API Version`.
  Nao hardcodar `latest`, `v24.0`, `v25.0` ou qualquer outra versao nos fluxos
  Meta.

## APIs que devem ser usadas

- Embedded Signup para WhatsApp Business App users:
  https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- OAuth/code exchange da Graph API:
  `/{api_version}/oauth/access_token`
- Leitura dos numeros comerciais pertencentes a WABA:
  `/{api_version}/{waba_id}/phone_numbers`
- Webhooks futuros para coexistencia:
  - `messages`
  - `message_echoes`
  - `account_update`
  - eventos especificos de coexistencia documentados pela Meta
- Remocao real do vinculo com o parceiro deve ser tratada pelo fluxo de
  offboarding da coexistencia. Quando o cliente remove/desconecta o parceiro, a
  Meta dispara `account_update` com `PARTNER_REMOVED`.

Referencia do webhook:
https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update

## Validacao de numeros destinatarios

A Cloud API nao oferece consulta previa para confirmar se um numero arbitrario
de destinatario possui WhatsApp. O endpoint `/{waba_id}/phone_numbers` lista
somente os numeros comerciais conectados a propria WABA e nao deve ser usado
para validar contatos.

Contatos associados exclusivamente a canais `EWorkerType.whatsapp` podem ser
marcados como validados sem consulta remota. Essa validacao deve registrar a
origem interna `official_assumed`, para que canais Baileys, WWebJS ou Whatsmeow
nao reutilizem a presuncao sem executar sua propria consulta. Numeros observados
em mensagens recebidas pela Meta devem usar `official_inbound`.

Nao enviar mensagem ou template de teste para validar um contato: isso produz
um contato real com o destinatario, depende das regras de janela/template e pode
gerar cobranca.

## APIs que nao devem ser usadas neste modo

- Nao usar `/{phone_number_id}/deregister` para canais de coexistencia/SMB. A
  propria Meta retorna que o endpoint de deregister nao esta disponivel para
  API solution for SMB businesses.
- Nao assumir que `DELETE /{waba_id}/subscribed_apps` libera um numero. Esse
  endpoint remove assinatura de webhooks da WABA inteira e pode afetar outros
  canais da mesma WABA.
- Nao usar `assigned_users` como fluxo de desconexao. Essa API gerencia tarefas
  de usuarios/systems users na WABA, mas nao remove o parceiro do Business
  Manager do cliente.
- No fluxo de desconexao local do Underchat, nao chamar nenhuma API Meta de
  limpeza para tentar liberar o numero. Como a coexistencia SMB nao permite
  deregister por API, o backend deve apenas desconectar localmente e devolver
  uma mensagem orientando a remocao manual na Meta.

Referencia de assigned users:
https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/assigned_users/

## Regras de UI e backend para Oficial

Para `EWorkerType.whatsapp`, esconder e bloquear recursos que dependem de
runtime/container nao oficial ou de API nao disponivel no modo coexistencia:

- Proxy
- Status do Perfil
- Informacoes do Perfil
- Simular digitacao
- Chave de seguranca
- Mostrar mensagem quando o numero receber ligacao
- Recriar canal/container

`Marcar mensagem recebida como lida` pode permanecer se o fluxo de mensagens
oficial for implementado usando o endpoint de read receipt da Cloud API.

## Informacoes do perfil

A Business Profile API da Cloud API existe:
https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/business-profiles

Mesmo assim, para o fluxo de coexistencia usado no Underchat, nao expor edicao
de perfil no canal oficial. Em testes reais com token de system user contendo
`whatsapp_business_management`, a Meta retornou `(#200) Permissions error` para
alterar o perfil do numero. A regra do produto passa a ser: perfil oficial em
coexistencia e gerenciado pelo ambiente Meta/WhatsApp Business do cliente, nao
pelo Underchat.

## Ligacoes

A Meta possui documentacao da Calling API para WhatsApp Cloud API:
https://developers.facebook.com/documentation/business-messaging/whatsapp/calling

No modo coexistencia WhatsApp Business App + Cloud API, a documentacao de
onboarding/coexistencia nao define um evento confiavel para o Underchat receber
ligacao recebida e disparar mensagem automatica. Portanto, a opcao "Mostrar
mensagem quando o numero receber ligacao" deve ficar indisponivel para
WhatsApp Oficial ate a Meta documentar um evento compativel com coexistencia.

## Desconexao

O botao "Desconectar" no Underchat deve apenas:

- marcar o canal como offline;
- remover/invalidar a conexao oficial local;
- manter o canal listado para reconexao limpa pelo Embedded Signup;
- devolver um aviso informando que a remocao do vinculo na Meta deve ser feita
  manualmente.

Para liberar o numero do parceiro no Business Manager, o cliente precisa remover
o parceiro/acesso no ambiente Meta ou desconectar a conta no WhatsApp Business
App. Quando o webhook for implementado, `account_update` com `PARTNER_REMOVED`
deve ser usado como fonte oficial de que a remocao foi concluida.

O fluxo de desconexao nao deve chamar:

- `/{phone_number_id}/deregister`;
- `DELETE /{waba_id}/subscribed_apps`;
- `assigned_users` para remover tarefas/acessos.
