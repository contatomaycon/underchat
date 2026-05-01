import { Static, Type } from '@sinclair/typebox';

export const deleteMessageParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});
export const deleteMessageQuerySchema = Type.Object({});
export const deleteMessageBodySchema = Type.Object({});

export type DeleteMessageParams = Static<typeof deleteMessageParamsSchema>;
