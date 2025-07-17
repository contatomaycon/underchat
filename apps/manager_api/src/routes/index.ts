import { FastifyInstance } from 'fastify';
import authRoutes from '@/routes/auth.route';
import serverRoutes from '@/routes/server.route';
import healthRoutes from '@/routes/health.route';

export default async function (server: FastifyInstance) {
  await server.register(authRoutes);
  await server.register(healthRoutes);
  await server.register(serverRoutes);
}
