import { Type } from '@sinclair/typebox';
import { listRegisterCitiesResponseSchema } from './response.schema';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { listRegisterCitiesRequestSchema } from './request.schema';

export const listRegisterCitiesSchema = {
  description: 'Lista todas as cidades de um estado',
  tags: [ETagSwagger.register],
  produces: ['application/json'],
  security: [
    {
      authenticateRegisterJwt: [],
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
  querystring: listRegisterCitiesRequestSchema,
  response: {
    200: Type.Object(
      {
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: listRegisterCitiesResponseSchema,
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
