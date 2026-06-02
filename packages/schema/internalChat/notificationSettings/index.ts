import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { internalChatNotificationSettingsRequestSchema } from './request.schema';
import { internalChatNotificationSettingsResponseSchema } from './response.schema';

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

export const viewInternalChatNotificationSettingsSchema = {
  description: 'Visualiza configurações de notificação do chat interno',
  tags: [ETagSwagger.internalChat],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  headers: headersSchema,
  response: {
    200: internalChatNotificationSettingsResponseSchema,
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};

export const updateInternalChatNotificationSettingsSchema = {
  description: 'Atualiza configurações de notificação do chat interno',
  tags: [ETagSwagger.internalChat],
  produces: ['application/json'],
  security: [
    {
      authenticateJwt: [],
    },
  ],
  headers: headersSchema,
  body: internalChatNotificationSettingsRequestSchema,
  response: {
    200: internalChatNotificationSettingsResponseSchema,
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};
