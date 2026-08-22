import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import {
  workerSecureConnectionHelperParamsSchema,
  workerSecureConnectionHelperSessionBodySchema,
  workerSecureConnectionHelperStatusBodySchema,
  workerSecureConnectionParamsSchema,
  workerSecureConnectionTokenParamsSchema,
} from './request.schema';
import { workerSecureConnectionSessionResponseSchema } from './response.schema';

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
  data: workerSecureConnectionSessionResponseSchema,
});

const headersSchema = Type.Object({
  'Accept-Language': Type.Optional(
    Type.String({
      description: 'Idioma preferencial para a resposta',
      enum: Object.values(ELanguage),
      default: ELanguage.pt,
    })
  ),
});

export const workerSecureConnectionCreateSchema = {
  description: 'Cria uma sessao temporaria de conexao segura',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: workerSecureConnectionParamsSchema,
  response: {
    201: successResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerSecureConnectionViewSchema = {
  description: 'Consulta uma sessao temporaria de conexao segura',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: workerSecureConnectionTokenParamsSchema,
  response: {
    200: successResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerSecureConnectionCancelSchema = {
  description: 'Cancela uma sessao temporaria de conexao segura',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: headersSchema,
  params: workerSecureConnectionTokenParamsSchema,
  response: {
    200: successResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerSecureConnectionHelperViewSchema = {
  description: 'Consulta publica da sessao segura pelo helper nativo',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  params: workerSecureConnectionHelperParamsSchema,
  response: {
    200: successResponseSchema,
    404: errorResponseSchema,
    410: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerSecureConnectionHelperStatusSchema = {
  description: 'Atualiza status publico da sessao segura pelo helper nativo',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  params: workerSecureConnectionHelperParamsSchema,
  body: workerSecureConnectionHelperStatusBodySchema,
  response: {
    202: successResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    410: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export const workerSecureConnectionHelperSessionSchema = {
  description: 'Recebe pacote de sessao WhatsApp Web do helper nativo',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  params: workerSecureConnectionHelperParamsSchema,
  body: workerSecureConnectionHelperSessionBodySchema,
  response: {
    202: successResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    410: errorResponseSchema,
    500: errorResponseSchema,
  },
};
