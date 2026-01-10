import { Static, Type } from '@sinclair/typebox';

export const authForgotPasswordResetPasswordRequestSchema = Type.Object({
  new_password: Type.String({ minLength: 8 }),
  confirm_password: Type.String({ minLength: 8 }),
});

export type AuthForgotPasswordResetPasswordRequest = Static<
  typeof authForgotPasswordResetPasswordRequestSchema
>;
