-- Insert permission action: manage in-chat lifecycle (transfer/close without being primary)
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES ('c58ca5b0-b9e1-4c39-9157-b442672c6924', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-b9db2f0d1aae', 'manage_in_chat_lifecycle', 'Gerenciar ciclo do atendimento em andamento', 'Permite transferir e encerrar atendimentos em andamento sem ser o atendente primário.')
ON CONFLICT ("permission_action_id") DO NOTHING;
