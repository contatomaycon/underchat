import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import connectionRoutes from '@/routes/connection.route';

export default async function (server: FastifyInstance) {
  await server.register(healthRoutes);
  await server.register(connectionRoutes);
}
