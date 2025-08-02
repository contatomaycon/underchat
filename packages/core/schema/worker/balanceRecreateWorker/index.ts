import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';
import { balanceRecreateWorkerRequestSchema } from './request.schema';
import { balanceRecreateWorkerResponseSchema } from './response.schema';

export const balanceRecreateWorkerSchema = {
  description: 'Recria um canal existente',
  tags: [ETagSwagger.worker],
  produces: ['application/json'],
  security: [
    {
      authenticateKeyApi: [],
    },
  ],
  params: balanceRecreateWorkerRequestSchema,
  response: {
    200: Type.Object(
      {
        id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Boolean({ const: true }),
        message: Type.String(),
        data: balanceRecreateWorkerResponseSchema,
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
