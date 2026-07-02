import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { workerConnectionStateResponseSchema } from '@core/schema/worker/connectionState/response.schema';
import { workerConnectionQrCodeRequestSchema } from './request.schema';

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

const workerConnectionPasskeyResponseBodySchema = Type.Object({
  connection_attempt_id: Type.Optional(Type.String()),
  passkey_response: Type.Unknown(),
});

const workerConnectionPasskeyConfirmationBodySchema = Type.Object({
  connection_attempt_id: Type.Optional(Type.String()),
});

export const workerConnectionQrCodeSchema = {
  description: 'Solicita QR code de conexão do canal',
  tags: [ETagSwagger.worker],
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
  params: workerConnectionQrCodeRequestSchema,
  response: {
    202: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: workerConnectionStateResponseSchema,
      },
      { description: 'Accepted' }
    ),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerConnectionPasskeyResponseSchema = {
  description: 'Envia resposta passkey de conexão do canal',
  tags: [ETagSwagger.worker],
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
  params: workerConnectionQrCodeRequestSchema,
  body: workerConnectionPasskeyResponseBodySchema,
  response: {
    202: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: workerConnectionStateResponseSchema,
      },
      { description: 'Accepted' }
    ),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerConnectionPasskeyConfirmationSchema = {
  description: 'Confirma handoff passkey de conexão do canal',
  tags: [ETagSwagger.worker],
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
  params: workerConnectionQrCodeRequestSchema,
  body: workerConnectionPasskeyConfirmationBodySchema,
  response: {
    202: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: workerConnectionStateResponseSchema,
      },
      { description: 'Accepted' }
    ),
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    503: errorResponseSchema,
    500: errorResponseSchema,
  },
};
