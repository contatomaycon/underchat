import { Type } from '@fastify/type-provider-typebox';
import { ETagSwagger } from '@core/common/enums/ETagSwagger';

export const healthCheckSchema = {
  description: 'Verifica a saúde da aplicação',
  tags: [ETagSwagger.health],
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
  },
};
