-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019bfdcd-6097-741a-8889-1474da257535', 'Integrações', 'Grupo de permissões relacionadas a integrações', 'integration_group')
ON CONFLICT ("permission_action_group_id") DO NOTHING;

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bfdcd-6098-702b-b34b-1f7873575571', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bfdcd-6097-741a-8889-1474da257535', 'integration_group', 'Acesso a Integrações', 'Permite acesso completo ao grupo de integrações')
ON CONFLICT ("permission_action_id") DO NOTHING;
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bfdcd-6098-702b-b34b-2384ef45c62d', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bfdcd-6097-741a-8889-1474da257535', 'integration_status_update', 'Atualizar Status de Integração', 'Permite atualizar o status de integrações')
ON CONFLICT ("permission_action_id") DO NOTHING;
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bfdcd-6098-702b-b34b-25760530a903', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bfdcd-6097-741a-8889-1474da257535', 'integration_generate_key', 'Gerar Chave de Integração', 'Permite gerar novas chaves para integrações')
ON CONFLICT ("permission_action_id") DO NOTHING;
