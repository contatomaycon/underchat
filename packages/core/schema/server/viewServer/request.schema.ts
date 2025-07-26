import { Static, Type } from '@sinclair/typebox';

export const viewServerRequestSchema = Type.Object({
  server_id: Type.Number(),
});

export type ViewServerRequest = Static<typeof viewServerRequestSchema>;
