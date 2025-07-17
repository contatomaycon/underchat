import { Static, Type } from '@sinclair/typebox';

export const createServerResponseSchema = Type.Object({
  server_id: Type.Number(),
});

export type CreateServerResponse = Static<typeof createServerResponseSchema>;
