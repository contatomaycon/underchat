import { Static, Type } from '@sinclair/typebox';

export const listReportConversationHistoryMessagesRequestSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type ListReportConversationHistoryMessagesRequest = Static<
  typeof listReportConversationHistoryMessagesRequestSchema
>;
