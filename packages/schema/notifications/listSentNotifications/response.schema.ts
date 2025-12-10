import { pagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { Static, Type } from '@sinclair/typebox';

export const listSentNotificationsResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  notification_id: Type.String({ format: 'uuid' }),
  notification_type: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
  }),
  account: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.Union([Type.String(), Type.Null()]),
  }),
  worker: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.Union([Type.String(), Type.Null()]),
  }),
  name: Type.Union([Type.String(), Type.Null()]),
  phone: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  message_whatsapp: Type.Union([Type.String(), Type.Null()]),
  message_email: Type.Union([Type.String(), Type.Null()]),
  email_subject: Type.Union([Type.String(), Type.Null()]),
  date: Type.String(),
});

export const listSentNotificationsFinalResponseSchema = Type.Object({
  ...pagingResponseSchema.properties,
  results: Type.Array(listSentNotificationsResponseSchema),
});

export type ListSentNotificationsResponse = Static<
  typeof listSentNotificationsResponseSchema
>;

export type ListSentNotificationsFinalResponse = Static<
  typeof listSentNotificationsFinalResponseSchema
>;
