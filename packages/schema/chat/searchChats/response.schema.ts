import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { listChatsResultSchema } from '@core/schema/chat/listChats/response.schema';

export const searchChatsResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChatsResultSchema),
});

export type SearchChatsResponse = Static<typeof searchChatsResponseSchema>;
