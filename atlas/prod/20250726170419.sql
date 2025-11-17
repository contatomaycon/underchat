-- Insert permission action groups
INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('a1b2c3d4-e5f6-4789-a012-3456789abcde', 'Servidores', 'Grupo de permissões relacionadas a servidores', 'server_group'),
  ('b2c3d4e5-f6a7-4890-b123-456789abcdef', 'Usuários', 'Grupo de permissões relacionadas a usuários', 'user_group'),
  ('c3d4e5f6-a7b8-4901-c234-56789abcdef0', 'Contatos', 'Grupo de permissões relacionadas a contatos', 'contact_group'),
  ('32843ba3-a0d9-4e31-8f02-088951ec83a5', 'Grupos de Contatos', 'Grupo de permissões relacionadas a grupos de contatos', 'contact_group_assignment_group'),
  ('e5f6a7b8-c9d0-4123-e456-789abcdef012', 'Cargos', 'Grupo de permissões relacionadas a cargos e permissões', 'role_group'),
  ('f6a7b8c9-d0e1-4234-f567-89abcdef0123', 'Planos', 'Grupo de permissões relacionadas a planos', 'plan_group'),
  ('a7b8c9d0-e1f2-4345-a678-9abcdef01234', 'Templates de Mensagem', 'Grupo de permissões relacionadas a templates de mensagens', 'message_template_group'),
  ('b8c9d0e1-f2a3-4456-b789-abcdef012345', 'Templates de Etiqueta', 'Grupo de permissões relacionadas a templates de etiquetas', 'label_template_group'),
  ('c9d0e1f2-a3b4-4567-c890-def012345678', 'Chats', 'Grupo de permissões relacionadas a chats', 'chat_group'),
  ('d0e1f2a3-b4c5-4678-d901-ef0123456789', 'Contas', 'Grupo de permissões relacionadas a contas', 'account_group'),
  ('e1f2a3b4-c5d6-4789-e012-f01234567890', 'Setores', 'Grupo de permissões relacionadas a setores', 'sector_group'),
  ('f2a3b4c5-d6e7-4890-f123-0123456789ab', 'Workers', 'Grupo de permissões relacionadas a workers', 'worker_group'),
  ('a3b4c5d6-e7f8-4901-a234-123456789abc', 'Home', 'Grupo de permissões relacionadas à página inicial', 'home_group'),
  ('b4c5d6e7-f8a9-4012-b345-23456789abcd', 'Acesso Total', 'Grupo de permissões de acesso total', 'full_access_group'),
  ('c5d6e7f8-a9b0-4123-c456-3456789abcde', 'CEP', 'Grupo de permissões relacionadas a CEP', 'zipcode_group'),
  ('d6e7f8a9-b0c1-4234-d567-456789abcdef', 'Métricas', 'Grupo de permissões relacionadas a métricas', 'metrics_group');

