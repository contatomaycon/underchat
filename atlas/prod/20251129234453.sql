-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea0b', 'Histórico de Conversas', 'Grupo de permissões relacionadas a relatórios de histórico de conversas', 'report_conversation_history_group');

-- Insert permission action
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea0c', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea0b', 'report_conversation_history_view', 'Visualizar Histórico de Conversas', 'Permite visualizar e acessar relatórios de histórico de conversas com informações de chats, mensagens, atendentes e filas');

