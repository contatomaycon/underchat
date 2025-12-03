-- Insert chatbot permission: view chatbot messages
INSERT INTO "permission_action" (
  "permission_action_id",
  "permission_module_id",
  "permission_action_group_id",
  "action",
  "name",
  "description"
) VALUES (
  '019ab757-12dc-73f9-a82c-befc9e6fea0d',
  '019a930d-c6f6-766d-9c83-914b7faa4337',
  '019ab757-12dc-73f9-a82c-befc9e6fea08',
  'view_chatbot_messages',
  'Visualizar mensagens do chatbot',
  'Permite visualizar as mensagens que estão na etapa de chatbot (URA), sem assumir o atendimento.'
);