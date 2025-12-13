import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryPdfResponseSchema = Type.Object({
  pdf_id: Type.String({ format: 'uuid' }),
  url_pdf: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  requested_at: Type.Union([Type.String(), Type.Null()]),
  generated_at: Type.Union([Type.String(), Type.Null()]),
});

export type ViewReportConversationHistoryPdfResponse = Static<
  typeof viewReportConversationHistoryPdfResponseSchema
>;
