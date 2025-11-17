-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('cad2f324-deb0-4d75-9bcf-b06643dd25a3', 'Permissões', 'Grupo de permissões relacionadas a permissões', 'permission_group');

-- Insert permission action
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('08396e69-d10b-4bcb-bbd7-6a36ba4855f3', 'c0bc3998-e292-42de-9efd-ef8e8479a1be', 'cad2f324-deb0-4d75-9bcf-b06643dd25a3', 'permission_view', 'Visualizar Permissões', 'Permite visualizar e listar grupos de permissão e suas permissões');

