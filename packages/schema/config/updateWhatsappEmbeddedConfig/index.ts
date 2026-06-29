import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { updateWhatsappEmbeddedConfigRequestSchema } from './request.schema';
import { updateWhatsappEmbeddedConfigResponseSchema } from './response.schema';

export const updateWhatsappEmbeddedConfigSchema = {
  description: 'Atualiza a configuração de WhatsApp Embedded',
  tags: [ETagSwagger.config],
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
  body: updateWhatsappEmbeddedConfigRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: updateWhatsappEmbeddedConfigResponseSchema,
      },
      { description: 'Successful' }
    ),
  },
};
