import { Static, Type } from '@sinclair/typebox';

export const refreshTokenResponseSchema = Type.Object({
  token: Type.String(),
});

export type RefreshTokenResponse = Static<typeof refreshTokenResponseSchema>;
