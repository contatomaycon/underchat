import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { authTokenResponseSchema } from './response.schema';

export const authTokenSchema = {
  description: 'Gera um token de autenticação',
  tags: [ETagSwagger.centrifugo],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: authTokenResponseSchema,
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
