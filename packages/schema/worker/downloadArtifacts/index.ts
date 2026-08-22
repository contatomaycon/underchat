import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { downloadArtifactsResponseSchema } from '@core/schema/config/downloadArtifacts/response.schema';

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

export const workerDownloadArtifactsSchema = {
  description: 'Lista links publicos dos artefatos usados na conexao',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  response: {
    200: Type.Object({
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      status: Type.Boolean({ const: true }),
      message: Type.String(),
      data: downloadArtifactsResponseSchema,
    }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
};
