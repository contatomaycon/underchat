-- Insert permission action for satisfaction report (inside Relatórios group)
INSERT INTO "permission_action" ("permission_action_id", "permission_module_id", "permission_action_group_id", "action", "name", "description") VALUES
  ('019b0f9e-5c72-7860-b8bd-8d28c40ff9f8', '019a930d-c6f6-766d-9c83-914b7faa4337', '019ab757-12dc-73f9-a82c-befc9e6fea0b', 'report_satisfaction_view', 'Visualizar Relatório de Satisfação', 'Permite visualizar e acessar relatórios de satisfação com as respostas dos clientes aos fluxos de chatbot')
ON CONFLICT ("permission_action_id") DO NOTHING;