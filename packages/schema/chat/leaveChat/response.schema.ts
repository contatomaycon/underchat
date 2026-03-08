import { Static } from '@sinclair/typebox';
import { listChatsResultSchema } from '@core/schema/chat/listChats/response.schema';

export const leaveChatResponseSchema = listChatsResultSchema;

export type LeaveChatResponse = Static<typeof leaveChatResponseSchema>;
