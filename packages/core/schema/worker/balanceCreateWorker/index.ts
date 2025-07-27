import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { balanceCreateWorkerResponseSchema } from './response.schema';
import { balanceCreateWorkerRequestSchema } from './request.schema';

export const balanceCreateWorkerSchema = {
  description: 'Adiciona um novo canal',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [
    {
      authenticateKeyApi: [],
    },
  ],
  body: balanceCreateWorkerRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: balanceCreateWorkerResponseSchema,
      },
      { description: 'Successful' }
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
