import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';

export default async function (server: FastifyInstance) {
  await server.register(healthRoutes);
}
