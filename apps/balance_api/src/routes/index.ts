import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import metricsRoutes from '@/routes/metrics.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(healthRoutes);
  server.register(metricsRoutes);
}
