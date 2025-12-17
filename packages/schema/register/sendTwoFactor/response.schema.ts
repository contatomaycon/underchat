import { Static, Type } from '@sinclair/typebox';

export const authRegisterSendTwoFactorResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
});

export type AuthRegisterSendTwoFactorResponse = Static<
  typeof authRegisterSendTwoFactorResponseSchema
>;
