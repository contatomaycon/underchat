import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(healthRoutes);
}
