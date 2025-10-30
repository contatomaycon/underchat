import { Static, Type } from '@sinclair/typebox';

export const viewServerRequestSchema = Type.Object({
  server_id: Type.String(),
});

export type ViewServerRequest = Static<typeof viewServerRequestSchema>;
