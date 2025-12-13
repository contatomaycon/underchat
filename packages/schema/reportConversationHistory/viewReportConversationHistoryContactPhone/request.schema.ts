import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryContactPhoneParamsSchema =
  Type.Object({
    contact_id: Type.String({ format: 'uuid' }),
  });

export type ViewReportConversationHistoryContactPhoneParams = Static<
  typeof viewReportConversationHistoryContactPhoneParamsSchema
>;
