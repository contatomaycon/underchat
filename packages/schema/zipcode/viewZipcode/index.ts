import { Type } from '@sinclair/typebox';
import { zipcodeResponseSchema } from './response.schema';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { viewZipcodeRequest } from './request.schema';

export const getZipcodeSchema = {
  description: 'Obtém o endereço completo a partir do CEP',
  tags: [ETagSwagger.zipcode],
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
  querystring: viewZipcodeRequest,
  response: {
    200: Type.Object(
      {
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: zipcodeResponseSchema,
      },
      { description: 'Successful' }
    ),
    401: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Unauthorized' }
    ),
    404: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Not Found' }
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
