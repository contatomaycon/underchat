import { Static, Type } from '@sinclair/typebox';

export const authLoginRequestSchema = Type.Object({
  login: Type.String(),
  password: Type.String({ minLength: 4 }),
});

export type AuthLoginRequest = Static<typeof authLoginRequestSchema>;
