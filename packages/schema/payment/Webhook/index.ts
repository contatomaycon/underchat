import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { asaasPaymentWebhookRequestSchema } from './request.schema';

export const asaasPaymentWebhookSchema = {
  description: 'Webhook para receber eventos de cobranças do Asaas',
  tags: [ETagSwagger.webhook],
  produces: ['application/json'],
  body: asaasPaymentWebhookRequestSchema,
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
