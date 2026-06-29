import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { connectWhatsappEmbeddedRequestSchema } from './request.schema';
import { connectWhatsappEmbeddedResponseSchema } from './response.schema';

export const connectWhatsappEmbeddedSchema = {
  description: 'Conecta um canal WhatsApp Oficial via Meta Embedded Signup',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        description: 'Idioma preferencial para a resposta',
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
  }),
  body: connectWhatsappEmbeddedRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: connectWhatsappEmbeddedResponseSchema,
      },
      { description: 'Successful' }
    ),
  },
};
