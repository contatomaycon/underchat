import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordVerifyCodeRequestSchema = Type.Object({
  code: Type.String(),
});

export type AuthForgotPasswordVerifyCodeRequest = Static<
  typeof authForgotPasswordVerifyCodeRequestSchema
>;
