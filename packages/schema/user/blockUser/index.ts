import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { blockUserRequestSchema } from './request.schema';

const responseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean(),
  message: Type.String(),
  data: Type.Union([Type.Boolean(), Type.Null()]),
});

export const blockUserSchema = {
  description: 'Bloqueia um usuário',
  tags: [ETagSwagger.user],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
  }),
  params: blockUserRequestSchema,
  response: {
    200: responseSchema,
    400: responseSchema,
    401: responseSchema,
    403: responseSchema,
    500: responseSchema,
  },
};
