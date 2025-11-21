import { Static, Type } from '@sinclair/typebox';

export const createServerResponseSchema = Type.Object({
  server_id: Type.String(),
});

export type CreateServerResponse = Static<typeof createServerResponseSchema>;
