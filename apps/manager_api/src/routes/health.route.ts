import HealthController from '@/controllers/health';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { managerHealthCheckSchema } from '@core/schema/health';

export default function healthRoutes(server: FastifyInstance) {
  const healthController = container.resolve(HealthController);

  server.get('/health/check', {
    schema: managerHealthCheckSchema,
    handler: healthController.view,
  });
}
