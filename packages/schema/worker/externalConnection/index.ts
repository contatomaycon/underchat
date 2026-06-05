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
