import { Static, Type } from '@sinclair/typebox';

export const updateNotificationsRequestSchema = Type.Object({
  two_factor_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  two_factor_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  two_factor_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  two_factor_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_message_email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_email_subject: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  plan_expiration_reminder: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_expiration_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_expiration_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_expiration_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
});

export type UpdateNotificationsRequest = Static<
  typeof updateNotificationsRequestSchema
>;
