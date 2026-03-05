import { Static } from '@sinclair/typebox';
import { listChatsResultSchema } from '@core/schema/chat/listChats/response.schema';

export const joinChatResponseSchema = listChatsResultSchema;

export type JoinChatResponse = Static<typeof joinChatResponseSchema>;
