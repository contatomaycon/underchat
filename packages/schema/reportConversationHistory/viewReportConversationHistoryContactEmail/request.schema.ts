import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryContactEmailParamsSchema =
  Type.Object({
    contact_id: Type.String({ format: 'uuid' }),
  });

export type ViewReportConversationHistoryContactEmailParams = Static<
  typeof viewReportConversationHistoryContactEmailParamsSchema
>;
