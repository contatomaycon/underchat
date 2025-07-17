import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { viewMetricsSchema } from '@core/schema/metrics/viewMetrics';
import MetricsController from '@/controllers/metrics';
import { metricsViewPermissions } from '@/permissions/metrics.permissions';

export default async function metricsRoutes(server: FastifyInstance) {
  const metricsController = container.resolve(MetricsController);

  server.get('/metrics', {
    schema: viewMetricsSchema,
    handler: metricsController.viewMetrics,
    preHandler: [
      (request, reply) =>
        server.authenticateKeyApi(request, reply, metricsViewPermissions),
    ],
  });
}
