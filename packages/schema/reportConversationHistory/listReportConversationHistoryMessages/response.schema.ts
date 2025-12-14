import { Static, Type } from '@sinclair/typebox';
import { listMessageResultSchema } from '@core/schema/chat/listMessageChats/response.schema';

export const listReportConversationHistoryMessagesResponseSchema = Type.Object({
  messages: Type.Array(listMessageResultSchema),
});

export type ListReportConversationHistoryMessagesResponse = Static<
  typeof listReportConversationHistoryMessagesResponseSchema
>;
