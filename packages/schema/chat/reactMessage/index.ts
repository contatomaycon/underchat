import { Type } from '@sinclair/typebox';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import {
  reactMessageParamsSchema,
  reactMessageBodySchema,
} from './request.schema';
import { workerCommandAcceptedCommandsSchema } from '../workerCommandAcceptance.schema';

export const reactMessageSchema = {
  description:
    'Adiciona ou remove uma reação em uma mensagem. Se operation_id for omitido, a resposta devolve um UUIDv7 gerado; reutilize-o para retry seguro.',
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
  params: reactMessageParamsSchema,
  body: reactMessageBodySchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: Type.Boolean({ const: true }),
        operation_id: Type.Optional(Type.String()),
        command_id: Type.Optional(Type.String()),
        accepted_at: Type.Optional(Type.String({ format: 'date-time' })),
        expires_at: Type.Optional(Type.String({ format: 'date-time' })),
        accepted_commands: workerCommandAcceptedCommandsSchema,
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
