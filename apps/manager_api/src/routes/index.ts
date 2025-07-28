import { FastifyInstance } from 'fastify';
import authRoutes from '@/routes/auth.route';
import serverRoutes from '@/routes/server.route';
import healthRoutes from '@/routes/health.route';
import centrifugoRoutes from '@/routes/centrifugo.route';
import roleRoutes from './role.route';
import workerRoutes from '@/routes/worker.route';

export default async function (server: FastifyInstance) {
  await server.register(authRoutes);
  await server.register(healthRoutes);
  await server.register(serverRoutes);
  await server.register(centrifugoRoutes);
  await server.register(roleRoutes);
  await server.register(workerRoutes);
}
