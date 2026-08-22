import { type Static, Type } from '@sinclair/typebox';

const nullableDateTimeSchema = Type.Union([
  Type.String({ format: 'date-time' }),
  Type.Null(),
]);
const nullableStringSchema = Type.Union([Type.String(), Type.Null()]);
const nullableIntegerSchema = Type.Union([Type.Integer(), Type.Null()]);

export const outboundWebhookStatusSchema = Type.Union([
  Type.Literal('inactive'),
  Type.Literal('active'),
  Type.Literal('suspended'),
]);

export const outboundWebhookDeliveryStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('leased'),
  Type.Literal('retrying'),
  Type.Literal('succeeded'),
  Type.Literal('dead'),
  Type.Literal('suppressed'),
]);

export const outboundWebhookResponseSchema = Type.Object({
  outbound_webhook_id: Type.String({ format: 'uuid' }),
  channel_id: Type.String({ format: 'uuid' }),
  channel: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    number: Type.Union([Type.String(), Type.Null()]),
    available: Type.Boolean(),
  }),
  name: Type.String(),
  url: Type.String({ format: 'uri' }),
  status: outboundWebhookStatusSchema,
  secret_preview: Type.String(),
  config_version: Type.Integer({ minimum: 1 }),
  event_types: Type.Array(Type.String()),
  verified: Type.Boolean(),
  verified_at: nullableDateTimeSchema,
  consecutive_dead_deliveries: Type.Integer({ minimum: 0 }),
  suspended_at: nullableDateTimeSchema,
  suspension_reason: nullableStringSchema,
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const outboundWebhookSecretResponseSchema = Type.Object({
  webhook: outboundWebhookResponseSchema,
  secret: Type.String({
    pattern: '^uc_whsec_[A-Za-z0-9_-]{43}$',
  }),
});

export const outboundWebhookEventCatalogItemSchema = Type.Object({
  type: Type.String(),
  group: Type.String(),
  selectable: Type.Boolean(),
  description: Type.String(),
});

export const outboundWebhookEventsResponseSchema = Type.Object({
  events: Type.Array(outboundWebhookEventCatalogItemSchema),
});

export const outboundWebhookListResponseSchema = Type.Object({
  items: Type.Array(outboundWebhookResponseSchema),
});

export const outboundWebhookEnqueueResponseSchema = Type.Object({
  outbound_webhook_event_id: Type.String({ format: 'uuid' }),
  outbound_webhook_delivery_id: Type.String({ format: 'uuid' }),
  status: Type.Literal('pending'),
});

export const outboundWebhookDeliveryResponseSchema = Type.Object({
  outbound_webhook_delivery_id: Type.String({ format: 'uuid' }),
  outbound_webhook_id: Type.String({ format: 'uuid' }),
  outbound_webhook_event_id: Type.String({ format: 'uuid' }),
  event_type: Type.String(),
  is_test: Type.Boolean(),
  config_version: Type.Integer({ minimum: 1 }),
  status: outboundWebhookDeliveryStatusSchema,
  attempt_count: Type.Integer({ minimum: 0 }),
  response_status: nullableIntegerSchema,
  next_attempt_at: Type.String({ format: 'date-time' }),
  delivered_at: nullableDateTimeSchema,
  dead_at: nullableDateTimeSchema,
  suppressed_at: nullableDateTimeSchema,
  last_error: nullableStringSchema,
  redelivery_of_delivery_id: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export const outboundWebhookDeliveryAttemptResponseSchema = Type.Object({
  outbound_webhook_delivery_attempt_id: Type.String({ format: 'uuid' }),
  attempt_number: Type.Integer({ minimum: 1 }),
  started_at: Type.String({ format: 'date-time' }),
  finished_at: nullableDateTimeSchema,
  outcome: Type.Union([
    Type.Literal('succeeded'),
    Type.Literal('http_error'),
    Type.Literal('network_error'),
    Type.Literal('timeout'),
    Type.Literal('internal_error'),
    Type.Literal('suppressed'),
    Type.Null(),
  ]),
  http_status: nullableIntegerSchema,
  error_code: nullableStringSchema,
  error_message: nullableStringSchema,
  response_body: nullableStringSchema,
  duration_ms: nullableIntegerSchema,
  retry_after_ms: nullableIntegerSchema,
  created_at: Type.String({ format: 'date-time' }),
});

export const outboundWebhookDeliveryDetailResponseSchema = Type.Intersect([
  outboundWebhookDeliveryResponseSchema,
  Type.Object({
    payload: Type.Record(Type.String(), Type.Unknown()),
    attempts: Type.Array(outboundWebhookDeliveryAttemptResponseSchema),
  }),
]);

export const outboundWebhookDeliveryListResponseSchema = Type.Object({
  items: Type.Array(outboundWebhookDeliveryResponseSchema),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
});

export type OutboundWebhookResponse = Static<
  typeof outboundWebhookResponseSchema
>;
export type OutboundWebhookSecretResponse = Static<
  typeof outboundWebhookSecretResponseSchema
>;
export type OutboundWebhookEnqueueResponse = Static<
  typeof outboundWebhookEnqueueResponseSchema
>;
export type OutboundWebhookDeliveryResponse = Static<
  typeof outboundWebhookDeliveryResponseSchema
>;
export type OutboundWebhookDeliveryAttemptResponse = Static<
  typeof outboundWebhookDeliveryAttemptResponseSchema
>;
export type OutboundWebhookDeliveryDetailResponse = Static<
  typeof outboundWebhookDeliveryDetailResponseSchema
>;
export type OutboundWebhookDeliveryListResponse = Static<
  typeof outboundWebhookDeliveryListResponseSchema
>;
