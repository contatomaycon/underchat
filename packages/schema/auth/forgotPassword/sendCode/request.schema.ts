import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordSendCodeRequestSchema = Type.Object({
  email: Type.String(),
});

export type AuthForgotPasswordSendCodeRequest = Static<
  typeof authForgotPasswordSendCodeRequestSchema
>;
