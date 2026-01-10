import { Static } from '@sinclair/typebox';
import { authLoginResponseSchema } from '@core/schema/auth/login/response.schema';

export const authForgotPasswordResetPasswordResponseSchema =
  authLoginResponseSchema;

export type AuthForgotPasswordResetPasswordResponse = Static<
  typeof authForgotPasswordResetPasswordResponseSchema
>;
