import { Static, Type } from '@sinclair/typebox';

export const messageHistoryParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  message_id: Type.String(),
});
export const messageHistoryQuerySchema = Type.Object({});
export const messageHistoryBodySchema = Type.Object({});

export type MessageHistoryParams = Static<typeof messageHistoryParamsSchema>;
