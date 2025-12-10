import { Static, Type } from '@sinclair/typebox';

const whatsappSchema = Type.Object({
  worker_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
});

const emailSchema = Type.Object({
  subject: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
});

const notificationSchema = Type.Object({
  whatsapp: Type.Union([whatsappSchema, Type.Null()]),
  email: Type.Union([emailSchema, Type.Null()]),
});

export const updateNotificationsResponseSchema = Type.Object({
  notification_id: Type.String({ format: 'uuid' }),
  two_factor_notification: Type.Union([notificationSchema, Type.Null()]),
  plan_new_notification: Type.Union([notificationSchema, Type.Null()]),
  plan_renewal_notification: Type.Union([notificationSchema, Type.Null()]),
  plan_expiration_reminder: Type.Union([notificationSchema, Type.Null()]),
  plan_cancellation_notification: Type.Union([notificationSchema, Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateNotificationsResponse = Static<
  typeof updateNotificationsResponseSchema
>;
