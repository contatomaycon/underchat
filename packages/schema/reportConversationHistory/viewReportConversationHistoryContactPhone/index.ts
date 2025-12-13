export * from './request.schema';
export * from './response.schema';
import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { viewReportConversationHistoryContactPhoneParamsSchema } from './request.schema';
import { viewReportConversationHistoryContactPhoneResponseSchema } from './response.schema';

export const viewReportConversationHistoryContactPhoneSchema = {
  description:
    'Visualizar telefone descriptografado do contato do histórico de conversas',
  tags: [ETagSwagger.reportConversationHistory],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  params: viewReportConversationHistoryContactPhoneParamsSchema,
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
        data: viewReportConversationHistoryContactPhoneResponseSchema,
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
