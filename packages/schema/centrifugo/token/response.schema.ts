import { Static, Type } from '@sinclair/typebox';

export const authTokenResponseSchema = Type.Object({
  token: Type.String(),
  url: Type.String(),
});

export type AuthTokenResponse = Static<typeof authTokenResponseSchema>;
