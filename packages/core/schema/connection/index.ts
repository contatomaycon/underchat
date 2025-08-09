import { Type } from '@fastify/type-provider-typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';

export const connectionHealthCheckSchema = {
  description: 'Verifica a saúde da conexão',
  tags: [ETagSwagger.connection],
  produces: ['application/json'],
  response: {
    200: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Successful' }
    ),
    500: Type.Object(
      {
        status: Type.Boolean(),
        message: Type.String(),
        data: Type.Null(),
      },
      { description: 'Internal Server Error' }
    ),
  },
};
