import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { workerExternalConnectionRequestSchema } from './request.schema';
import { workerExternalConnectionViewResponseSchema } from './response.schema';
import { workerConnectionStateResponseSchema } from '@core/schema/worker/connectionState/response.schema';

const publicErrorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

const languageHeadersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta',
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

const workerExternalConnectionPasskeyResponseBodySchema = Type.Object({
  connection_attempt_id: Type.Optional(Type.String()),
  passkey_response: Type.Unknown(),
});

const workerExternalConnectionPasskeyConfirmationBodySchema = Type.Object({
  connection_attempt_id: Type.Optional(Type.String()),
});

export const viewWorkerExternalConnectionSchema = {
  description: 'Visualiza conexão externa pública do canal',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  headers: languageHeadersSchema,
  params: workerExternalConnectionRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: workerExternalConnectionViewResponseSchema,
      },
      { description: 'Successful' }
    ),
    400: publicErrorResponseSchema,
    404: publicErrorResponseSchema,
    410: publicErrorResponseSchema,
    503: publicErrorResponseSchema,
    500: publicErrorResponseSchema,
  },
};

export const requestWorkerExternalConnectionQrCodeSchema = {
  description: 'Solicita QR code pela conexão externa pública do canal',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  headers: languageHeadersSchema,
  params: workerExternalConnectionRequestSchema,
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
    400: publicErrorResponseSchema,
    404: publicErrorResponseSchema,
    410: publicErrorResponseSchema,
    500: publicErrorResponseSchema,
  },
};

export const requestWorkerExternalConnectionPasskeyResponseSchema = {
  description: 'Envia resposta passkey pela conexão externa pública do canal',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  headers: languageHeadersSchema,
  params: workerExternalConnectionRequestSchema,
  body: workerExternalConnectionPasskeyResponseBodySchema,
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
    400: publicErrorResponseSchema,
    404: publicErrorResponseSchema,
    410: publicErrorResponseSchema,
    500: publicErrorResponseSchema,
  },
};

export const requestWorkerExternalConnectionPasskeyConfirmationSchema = {
  description: 'Confirma handoff passkey pela conexão externa pública do canal',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  headers: languageHeadersSchema,
  params: workerExternalConnectionRequestSchema,
  body: workerExternalConnectionPasskeyConfirmationBodySchema,
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
    400: publicErrorResponseSchema,
    404: publicErrorResponseSchema,
    410: publicErrorResponseSchema,
    500: publicErrorResponseSchema,
  },
};
