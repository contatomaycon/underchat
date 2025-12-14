import { Static, Type } from '@sinclair/typebox';

export const refreshTokenResponseSchema = Type.Object({
  token: Type.String(),
  plan_is_active: Type.Boolean(),
});

export type RefreshTokenResponse = Static<typeof refreshTokenResponseSchema>;
