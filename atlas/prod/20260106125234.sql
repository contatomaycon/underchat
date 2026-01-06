-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('8ecc9be3-2be1-456f-b178-16eb09698390', 'Agente de IA', 'Grupo de permissões relacionadas a agentes de IA', 'ai_agent_group');

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('6d0233d9-bf57-46de-b18a-fe03b4f5e2c5', '019a930d-c6f6-766d-9c83-914b7faa4337', '8ecc9be3-2be1-456f-b178-16eb09698390', 'ai_agent_view', 'Visualizar Agente de IA', 'Permite visualizar, listar e buscar informações detalhadas de agentes de IA');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('62770c44-f679-4468-b024-2fb95382a3fc', '019a930d-c6f6-766d-9c83-914b7faa4337', '8ecc9be3-2be1-456f-b178-16eb09698390', 'ai_agent_create', 'Criar Agente de IA', 'Permite criar novos agentes de IA');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('8962a18e-df2b-4fcc-b50c-ada033cf7536', '019a930d-c6f6-766d-9c83-914b7faa4337', '8ecc9be3-2be1-456f-b178-16eb09698390', 'ai_agent_update', 'Atualizar Agente de IA', 'Permite atualizar informações de agentes de IA existentes');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('b6ae1852-1017-4158-be4a-0c4ef2eb250b', '019a930d-c6f6-766d-9c83-914b7faa4337', '8ecc9be3-2be1-456f-b178-16eb09698390', 'ai_agent_delete', 'Excluir Agente de IA', 'Permite excluir agentes de IA do sistema');