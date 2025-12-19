import { Static, Type } from '@sinclair/typebox';

export const loginRequestSchema = Type.Object({
  account_id: Type.String(),
});

export type LoginRequest = Static<typeof loginRequestSchema>;
