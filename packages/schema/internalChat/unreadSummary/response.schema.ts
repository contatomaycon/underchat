import { Static, Type } from '@sinclair/typebox';

export const internalChatUnreadSummaryDataSchema = Type.Object({
  unread_count: Type.Integer({ minimum: 0 }),
});

export const internalChatUnreadSummaryResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: internalChatUnreadSummaryDataSchema,
});

export type InternalChatUnreadSummaryData = Static<
  typeof internalChatUnreadSummaryDataSchema
>;
export type InternalChatUnreadSummaryResponse = Static<
  typeof internalChatUnreadSummaryResponseSchema
>;
