-- Insert permission action: update own chat user status
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES ('e3466232-1ac7-4583-a524-f6cd2572319b', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-b9db2f0d1aae', 'chat_user_status_update', 'Atualizar status do próprio usuário no chat', 'Permite alterar manualmente o próprio status de presença no chat (online, ocupado, não perturbe, ausente e offline).')
ON CONFLICT ("permission_action_id") DO NOTHING;
