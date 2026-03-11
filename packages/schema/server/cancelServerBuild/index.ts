import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { Type } from '@sinclair/typebox';

export const serverBuildCancelSchema = {
  description: 'Solicita cancelamento do build ativo',
  tags: [ETagSwagger.server],
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
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Successful' }
    ),
    400: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Bad Request' }
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
