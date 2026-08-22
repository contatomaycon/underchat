import { Static, Type } from '@sinclair/typebox';

export const createServerResponseSchema = Type.Object({
  server_id: Type.String(),
  installation_id: Type.Optional(Type.String()),
  force_install: Type.Optional(Type.Boolean()),
});

export type CreateServerResponse = Static<typeof createServerResponseSchema>;
