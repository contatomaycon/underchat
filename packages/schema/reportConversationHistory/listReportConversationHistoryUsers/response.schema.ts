import { Static, Type } from '@sinclair/typebox';

export const reportConversationHistoryUserSchema = Type.Object({
  user_id: Type.String({ format: 'uuid' }),
  first_name: Type.Union([Type.String(), Type.Null()]),
  last_name: Type.Union([Type.String(), Type.Null()]),
});

export const listReportConversationHistoryUsersResponseSchema = Type.Object({
  users: Type.Array(reportConversationHistoryUserSchema),
});

export type ListReportConversationHistoryUsersResponse = Static<
  typeof listReportConversationHistoryUsersResponseSchema
>;
