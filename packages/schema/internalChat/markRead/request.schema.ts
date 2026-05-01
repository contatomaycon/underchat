import { Static, Type } from '@sinclair/typebox';

export const markReadParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});
export const markReadQuerySchema = Type.Object({});
export const markReadBodySchema = Type.Object({
  last_read_message_id: Type.Optional(Type.String()),
});

export type MarkReadParams = Static<typeof markReadParamsSchema>;
export type MarkReadBody = Static<typeof markReadBodySchema>;
