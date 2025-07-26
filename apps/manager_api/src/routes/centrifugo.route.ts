import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import CentrifugoController from '@/controllers/centrifugo';
import { authTokenSchema } from '@core/schema/centrifugo/token';

export default async function centrifugoRoutes(server: FastifyInstance) {
  const centrifugoController = container.resolve(CentrifugoController);

  server.post('/centrifugo/auth/token', {
    schema: authTokenSchema,
    handler: centrifugoController.authToken,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });
}
