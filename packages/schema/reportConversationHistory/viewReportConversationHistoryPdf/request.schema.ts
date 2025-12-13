import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryPdfParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type ViewReportConversationHistoryPdfParams = Static<
  typeof viewReportConversationHistoryPdfParamsSchema
>;
