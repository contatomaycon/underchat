import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { publicApiTokenResponseSchema } from './response.schema';

const publicApiTokenHeadersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta.',
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
  data: publicApiTokenResponseSchema,
});

const commonSchema = {
  tags: [ETagSwagger.integration],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: publicApiTokenHeadersSchema,
  response: {
    200: successResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const viewPublicApiTokenSchema = {
  ...commonSchema,
  operationId: 'viewPublicApiToken',
  description: 'Consulta o token ativo da API pública da conta.',
};

export const generatePublicApiTokenSchema = {
  ...commonSchema,
  operationId: 'generatePublicApiToken',
  description:
    'Gera o primeiro token da API pública ou rotaciona a credencial ativa da conta.',
};

export const revokePublicApiTokenSchema = {
  ...commonSchema,
  operationId: 'revokePublicApiToken',
  description: 'Revoga imediatamente o token ativo da API pública da conta.',
};

export * from './response.schema';
