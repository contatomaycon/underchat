import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { type TSchema, Type } from '@sinclair/typebox';
import {
  activateOutboundWebhookRequestSchema,
  createOutboundWebhookRequestSchema,
  listOutboundWebhookDeliveriesQuerySchema,
  outboundWebhookDeliveryParamsSchema,
  outboundWebhookIdParamsSchema,
  updateOutboundWebhookRequestSchema,
} from './request.schema';
import {
  outboundWebhookDeliveryDetailResponseSchema,
  outboundWebhookDeliveryListResponseSchema,
  outboundWebhookEnqueueResponseSchema,
  outboundWebhookEventsResponseSchema,
  outboundWebhookListResponseSchema,
  outboundWebhookResponseSchema,
  outboundWebhookSecretResponseSchema,
} from './response.schema';

const headersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: false }),
  message: Type.String(),
  data: Type.Null(),
});

const successResponse = <T extends TSchema>(data: T) =>
  Type.Object({
    id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Boolean({ const: true }),
    message: Type.String(),
    data,
  });

const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  500: errorResponseSchema,
};

const commonSchema = {
  tags: [ETagSwagger.integration],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
};

export const listOutboundWebhookEventsSchema = {
  ...commonSchema,
  operationId: 'listOutboundWebhookEvents',
  description: 'Lista os eventos disponíveis para webhooks de saída.',
  response: {
    200: successResponse(outboundWebhookEventsResponseSchema),
    ...errorResponses,
  },
};

export const listOutboundWebhooksSchema = {
  ...commonSchema,
  operationId: 'listOutboundWebhooks',
  description: 'Lista os endpoints de webhook de saída da conta.',
  response: {
    200: successResponse(outboundWebhookListResponseSchema),
    ...errorResponses,
  },
};

export const viewOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'viewOutboundWebhook',
  params: outboundWebhookIdParamsSchema,
  response: {
    200: successResponse(outboundWebhookResponseSchema),
    ...errorResponses,
  },
};

export const createOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'createOutboundWebhook',
  body: createOutboundWebhookRequestSchema,
  response: {
    201: successResponse(outboundWebhookSecretResponseSchema),
    ...errorResponses,
  },
};

export const updateOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'updateOutboundWebhook',
  params: outboundWebhookIdParamsSchema,
  body: updateOutboundWebhookRequestSchema,
  response: {
    200: successResponse(outboundWebhookResponseSchema),
    ...errorResponses,
  },
};

export const deleteOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'deleteOutboundWebhook',
  params: outboundWebhookIdParamsSchema,
  response: {
    200: successResponse(Type.Object({ deleted: Type.Literal(true) })),
    ...errorResponses,
  },
};

export const testOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'testOutboundWebhook',
  params: outboundWebhookIdParamsSchema,
  response: {
    202: successResponse(outboundWebhookEnqueueResponseSchema),
    ...errorResponses,
  },
};

export const rotateOutboundWebhookSecretSchema = {
  ...commonSchema,
  operationId: 'rotateOutboundWebhookSecret',
  params: outboundWebhookIdParamsSchema,
  response: {
    200: successResponse(outboundWebhookSecretResponseSchema),
    ...errorResponses,
  },
};

export const activateOutboundWebhookSchema = {
  ...commonSchema,
  operationId: 'activateOutboundWebhook',
  params: outboundWebhookIdParamsSchema,
  body: activateOutboundWebhookRequestSchema,
  response: {
    200: successResponse(outboundWebhookResponseSchema),
    ...errorResponses,
  },
};

export const listOutboundWebhookDeliveriesSchema = {
  ...commonSchema,
  operationId: 'listOutboundWebhookDeliveries',
  params: outboundWebhookIdParamsSchema,
  querystring: listOutboundWebhookDeliveriesQuerySchema,
  response: {
    200: successResponse(outboundWebhookDeliveryListResponseSchema),
    ...errorResponses,
  },
};

export const viewOutboundWebhookDeliverySchema = {
  ...commonSchema,
  operationId: 'viewOutboundWebhookDelivery',
  params: outboundWebhookDeliveryParamsSchema,
  response: {
    200: successResponse(outboundWebhookDeliveryDetailResponseSchema),
    ...errorResponses,
  },
};

export const redeliverOutboundWebhookDeliverySchema = {
  ...commonSchema,
  operationId: 'redeliverOutboundWebhookDelivery',
  params: outboundWebhookDeliveryParamsSchema,
  response: {
    202: successResponse(outboundWebhookEnqueueResponseSchema),
    ...errorResponses,
  },
};

export * from './request.schema';
export * from './response.schema';
