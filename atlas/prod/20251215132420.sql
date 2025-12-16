-- Insert permission action group
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019a930d-c6f6-766d-9c83-f234567890cd', 'Agendamentos', 'Grupo de permissões relacionadas a agendamentos', 'schedule_group');

-- Insert permission actions
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-4a1234567890', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-f234567890cd', 'schedule_view', 'Visualizar Agendamento', 'Permite visualizar, listar e buscar informações detalhadas de agendamentos');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-4b1234567891', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-f234567890cd', 'schedule_create', 'Criar Agendamento', 'Permite criar novos agendamentos');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-4c1234567892', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-f234567890cd', 'schedule_update', 'Atualizar Agendamento', 'Permite atualizar informações de agendamentos existentes');
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019a930d-c6f8-7526-872d-4d1234567893', '019a930d-c6f6-766d-9c83-914b7faa4337', '019a930d-c6f6-766d-9c83-f234567890cd', 'schedule_delete', 'Excluir Agendamento', 'Permite excluir agendamentos do sistema');