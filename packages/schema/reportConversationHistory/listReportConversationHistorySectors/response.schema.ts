import { Static, Type } from '@sinclair/typebox';

export const reportConversationHistorySectorSchema = Type.Object({
  sector_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
});

export const listReportConversationHistorySectorsResponseSchema = Type.Object({
  sectors: Type.Array(reportConversationHistorySectorSchema),
});

export type ListReportConversationHistorySectorsResponse = Static<
  typeof listReportConversationHistorySectorsResponseSchema
>;
