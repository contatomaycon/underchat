-- Insert seed "notifications" table
INSERT INTO "notifications" ("notification_id", "worker_id", "notification_type_id", "message_whatsapp", "message_email", "created_at", "updated_at") VALUES 
  ('019af452-fbee-73bd-b907-8a0868804faa', NULL, '019a930d-c6f4-75ad-88ff-9a1b2c3d4e8e', 'Olá *{{name}}*, segue seu código de autenticação: *{{code}}*.', NULL, '2025-12-06 15:41:10.509183 +00:00', '2025-12-06 15:41:10.509183 +00:00'),
  ('019af454-425c-7431-b3f1-3caf6f60a8c8', NULL, '019a930d-c6f4-75ad-88ff-9b2c3d4e5f8e', '🎉 Parabéns, {{name}}!

Seu plano *{{plan}}* está ativo.

Valor: R$ {{value}}

Vencimento: {{expiration_date}}

Bem-vindo ao Underchat!', NULL, '2025-12-06 15:42:34.073439 +00:00', '2025-12-06 15:42:34.073439 +00:00'),
  ('019af454-d929-73e2-a4ac-ee62a7347a59', NULL, '019a930d-c6f4-75ad-88ff-9c3d4e5f6a8e', '⏰ *Lembrete de Vencimento*

Olá, {{name}}!

Seu plano *{{plan}}* está próximo do vencimento.

📅 *Data de vencimento:* {{expiration_date}}

💰 *Valor:* R$ {{value}}

Para continuar aproveitando todos os recursos, não esqueça de renovar antes da data de vencimento.

Qualquer dúvida, estamos à disposição! 😊

*Equipe Underchat*', NULL, '2025-12-06 15:43:12.676611 +00:00', '2025-12-06 15:43:12.676611 +00:00')
ON CONFLICT ("notification_id") DO NOTHING;