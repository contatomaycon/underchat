import { Static, Type } from '@sinclair/typebox';
import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { listChatsResultSchema } from '@core/schema/chat/listChats/response.schema';

export const searchChatsResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listChatsResultSchema),
  counts: Type.Object({
    total: Type.Number(),
    queue: Type.Number(),
    in_chat: Type.Number(),
    chatbot: Type.Number(),
    schedule: Type.Number(),
    closed: Type.Number(),
    my_chats: Type.Number(),
    in_chat_mine: Type.Number(),
    chatbot_input: Type.Number(),
    chatbot_output: Type.Number(),
    chatbot_schedule: Type.Number(),
    chatbot_webhook: Type.Number(),
  }),
});

export type SearchChatsResponse = Static<typeof searchChatsResponseSchema>;
