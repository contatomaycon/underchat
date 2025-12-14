import { Type, Static } from '@sinclair/typebox';

export const deleteReportConversationHistoryPdfParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type DeleteReportConversationHistoryPdfParams = Static<
  typeof deleteReportConversationHistoryPdfParamsSchema
>;
