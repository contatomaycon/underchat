import { Static, Type } from '@sinclair/typebox';

export const generateReportConversationHistoryPdfResponseSchema = Type.Object({
  pdf_id: Type.String({ format: 'uuid' }),
  status: Type.String(),
});

export type GenerateReportConversationHistoryPdfResponse = Static<
  typeof generateReportConversationHistoryPdfResponseSchema
>;
