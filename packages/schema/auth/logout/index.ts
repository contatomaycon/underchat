import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { Type } from '@sinclair/typebox';

export const logoutSchema = {
  description: 'Encerra a sessão do usuário no servidor e invalida o token',
  tags: [ETagSwagger.auth],
  produces: ['application/json'],
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        description: 'Idioma preferencial para a resposta',
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
    'X-Client-Platform': Type.Optional(
      Type.String({
        description: 'Plataforma da sessão',
        enum: ['web', 'mobile'],
      })
    ),
  }),
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      message: Type.String(),
      status: Type.Boolean({ const: true }),
      data: Type.Null(),
    }),
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
