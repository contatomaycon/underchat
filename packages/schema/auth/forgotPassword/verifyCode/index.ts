import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { authForgotPasswordVerifyCodeResponseSchema } from './response.schema';
import { authForgotPasswordVerifyCodeRequestSchema } from './request.schema';

export const forgotPasswordVerifyCodeSchema = {
  description:
    'Valida código de recuperação de senha e realiza login automático',
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
  }),
  body: authForgotPasswordVerifyCodeRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: authForgotPasswordVerifyCodeResponseSchema,
      },
      { description: 'Successful' }
    ),
    400: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Bad Request' }
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
