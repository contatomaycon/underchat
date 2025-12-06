import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { asaasNfseWebhookRequestSchema } from './request.schema';

export const asaasNfseWebhookSchema = {
  description: 'Webhook para receber eventos de notas fiscais do Asaas',
  tags: [ETagSwagger.webhook],
  produces: ['application/json'],
  headers: Type.Object({
    'asaas-access-token': Type.String({
      description: 'Token de autenticação do webhook Asaas',
    }),
  }),
  body: asaasNfseWebhookRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: Type.Object({
          success: Type.Boolean({ const: true }),
        }),
      },
      { description: 'Successful' }
    ),
    401: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Object({
          success: Type.Boolean({ const: false }),
        }),
      },
      { description: 'Unauthorized' }
    ),
    500: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Internal Server Error' }
    ),
  },
};

