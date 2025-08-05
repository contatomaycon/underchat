import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import metricsRoutes from '@/routes/metrics.route';

export default async function (server: FastifyInstance) {
  await server.register(healthRoutes);
  await server.register(metricsRoutes);
}
