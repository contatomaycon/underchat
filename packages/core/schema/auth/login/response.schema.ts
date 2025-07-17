import { Static, Type } from '@sinclair/typebox';

export const authLoginResponseSchema = Type.Object({
  user_id: Type.Number(),
});

export type AuthLoginResponse = Static<typeof authLoginResponseSchema>;
