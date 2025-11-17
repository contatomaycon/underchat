-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019a930d-c6f8-7526-872d-35e6fb828f2c', 'Permissões', 'Grupo de permissões relacionadas a permissões', 'permission_group');

-- Insert permission action
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-3aec32504b71', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f8-7526-872d-35e6fb828f2c', 'permission_view', 'Visualizar Permissões', 'Permite visualizar e listar grupos de permissão e suas permissões');

