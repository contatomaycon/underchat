import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryContactParamsSchema = Type.Object({
  contact_id: Type.String({ format: 'uuid' }),
});

export type ViewReportConversationHistoryContactParams = Static<
  typeof viewReportConversationHistoryContactParamsSchema
>;
