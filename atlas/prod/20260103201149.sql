-- Insert seed "notifications" table
INSERT INTO "notifications" ("notification_id", "worker_id", "notification_type_id", "message_whatsapp", "message_email", "email_subject", "created_at", "updated_at") VALUES 
  ('019af458-a1b2-3456-cdef-123456789012', NULL, '019b8636-2555-774c-a3e3-db0296fef619', '🎉 *Novo Plano de Teste Ativado*

Olá, {{name}}!

Seu plano de teste foi criado e está ativo.

Plano: *{{plan}}*

Aproveite para testar todos os recursos do Underchat! 😊', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Novo Plano de Teste - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">🎉</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Novo Plano de Teste Ativado</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Seu plano de teste foi criado e está ativo!</p>
                            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">Plano:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            {{plan}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Aproveite para testar todos os recursos do Underchat! 😊</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Obrigado por testar o Underchat!</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Novo Plano de Teste - Underchat', '2025-12-06 15:47:00.000000 +00:00', '2025-12-06 15:47:00.000000 +00:00'),
  ('019af458-b2c3-4567-def0-234567890123', NULL, '019b8636-2556-7341-bd6e-7714c9158286', '⏰ *Lembrete de Vencimento do Plano de Teste*

Olá, {{name}}!

Seu plano de teste *{{plan}}* está próximo do vencimento.

📅 *Data de vencimento:* {{expiration_date}}

Para continuar aproveitando o Underchat, não esqueça de renovar ou fazer upgrade antes da data de vencimento.

Qualquer dúvida, estamos à disposição! 😊

*Equipe Underchat*', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lembrete de Vencimento do Plano de Teste - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">⏰</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Lembrete de Vencimento do Plano de Teste</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Seu plano de teste <strong style="color: #ff9800;">{{plan}}</strong> está próximo do vencimento.</p>
                            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); border-left: 4px solid #ff9800; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">📅 Data de vencimento:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #d32f2f; font-size: 16px; font-weight: 600; text-align: right;">
                                            {{expiration_date}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0; color: #666666; font-size: 16px; line-height: 1.6;">Para continuar aproveitando o Underchat, não esqueça de renovar ou fazer upgrade antes da data de vencimento.</p>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6;">Qualquer dúvida, estamos à disposição! 😊</p>
                            <p style="margin: 20px 0 0; color: #333333; font-size: 16px; font-weight: 600; text-align: center;">Equipe Underchat</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Este é um lembrete automático para o plano de teste. Para renovar ou fazer upgrade, acesse sua conta.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Lembrete de Vencimento do Plano de Teste - Underchat', '2025-12-06 15:48:00.000000 +00:00', '2025-12-06 15:48:00.000000 +00:00')
ON CONFLICT ("notification_id") DO NOTHING;