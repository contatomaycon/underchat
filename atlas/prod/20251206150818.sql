-- Insert seed "notifications" table
INSERT INTO "notifications" ("notification_id", "worker_id", "notification_type_id", "message_whatsapp", "message_email", "email_subject", "created_at", "updated_at") VALUES 
  ('019af452-fbee-73bd-b907-8a0868804faa', NULL, '019a930d-c6f4-75ad-88ff-9a1b2c3d4e8e', 'Olá *{{name}}*, segue seu código de autenticação: *{{code}}*.', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Código de Autenticação - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600;">Olá, {{name}}!</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Segue seu código de autenticação de dois fatores:</p>
                            <div style="background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 8px; padding: 30px; text-align: center; margin: 30px 0;">
                                <p style="margin: 0 0 10px; color: #666666; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Código de Autenticação</p>
                                <p style="margin: 0; color: #667eea; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: ''Courier New'', monospace;">{{code}}</p>
                            </div>
                            <p style="margin: 30px 0 0; color: #999999; font-size: 14px; line-height: 1.6;">Este código é válido por alguns minutos. Não compartilhe este código com ninguém.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Se você não solicitou este código, ignore este e-mail.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Código de Autenticação - Underchat', '2025-12-06 15:41:10.509183 +00:00', '2025-12-06 15:41:10.509183 +00:00'),
  ('019af454-425c-7431-b3f1-3caf6f60a8c8', NULL, '019a930d-c6f4-75ad-88ff-9b2c3d4e5f8e', '🎉 Parabéns, {{name}}!

Seu plano *{{plan}}* está ativo.

Valor: R$ {{value}}

Vencimento: {{expiration_date}}

Bem-vindo ao Underchat!', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bem-vindo ao Underchat!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">🎉</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Parabéns, {{name}}!</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Seu plano <strong style="color: #667eea;">{{plan}}</strong> está ativo!</p>
                            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #dee2e6;">
                                            <strong style="color: #333333;">Plano:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #dee2e6;">
                                            {{plan}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #dee2e6;">
                                            <strong style="color: #333333;">Valor:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #28a745; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #dee2e6;">
                                            R$ {{value}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">Vencimento:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            {{expiration_date}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Bem-vindo ao Underchat! Estamos felizes em tê-lo conosco.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Obrigado por escolher o Underchat!</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Bem-vindo ao Underchat! Seu plano está ativo', '2025-12-06 15:42:34.073439 +00:00', '2025-12-06 15:42:34.073439 +00:00'),
  ('019af454-d929-73e2-a4ac-ee62a7347a59', NULL, '019a930d-c6f4-75ad-88ff-9c3d4e5f6a8e', '⏰ *Lembrete de Vencimento*

Olá, {{name}}!

Seu plano *{{plan}}* está próximo do vencimento.

📅 *Data de vencimento:* {{expiration_date}}

💰 *Valor:* R$ {{value}}

Para continuar aproveitando todos os recursos, não esqueça de renovar antes da data de vencimento.

Qualquer dúvida, estamos à disposição! 😊

*Equipe Underchat*', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lembrete de Vencimento - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">⏰</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Lembrete de Vencimento</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Seu plano <strong style="color: #ff9800;">{{plan}}</strong> está próximo do vencimento.</p>
                            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffe69c 100%); border-left: 4px solid #ff9800; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #ffc107;">
                                            <strong style="color: #333333;">📅 Data de vencimento:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #d32f2f; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #ffc107;">
                                            {{expiration_date}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">💰 Valor:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            R$ {{value}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0; color: #666666; font-size: 16px; line-height: 1.6;">Para continuar aproveitando todos os recursos, não esqueça de renovar antes da data de vencimento.</p>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6;">Qualquer dúvida, estamos à disposição! 😊</p>
                            <p style="margin: 20px 0 0; color: #333333; font-size: 16px; font-weight: 600; text-align: center;">Equipe Underchat</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Este é um lembrete automático. Para renovar seu plano, acesse sua conta.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Lembrete de Vencimento - Underchat', '2025-12-06 15:43:12.676611 +00:00', '2025-12-06 15:43:12.676611 +00:00'),
  ('6a1a25dd-5f95-451b-a30b-8bc8eca23e45', NULL, '019a930d-c6f4-75ad-88ff-9d4e5f6a7b8e', '🔄 *Renovação de Plano*

Olá, {{name}}!

Seu plano *{{plan}}* foi renovado com sucesso!

Valor: R$ {{value}}

Próximo vencimento: {{expiration_date}}

Obrigado por continuar conosco!', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Renovação de Plano - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">🔄</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Renovação de Plano</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Seu plano <strong style="color: #28a745;">{{plan}}</strong> foi renovado com sucesso!</p>
                            <div style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); border-left: 4px solid #28a745; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #28a745;">
                                            <strong style="color: #333333;">Plano:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #28a745;">
                                            {{plan}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #28a745;">
                                            <strong style="color: #333333;">Valor:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #28a745; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #28a745;">
                                            R$ {{value}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">Próximo vencimento:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            {{expiration_date}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Obrigado por continuar conosco!</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Esta é uma renovação automática do seu plano.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Renovação de Plano - Underchat', '2025-12-06 15:44:00.000000 +00:00', '2025-12-06 15:44:00.000000 +00:00'),
  ('019af456-7890-1234-abcd-ef1234567890', NULL, '019a930d-c6f4-75ad-88ff-9e5f6a7b8c9e', '⚠️ *Cancelamento de Plano*
Olá, {{name}}!
Seu plano *{{plan}}* foi cancelado.
Data de cancelamento: {{expiration_date}}
Seu acesso permanecerá ativo até a data de vencimento.', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cancelamento de Plano - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">⚠️</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Cancelamento de Plano</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Seu plano <strong style="color: #dc3545;">{{plan}}</strong> foi cancelado.</p>
                            <div style="background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); border-left: 4px solid #dc3545; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #dc3545;">
                                            <strong style="color: #333333;">Plano:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #dc3545;">
                                            {{plan}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">Data de cancelamento:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            {{expiration_date}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Seu acesso permanecerá ativo até a data de vencimento.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Se você não solicitou este cancelamento, entre em contato conosco.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Cancelamento de Plano - Underchat', '2025-12-06 15:45:00.000000 +00:00', '2025-12-06 15:45:00.000000 +00:00'),
  ('019af457-8901-2345-bcde-f12345678901', NULL, '019a930d-c6f4-75ad-88ff-9f6a7b8c9d0e', '❌ *Falha no Pagamento em Recorrência*
Olá, {{name}}!
Ocorreu uma falha no pagamento automático do seu plano *{{plan}}*.
Valor: R$ {{value}}
Por favor, verifique seus dados de pagamento e tente novamente.', '<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Falha no Pagamento em Recorrência - Underchat</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, ''Helvetica Neue'', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 40px 30px; text-align: center; background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); border-radius: 8px 8px 0 0;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Underchat</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <span style="font-size: 60px;">❌</span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600; text-align: center;">Falha no Pagamento em Recorrência</h2>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Olá, {{name}}!</p>
                            <p style="margin: 0 0 30px; color: #666666; font-size: 16px; line-height: 1.6;">Ocorreu uma falha no pagamento automático do seu plano <strong style="color: #dc3545;">{{plan}}</strong>.</p>
                            <div style="background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); border-left: 4px solid #dc3545; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px; border-bottom: 1px solid #dc3545;">
                                            <strong style="color: #333333;">Plano:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right; border-bottom: 1px solid #dc3545;">
                                            {{plan}}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 10px 0; color: #666666; font-size: 16px;">
                                            <strong style="color: #333333;">Valor:</strong>
                                        </td>
                                        <td style="padding: 10px 0; color: #333333; font-size: 16px; font-weight: 600; text-align: right;">
                                            R$ {{value}}
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            <p style="margin: 30px 0 0; color: #666666; font-size: 16px; line-height: 1.6; text-align: center;">Por favor, verifique seus dados de pagamento e tente novamente.</p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">Se você não reconhece esta tentativa de pagamento, entre em contato conosco imediatamente.</p>
                            <p style="margin: 10px 0 0; color: #999999; font-size: 12px;">© 2025 Underchat. Todos os direitos reservados.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>', 'Falha no Pagamento em Recorrência - Underchat', '2025-12-06 15:46:00.000000 +00:00', '2025-12-06 15:46:00.000000 +00:00')
ON CONFLICT ("notification_id") DO NOTHING;