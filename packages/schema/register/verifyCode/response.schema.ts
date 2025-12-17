import { Static, Type } from '@sinclair/typebox';

export const authRegisterVerifyCodeResponseSchema = Type.Object({
  token: Type.String(),
});

export type AuthRegisterVerifyCodeResponse = Static<
  typeof authRegisterVerifyCodeResponseSchema
>;
