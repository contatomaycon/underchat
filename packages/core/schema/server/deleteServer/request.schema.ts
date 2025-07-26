import { Static, Type } from '@sinclair/typebox';

export const deleteServerRequestSchema = Type.Object({
  server_id: Type.Number(),
});

export type DeleteServerRequest = Static<typeof deleteServerRequestSchema>;
