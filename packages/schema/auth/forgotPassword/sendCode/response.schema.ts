import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordSendCodeResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
});

export type AuthForgotPasswordSendCodeResponse = Static<
  typeof authForgotPasswordSendCodeResponseSchema
>;
