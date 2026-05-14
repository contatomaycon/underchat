import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordSendCodeResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
  sent_via_email: Type.Boolean(),
  sent_via_whatsapp: Type.Boolean(),
  validation_id: Type.String({ format: 'uuid' }),
  validation_text: Type.String(),
  whatsapp_url: Type.String(),
  target_phone: Type.String(),
  centrifugo_url: Type.String(),
  centrifugo_token: Type.String(),
  centrifugo_channel: Type.String(),
});

export type AuthForgotPasswordSendCodeResponse = Static<
  typeof authForgotPasswordSendCodeResponseSchema
>;
