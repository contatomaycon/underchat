import { Type } from '@sinclair/typebox';

export const officialWindowSchema = Type.Object({
  is_official: Type.Literal(true),
  state: Type.Union([
    Type.Literal('open'),
    Type.Literal('closed'),
    Type.Literal('awaiting_contact_reply'),
    Type.Literal('send_uncertain'),
  ]),
  reason: Type.Union([
    Type.Literal('customer_service_window_open'),
    Type.Literal('customer_reply_required'),
    Type.Literal('customer_service_window_closed'),
    Type.Literal('no_customer_message'),
    Type.Literal('meta_reengagement'),
    Type.Literal('template_pending'),
    Type.Literal('template_failed'),
    Type.Literal('template_send_uncertain'),
  ]),
  can_send_freeform: Type.Boolean(),
  can_send_template: Type.Boolean(),
  service_window_started_at: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  last_inbound_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  service_window_expires_at: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  awaiting_contact_reply_since: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  awaiting_contact_reply_expires_at: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  awaiting_template_message_id: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  last_template_sent_at: Type.Optional(
    Type.Union([Type.String(), Type.Null()])
  ),
  last_meta_error_code: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  closed_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  updated_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
