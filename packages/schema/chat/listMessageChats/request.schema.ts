import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const listMessageChatsQuerySchema = Type.Object({
  ...pagingRequestSchema.properties,
});

export const listMessageChatsParamsSchema = Type.Object({
  chat_id: Type.String(),
});

export type ListMessageChatsQuery = Static<typeof listMessageChatsQuerySchema>;
export type ListMessageChatsParams = Static<
  typeof listMessageChatsParamsSchema
>;
