import { Static, Type } from '@sinclair/typebox';

export const generateReportConversationHistoryPdfParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export type GenerateReportConversationHistoryPdfParams = Static<
  typeof generateReportConversationHistoryPdfParamsSchema
>;
