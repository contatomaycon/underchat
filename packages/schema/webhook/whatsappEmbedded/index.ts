import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';

const metaWebhookVerificationQuerySchema = Type.Object(
  {
    'hub.mode': Type.Optional(Type.String()),
    'hub.verify_token': Type.Optional(Type.String()),
    'hub.challenge': Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

const metaWebhookHeadersSchema = Type.Object(
  {
    'x-hub-signature-256': Type.Optional(Type.String()),
  },
  { additionalProperties: true }
);

export const whatsappEmbeddedWebhookVerificationSchema = {
  description: 'Verifica endpoint de Webhook WhatsApp Embedded Meta',
  tags: [ETagSwagger.webhook],
  produces: ['text/plain'],
  querystring: metaWebhookVerificationQuerySchema,
  response: {
    200: Type.String(),
    403: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean(),
      message: Type.String(),
      data: Type.Any(),
    }),
  },
};

export const whatsappEmbeddedWebhookReceiveSchema = {
  description: 'Recebe eventos de Webhook WhatsApp Embedded Meta',
  tags: [ETagSwagger.webhook],
  produces: ['application/json'],
  headers: metaWebhookHeadersSchema,
  body: Type.Any(),
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: true }),
      message: Type.String(),
      data: Type.Object({
        success: Type.Boolean(),
        ignored: Type.Optional(Type.Boolean()),
      }),
    }),
    403: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean(),
      message: Type.String(),
      data: Type.Any(),
    }),
  },
};
