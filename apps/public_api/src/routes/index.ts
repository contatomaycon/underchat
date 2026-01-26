import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import webhookRoutes from '@/routes/webhook.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(healthRoutes);
  server.register(webhookRoutes);
}
