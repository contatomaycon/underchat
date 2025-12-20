import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { registerCentrifugoTokenRequestSchema } from './request.schema';
import { registerCentrifugoTokenResponseSchema } from './response.schema';

export const registerCentrifugoTokenSchema = {
  description: 'Gera um token de autenticação do Centrifugo para register',
  tags: [ETagSwagger.register],
  produces: ['application/json'],
  security: [
    {
      authenticateRegisterJwt: [],
    },
  ],
  body: registerCentrifugoTokenRequestSchema,
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
      data: registerCentrifugoTokenResponseSchema,
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
