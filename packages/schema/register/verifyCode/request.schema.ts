import { Static, Type } from '@sinclair/typebox';

export const authRegisterVerifyCodeRequestSchema = Type.Object({
  code: Type.String(),
});

export type AuthRegisterVerifyCodeRequest = Static<
  typeof authRegisterVerifyCodeRequestSchema
>;
