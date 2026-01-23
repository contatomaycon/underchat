-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019bec20-073f-756b-a67a-bc0776fee2fe', 'Informativos', 'Grupo de permissões relacionadas a informativos', 'release_group');

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bec20-0742-746e-a319-1cb45a490379', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bec20-073f-756b-a67a-bc0776fee2fe', 'release_view', 'Visualizar Informativo', 'Permite visualizar, listar e buscar informações detalhadas de informativos');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bec20-0742-746e-a319-20d6d5ba79ff', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bec20-073f-756b-a67a-bc0776fee2fe', 'release_create', 'Criar Informativo', 'Permite criar novos informativos');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bec20-0742-746e-a319-250c6785e7bd', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bec20-073f-756b-a67a-bc0776fee2fe', 'release_update', 'Atualizar Informativo', 'Permite atualizar informações de informativos existentes');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019bec20-0742-746e-a319-2adc4194f2ec', '019a930d-c6f6-766d-9c83-914b7faa4337', '019bec20-073f-756b-a67a-bc0776fee2fe', 'release_delete', 'Excluir Informativo', 'Permite excluir informativos do sistema');