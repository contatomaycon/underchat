import { Static, Type } from '@sinclair/typebox';

export const viewReportConversationHistoryContactEmailResponseSchema =
  Type.Object({
    email: Type.Union([Type.String(), Type.Null()]),
  });

export type ViewReportConversationHistoryContactEmailResponse = Static<
  typeof viewReportConversationHistoryContactEmailResponseSchema
>;
