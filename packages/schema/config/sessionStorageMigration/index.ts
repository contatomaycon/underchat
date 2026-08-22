import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import {
  sessionStorageMigrationChannelParamsSchema,
  sessionStorageMigrationParamsSchema,
} from './request.schema';
import { sessionStorageMigrationSummarySchema } from './response.schema';

const headers = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

const successEnvelope = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: sessionStorageMigrationSummarySchema,
});

const nullableSuccessEnvelope = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: Type.Union([sessionStorageMigrationSummarySchema, Type.Null()]),
});

const errorEnvelope = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

export const createSessionStorageMigrationSchema = {
  description: 'Inicia a migração segura de uma sessão legada',
  tags: [ETagSwagger.config],
  security: [{ authenticateJwt: [] }],
  params: sessionStorageMigrationChannelParamsSchema,
  headers,
  response: {
    202: successEnvelope,
    400: errorEnvelope,
    401: errorEnvelope,
    403: errorEnvelope,
    409: errorEnvelope,
    500: errorEnvelope,
  },
};

export const latestSessionStorageMigrationSchema = {
  description: 'Obtém a migração de sessão mais recente do canal',
  tags: [ETagSwagger.config],
  security: [{ authenticateJwt: [] }],
  params: sessionStorageMigrationChannelParamsSchema,
  headers,
  response: {
    200: nullableSuccessEnvelope,
    401: errorEnvelope,
    403: errorEnvelope,
    500: errorEnvelope,
  },
};

export const deleteLegacyMigrationVolumeSchema = {
  description: 'Exclui e comprova a ausência do volume legado migrado',
  tags: [ETagSwagger.config],
  security: [{ authenticateJwt: [] }],
  params: sessionStorageMigrationParamsSchema,
  headers,
  response: {
    200: successEnvelope,
    400: errorEnvelope,
    401: errorEnvelope,
    403: errorEnvelope,
    409: errorEnvelope,
    500: errorEnvelope,
  },
};
