import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import connectionRoutes from '@/routes/connection.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(healthRoutes);
  server.register(connectionRoutes);
}
