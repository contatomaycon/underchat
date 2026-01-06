import { Static, Type } from '@sinclair/typebox';

export const sessionLoginRequestSchema = Type.Object({
  user_id: Type.String(),
});

export type SessionLoginRequest = Static<typeof sessionLoginRequestSchema>;
