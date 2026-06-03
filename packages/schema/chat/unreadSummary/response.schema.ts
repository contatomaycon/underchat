import { Static, Type } from '@sinclair/typebox';

export const chatUnreadSummaryDataSchema = Type.Object({
  unread_count: Type.Integer({ minimum: 0 }),
});

export const chatUnreadSummaryResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: chatUnreadSummaryDataSchema,
});

export type ChatUnreadSummaryData = Static<typeof chatUnreadSummaryDataSchema>;
export type ChatUnreadSummaryResponse = Static<
  typeof chatUnreadSummaryResponseSchema
>;
