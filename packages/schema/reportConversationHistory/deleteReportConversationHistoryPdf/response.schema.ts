import { Type, Static } from '@sinclair/typebox';

export const deleteReportConversationHistoryPdfResponseSchema = Type.Object({
  deleted: Type.Boolean(),
});

export type DeleteReportConversationHistoryPdfResponse = Static<
  typeof deleteReportConversationHistoryPdfResponseSchema
>;
