import { pagingRequestSchema } from '@core/schema/common/pagingRequestSchema';
import { Static, Type } from '@sinclair/typebox';

export const searchInternalChatMessagesParamsSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
});

export const searchInternalChatMessagesQuerySchema = Type.Object({
  search: Type.String({ minLength: 3 }),
  ...pagingRequestSchema.properties,
});

export const searchInternalChatMessagesBodySchema = Type.Object({});

export type SearchInternalChatMessagesParams = Static<
  typeof searchInternalChatMessagesParamsSchema
>;
export type SearchInternalChatMessagesQuery = Static<
  typeof searchInternalChatMessagesQuerySchema
>;
