import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { updateDownloadArtifactsRequestSchema } from './request.schema';
import { downloadArtifactsResponseSchema } from './response.schema';

const headersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta',
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

const successResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ const: true }),
  message: Type.String(),
  data: downloadArtifactsResponseSchema,
});

export const listDownloadArtifactsSchema = {
  description: 'Lista links publicos dos artefatos de download',
  tags: [ETagSwagger.config],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  response: {
    200: successResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const updateDownloadArtifactsSchema = {
  description: 'Atualiza links publicos dos artefatos de download',
  tags: [ETagSwagger.config],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  body: updateDownloadArtifactsRequestSchema,
  response: {
    200: successResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
};
