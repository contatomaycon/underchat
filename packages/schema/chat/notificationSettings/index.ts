import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { chatNotificationSettingsRequestSchema } from './request.schema';
import { chatNotificationSettingsResponseSchema } from './response.schema';

const errorResponseProperties = {
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
};

const headersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta',
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

export const viewChatNotificationSettingsSchema = {
  description: 'Visualiza configurações de notificação do chat',
  tags: [ETagSwagger.chat],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  headers: headersSchema,
  response: {
    200: chatNotificationSettingsResponseSchema,
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};

export const updateChatNotificationSettingsSchema = {
  description: 'Atualiza configurações de notificação do chat',
  tags: [ETagSwagger.chat],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  headers: headersSchema,
  body: chatNotificationSettingsRequestSchema,
  response: {
    200: chatNotificationSettingsResponseSchema,
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};
