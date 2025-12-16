import { Static, Type } from '@sinclair/typebox';

export const authRegisterSendTwoFactorRequestSchema = Type.Object({
  name: Type.String(),
  email: Type.String(),
  phone_ddi: Type.String(),
  phone_ddd: Type.Optional(Type.String()),
  phone: Type.String(),
});

export type AuthRegisterSendTwoFactorRequest = Static<
  typeof authRegisterSendTwoFactorRequestSchema
>;
