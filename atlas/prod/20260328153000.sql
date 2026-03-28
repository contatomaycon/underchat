-- Insert permission action: disable send message on transfer
INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES (
  'a2e76653-11be-4c95-9a9f-0f9e6e84d0e7',
  '019a930d-c6f6-766d-9c83-914b7faa4337',
  '019a930d-c6f6-766d-9c83-b9db2f0d1aae',
  'disable_send_message_on_transfer',
  'Desabilitar mensagem ao transferir atendimento',
  'Permite desabilitar o envio de mensagem automática ao transferir atendimento'
)
ON CONFLICT ("permission_action_id") DO NOTHING;
