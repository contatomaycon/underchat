import { FastifyInstance } from 'fastify';
import authRoutes from '@/routes/auth.route';
import serverRoutes from '@/routes/server.route';
import healthRoutes from '@/routes/health.route';
import centrifugoRoutes from '@/routes/centrifugo.route';
import roleRoutes from './role.route';
import workerRoutes from '@/routes/worker.route';
import chatRoutes from '@/routes/chat.route';
import sectorRoutes from './sector.route';
import userRoutes from './user.route';
import zipcodeRoutes from './zipcode.route';
import accountRoutes from './account.route';
import planRoutes from './plan.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(authRoutes);
  server.register(healthRoutes);
  server.register(serverRoutes);
  server.register(centrifugoRoutes);
  server.register(roleRoutes);
  server.register(workerRoutes);
  server.register(chatRoutes);
  server.register(sectorRoutes);
  server.register(userRoutes);
  server.register(zipcodeRoutes);
  server.register(accountRoutes);
  server.register(planRoutes);
}
