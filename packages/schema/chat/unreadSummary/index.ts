import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { chatUnreadSummaryResponseSchema } from './response.schema';

const errorResponseProperties = {
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
};

export const viewChatUnreadSummarySchema = {
  description: 'Visualiza o total de mensagens nao lidas do chat',
  tags: [ETagSwagger.chat],
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
    200: chatUnreadSummaryResponseSchema,
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};
