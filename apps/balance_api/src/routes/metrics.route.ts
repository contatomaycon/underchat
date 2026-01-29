import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { viewMetricsSchema } from '@core/schema/metrics/viewMetrics';
import MetricsController from '@/controllers/metrics';

export default function metricsRoutes(server: FastifyInstance) {
  const metricsController = container.resolve(MetricsController);

  server.get('/metrics', {
    schema: viewMetricsSchema,
    handler: metricsController.viewMetrics,
    preHandler: [(request, reply) => server.authenticateKeyApi(request, reply)],
  });
}
