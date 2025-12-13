import { Static, Type } from '@sinclair/typebox';

export const downloadReportConversationHistoryPdfParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type DownloadReportConversationHistoryPdfParams = Static<
  typeof downloadReportConversationHistoryPdfParamsSchema
>;
