import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { testApiRequestRequestSchema } from './request.schema';
import { testApiRequestResponseSchema } from './response.schema';

const errorResponse = (description: string) =>
  Type.Object(
    {
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ default: false }),
      message: Type.String(),
      data: Type.Union([
        Type.Null(),
        Type.Object({ code: Type.String() }, { additionalProperties: true }),
      ]),
    },
    { description }
  );

export const testApiRequestSchema = {
  description: 'Executa exatamente um teste seguro de um node de API',
  tags: [ETagSwagger.chatbot],
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
  body: testApiRequestRequestSchema,
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: true }),
      message: Type.String(),
      data: testApiRequestResponseSchema,
    }),
    400: errorResponse('Bad Request'),
    401: errorResponse('Unauthorized'),
    402: errorResponse('Payment Required'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not Found'),
    429: errorResponse('Too Many Requests'),
    500: errorResponse('Internal Server Error'),
    503: errorResponse('Service Unavailable'),
  },
};
