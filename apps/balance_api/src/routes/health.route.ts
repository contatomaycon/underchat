import HealthController from '@/controllers/health';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { healthCheckSchema } from '@core/schema/health';

export default async function healthRoutes(server: FastifyInstance) {
  const healthController = container.resolve(HealthController);

  server.get('/health/check', {
    schema: healthCheckSchema,
    handler: healthController.view,
  });
}
