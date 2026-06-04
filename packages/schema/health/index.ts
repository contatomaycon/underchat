import { Type } from '@sinclair/typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';

const healthResponseDataSchema = Type.Any();

export const healthCheckSchema = {
  description: 'Verifica a saúde da aplicação',
  tags: [ETagSwagger.health],
  produces: ['application/json'],
  response: {
    200: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Successful' }
    ),
    503: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Service Unavailable' }
    ),
    500: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: healthResponseDataSchema,
      },
      { description: 'Internal Server Error' }
    ),
  },
};
