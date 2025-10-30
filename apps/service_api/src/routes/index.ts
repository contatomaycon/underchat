import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';

export default async function registerRoutes(server: FastifyInstance) {
  await server.register(healthRoutes);
}
