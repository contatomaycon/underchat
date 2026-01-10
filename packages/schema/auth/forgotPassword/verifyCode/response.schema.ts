import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordVerifyCodeResponseSchema = Type.Object({
  token: Type.String(),
  user_id: Type.String(),
  account_id: Type.String(),
});

export type AuthForgotPasswordVerifyCodeResponse = Static<
  typeof authForgotPasswordVerifyCodeResponseSchema
>;
