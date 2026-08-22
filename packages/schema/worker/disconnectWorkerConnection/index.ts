import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { Type } from '@sinclair/typebox';
import { disconnectWorkerConnectionRequestSchema } from './request.schema';
import { disconnectWorkerConnectionDataSchema } from './response.schema';

const errorResponseSchema = Type.Object({
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Boolean({ default: false }),
  message: Type.String(),
  data: Type.Null(),
});

export const disconnectWorkerConnectionSchema = {
  description: 'Remove a sessao do canal sem recriar ou substituir seu runtime',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [{ authenticateJwt: [] }],
  headers: Type.Object({
    'Accept-Language': Type.Optional(
      Type.String({
        description: 'Idioma preferencial para a resposta',
        enum: Object.values(ELanguage),
        default: ELanguage.pt,
      })
    ),
    'x-connection-lifecycle-debug-trace-id': Type.Optional(Type.String()),
  }),
  params: disconnectWorkerConnectionRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: disconnectWorkerConnectionDataSchema,
      },
      { description: 'Successful' }
    ),
    401: errorResponseSchema,
    403: errorResponseSchema,
    409: errorResponseSchema,
    500: errorResponseSchema,
  },
};

export { disconnectWorkerConnectionRequestSchema } from './request.schema';
export type { DisconnectWorkerConnectionRequest } from './request.schema';
export {
  disconnectWorkerConnectionDataSchema,
  type DisconnectWorkerConnectionResponse,
} from './response.schema';
