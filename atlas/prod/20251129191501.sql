INSERT INTO "permission_action_groups" ("permission_action_group_id", "name", "description", "action") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea08', 'Chatbox', 'Grupo de permissões relacionadas a chatbox', 'chatbox_group');

INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea09', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea08', 'chatbox_group', 'Grupo Chatbox', 'Permite acesso ao grupo de funcionalidades de chatbox');

INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES 
  ('019ab757-12dc-73f9-a82c-befc9e6fea0a', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea08', 'chatbox_access', 'Acesso a Chatbox', 'Permite acesso completo a todas as funcionalidades de chatbox');

