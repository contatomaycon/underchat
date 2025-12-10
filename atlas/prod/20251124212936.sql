-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019a930d-c6f6-766d-9c83-e123456789ab', 'Despesas', 'Grupo de permissões relacionadas a despesas', 'expenditure_group');

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-2a1234567890', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-e123456789ab', 'expenditure_view', 'Visualizar Despesa', 'Permite visualizar, listar e buscar informações detalhadas de despesas');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-2b1234567891', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-e123456789ab', 'expenditure_create', 'Criar Despesa', 'Permite criar novas despesas');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-2c1234567892', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-e123456789ab', 'expenditure_update', 'Atualizar Despesa', 'Permite atualizar informações de despesas existentes');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-2d1234567893', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-e123456789ab', 'expenditure_delete', 'Excluir Despesa', 'Permite excluir despesas do sistema');

