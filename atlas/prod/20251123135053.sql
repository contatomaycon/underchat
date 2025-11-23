-- Insert permission action group for Expenditures
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019ab1a0-4d94-74e4-b3f2-027c7ab10a2a', 'Despesas', 'Grupo de permissões relacionadas a despesas', 'expenditure_group');

-- Insert permission actions for Expenditures
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab1a0-4d96-73ea-ad8e-fbb3c34bdd9f', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab1a0-4d94-74e4-b3f2-027c7ab10a2a', 'expenditure_view', 'Visualizar Despesas', 'Permite visualizar, listar e buscar informações de despesas'),
  ('019ab1a0-4d96-73ea-ad8e-fd3e4dcbd7bb', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab1a0-4d94-74e4-b3f2-027c7ab10a2a', 'expenditure_create', 'Criar Despesa', 'Permite criar novas despesas'),
  ('019ab1a0-4d96-73ea-ad8f-030ecd7196f4', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab1a0-4d94-74e4-b3f2-027c7ab10a2a', 'expenditure_update', 'Atualizar Despesa', 'Permite atualizar despesas existentes'),
  ('019ab1a0-4d96-73ea-ad8f-0663b35f8237', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab1a0-4d94-74e4-b3f2-027c7ab10a2a', 'expenditure_delete', 'Excluir Despesa', 'Permite excluir despesas');

-- Insert permission action group for Financial Reports
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019ab1a0-4d96-73ea-ad8f-091405428093', 'Relatórios', 'Grupo de permissões relacionadas a relatórios financeiros', 'financial_group');

-- Insert permission action for Financial Reports
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab1a0-4d96-73ea-ad8f-0e08cdd7b9ea', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab1a0-4d96-73ea-ad8f-091405428093', 'financial_view', 'Visualizar Relatórios Financeiros', 'Permite visualizar e acessar relatórios financeiros');

