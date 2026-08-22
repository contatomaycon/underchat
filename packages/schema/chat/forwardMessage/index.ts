import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import {
  forwardMessageBodySchema,
  forwardMessageParamsSchema,
} from './request.schema';
import { forwardMessageResponseSchema } from './response.schema';
import {
  workerCommandAcceptedCommandsSchema,
  workerCommandPublishReceiptSchema,
} from '../workerCommandAcceptance.schema';

export const forwardMessageSchema = {
  description:
    'Encaminha uma mensagem para múltiplos chats ou contatos. Se idempotency_key for omitido, a resposta devolve um UUIDv7 gerado; reutilize-o para retry seguro.',
  tags: [ETagSwagger.chat],
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
  params: forwardMessageParamsSchema,
  body: forwardMessageBodySchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: forwardMessageResponseSchema,
        idempotency_key: Type.String({ format: 'uuid' }),
        commands: Type.Array(workerCommandPublishReceiptSchema),
      },
      { description: 'Successful' }
    ),
    400: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Optional(Type.Boolean({ default: false })),
        message: Type.String(),
        data: Type.Optional(Type.Null()),
        statusCode: Type.Optional(Type.Number()),
        error: Type.Optional(Type.String()),
      },
      { description: 'Bad Request' }
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
    404: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ default: false }),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Not Found' }
    ),
    410: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: false }),
        message: Type.String(),
        data: Type.Object({
          retryable: Type.Boolean({ const: false }),
          reason: Type.Literal('retry_window_elapsed'),
          operation_id: Type.Union([Type.String(), Type.Null()]),
          command_id: Type.Union([Type.String(), Type.Null()]),
          issued_at: Type.Union([Type.String(), Type.Null()]),
          expires_at: Type.Union([Type.String(), Type.Null()]),
          accepted_commands: workerCommandAcceptedCommandsSchema,
        }),
      },
      { description: 'The two-minute retry window has elapsed' }
    ),
    503: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: false }),
        message: Type.String(),
        data: Type.Object({
          retryable: Type.Boolean({ const: true }),
          acceptance: Type.Literal('unknown'),
          operation_id: Type.Union([Type.String(), Type.Null()]),
          command_id: Type.String(),
          issued_at: Type.Union([Type.String(), Type.Null()]),
          expires_at: Type.Union([Type.String(), Type.Null()]),
          retry_until: Type.Union([Type.String(), Type.Null()]),
          accepted_commands: workerCommandAcceptedCommandsSchema,
        }),
      },
      { description: 'JetStream acceptance unknown; retry the same operation' }
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
