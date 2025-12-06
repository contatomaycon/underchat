import { Static, Type } from '@sinclair/typebox';

const workerSchema = Type.Object({
  worker_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  name: Type.Union([Type.String(), Type.Null()]),
  message: Type.Union([Type.String(), Type.Null()]),
});

export const updateNotificationsResponseSchema = Type.Object({
  notification_id: Type.String({ format: 'uuid' }),
  two_factor_notification: Type.Union([workerSchema, Type.Null()]),
  plan_notification: Type.Union([workerSchema, Type.Null()]),
  plan_expiration_reminder: Type.Union([workerSchema, Type.Null()]),
  created_at: Type.Union([Type.String(), Type.Null()]),
  updated_at: Type.Union([Type.String(), Type.Null()]),
});

export type UpdateNotificationsResponse = Static<
  typeof updateNotificationsResponseSchema
>;
