import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordSendCodeResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
  sent_via_email: Type.Boolean(),
  sent_via_whatsapp: Type.Boolean(),
});

export type AuthForgotPasswordSendCodeResponse = Static<
  typeof authForgotPasswordSendCodeResponseSchema
>;
