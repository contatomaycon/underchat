-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019a930d-c6f6-766d-9c83-f123456789ab', 'Financeiro', 'Grupo de permissões relacionadas a relatórios financeiros', 'financial_group');

-- Insert permission action
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-3f1234567890', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-f123456789ab', 'financial_view', 'Visualizar Relatório Financeiro', 'Permite visualizar e acessar relatórios financeiros com informações de receitas, despesas e movimentações');

