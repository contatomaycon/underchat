import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { createRegisterOrderPaymentRequestSchema } from './request.schema';
import { createRegisterOrderPaymentResponseSchema } from './response.schema';

export const createRegisterOrderPaymentSchema = {
  description: 'Cria pagamento de pedido',
  tags: [ETagSwagger.register],
  produces: ['application/json'],
  security: [
    {
      authenticateRegisterJwt: [],
    },
  ],
  body: createRegisterOrderPaymentRequestSchema,
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
  }),
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: true }),
      message: Type.String(),
      data: createRegisterOrderPaymentResponseSchema,
    }),
    400: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Null(),
    }),
    401: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Null(),
    }),
    500: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Null(),
    }),
  },
};
