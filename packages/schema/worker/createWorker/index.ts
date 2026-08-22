import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { createWorkerRequestSchema } from './request.schema';

export const createWorkerSchema = {
  description: 'Adiciona um novo canal',
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
  body: createWorkerRequestSchema,
  response: {
    202: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: Type.Object({
          code: Type.Literal(202),
          status: Type.Literal('queued'),
          queued: Type.Literal(true),
          worker_id: Type.String(),
          account_id: Type.String(),
          server_id: Type.String(),
          worker_type_id: Type.String(),
          session_storage: Type.Enum(EWorkerSessionStorage),
          worker_status_id: Type.String(),
          operation_id: Type.String(),
          reason: Type.String(),
          recreate_available_at: Type.Optional(
            Type.Union([Type.String(), Type.Null()])
          ),
          warm_pool_claimed: Type.Optional(Type.Boolean()),
          warm_pool_id: Type.Optional(Type.String()),
          fallback_created: Type.Optional(Type.Boolean()),
        }),
      },
      { description: 'Accepted' }
    ),
    401: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Unauthorized' }
    ),
    403: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Forbidden' }
    ),
    500: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Internal Server Error' }
    ),
  },
};
