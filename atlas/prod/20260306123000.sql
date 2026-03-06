-- Insert permission action: view chat attendants info
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES ('b486a6aa-2d1c-4764-b52b-cae48ab0c60e', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-b9db2f0d1aae', 'view_chat_attendants_info', 'Visualizar informações dos atendentes', 'Permite visualizar os atendentes primário e secundários do atendimento, incluindo horário de entrada.')
ON CONFLICT ("permission_action_id") DO NOTHING;
