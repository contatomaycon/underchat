import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryContactPhoneResponseSchema =
  Type.Object({
    phone: Type.Union([Type.String(), Type.Null()]),
  });

export type ViewReportConversationHistoryContactPhoneResponse = Static<
  typeof viewReportConversationHistoryContactPhoneResponseSchema
>;
