import { type Static, Type } from '@sinclair/typebox';
import { OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES } from '@core/common/constants/outboundWebhookEvents';

const selectableEventTypeSchema = Type.String({
  enum: [...OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES],
  maxLength: 100,
});

export const outboundWebhookIdParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false }
);

export const outboundWebhookDeliveryParamsSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    deliveryId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false }
);

export const createOutboundWebhookRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 200 }),
    url: Type.String({ format: 'uri', minLength: 1, maxLength: 2048 }),
    channel_id: Type.String({ format: 'uuid' }),
    event_types: Type.Array(selectableEventTypeSchema, {
      uniqueItems: true,
      minItems: 1,
      maxItems: OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES.length,
      default: [],
    }),
  },
  { additionalProperties: false }
);

export const updateOutboundWebhookRequestSchema = Type.Partial(
  Type.Object({
    name: Type.String({ minLength: 2, maxLength: 200 }),
    url: Type.String({ format: 'uri', minLength: 1, maxLength: 2048 }),
    channel_id: Type.String({ format: 'uuid' }),
    event_types: Type.Array(selectableEventTypeSchema, {
      uniqueItems: true,
      minItems: 1,
      maxItems: OUTBOUND_WEBHOOK_SELECTABLE_EVENT_TYPES.length,
    }),
  }),
  { additionalProperties: false, minProperties: 1 }
);

export const activateOutboundWebhookRequestSchema = Type.Object(
  {
    active: Type.Boolean(),
  },
  { additionalProperties: false }
);

export const listOutboundWebhookDeliveriesQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 20 })
    ),
  },
  { additionalProperties: false }
);

export type OutboundWebhookIdParams = Static<
  typeof outboundWebhookIdParamsSchema
>;
export type OutboundWebhookDeliveryParams = Static<
  typeof outboundWebhookDeliveryParamsSchema
>;
export type CreateOutboundWebhookRequest = Static<
  typeof createOutboundWebhookRequestSchema
>;
export type UpdateOutboundWebhookRequest = Static<
  typeof updateOutboundWebhookRequestSchema
>;
export type ActivateOutboundWebhookRequest = Static<
  typeof activateOutboundWebhookRequestSchema
>;
export type ListOutboundWebhookDeliveriesQuery = Static<
  typeof listOutboundWebhookDeliveriesQuerySchema
>;
