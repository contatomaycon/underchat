import { Static, Type } from '@sinclair/typebox';

export const updateNotificationsRequestSchema = Type.Object({
  two_factor_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  two_factor_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  two_factor_whatsapp_enabled: Type.Optional(Type.Boolean()),
  two_factor_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  two_factor_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  two_factor_email_enabled: Type.Optional(Type.Boolean()),
  plan_new_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_new_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_new_whatsapp_enabled: Type.Optional(Type.Boolean()),
  plan_new_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_new_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_new_email_enabled: Type.Optional(Type.Boolean()),
  plan_renewal_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_renewal_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_renewal_whatsapp_enabled: Type.Optional(Type.Boolean()),
  plan_renewal_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_renewal_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_renewal_email_enabled: Type.Optional(Type.Boolean()),
  plan_expiration_reminder: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_expiration_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_expiration_whatsapp_enabled: Type.Optional(Type.Boolean()),
  plan_expiration_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_expiration_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_expiration_email_enabled: Type.Optional(Type.Boolean()),
  plan_cancellation_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  plan_cancellation_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_cancellation_whatsapp_enabled: Type.Optional(Type.Boolean()),
  plan_cancellation_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_cancellation_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  plan_cancellation_email_enabled: Type.Optional(Type.Boolean()),
  recurring_payment_failure_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  recurring_payment_failure_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  recurring_payment_failure_whatsapp_enabled: Type.Optional(Type.Boolean()),
  recurring_payment_failure_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  recurring_payment_failure_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  recurring_payment_failure_email_enabled: Type.Optional(Type.Boolean()),
  test_plan_new_notification: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  test_plan_new_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_new_whatsapp_enabled: Type.Optional(Type.Boolean()),
  test_plan_new_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_new_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_new_email_enabled: Type.Optional(Type.Boolean()),
  test_plan_expiration_reminder: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
  ),
  test_plan_expiration_message_whatsapp: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_expiration_whatsapp_enabled: Type.Optional(Type.Boolean()),
  test_plan_expiration_message_email: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_expiration_email_subject: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  test_plan_expiration_email_enabled: Type.Optional(Type.Boolean()),
});

export type UpdateNotificationsRequest = Static<
  typeof updateNotificationsRequestSchema
>;
