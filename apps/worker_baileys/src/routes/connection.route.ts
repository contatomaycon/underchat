import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { connectionHealthCheckSchema } from '@core/schema/connection';
import ConnectionController from '@/controllers/connection';

export default async function connectionRoutes(server: FastifyInstance) {
  const connectionController = container.resolve(ConnectionController);

  server.get('/connection/health/check', {
    schema: connectionHealthCheckSchema,
    handler: connectionController.connectionHealthCheck,
  });
}
