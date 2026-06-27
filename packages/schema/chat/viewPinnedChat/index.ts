import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { listChatsResultSchema } from '../listChats/response.schema';

const errorResponseProperties = {
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
};

export const viewPinnedChatSchema = {
  description: 'Lista as conversas fixadas do usuario',
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
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: Type.Array(listChatsResultSchema),
      },
      { description: 'Successful' }
    ),
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};

const pinnedChatParamsSchema = Type.Object({
  chat_id: Type.String({ format: 'uuid' }),
});

export const pinChatSchema = {
  description: 'Fixa uma conversa para o usuario',
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
  params: pinnedChatParamsSchema,
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
    400: Type.Object(errorResponseProperties, { description: 'Bad Request' }),
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};

export const unpinChatSchema = {
  description: 'Desafixa uma conversa do usuario',
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
  params: pinnedChatParamsSchema,
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
    401: Type.Object(errorResponseProperties, { description: 'Unauthorized' }),
    403: Type.Object(errorResponseProperties, { description: 'Forbidden' }),
    500: Type.Object(errorResponseProperties, {
      description: 'Internal Server Error',
    }),
  },
};
