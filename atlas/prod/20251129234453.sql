-- Insert permission action group for reports
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea0b', 'Relatórios', 'Grupo de permissões relacionadas a relatórios de histórico de conversas e atendimentos', 'report_conversation_history_group')
ON CONFLICT ("permission_action_group_id") DO NOTHING;

-- Insert permission action for conversation history
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea0c', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea0b', 'report_conversation_history_view', 'Visualizar Histórico de Conversas', 'Permite visualizar e acessar relatórios de histórico de conversas com informações de chats, mensagens, atendentes e filas')
ON CONFLICT ("permission_action_id") DO NOTHING;

-- Insert permission action for attendance reports (inside conversation history group)
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019af96d-5b71-7759-a7ac-7c16a28ed7d6', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea0b', 'report_attendance_view', 'Visualizar Relatórios de Atendimentos', 'Permite visualizar e acessar relatórios de atendimentos com informações de filas, analistas e métricas de atendimento')
ON CONFLICT ("permission_action_id") DO NOTHING;

