import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';
import webhookRoutes from '@/routes/webhook.route';
import chatRoutes from '@/routes/chat.route';
import labelTemplateRoutes from '@/routes/labelTemplate.route';
import sectorRoutes from '@/routes/sector.route';
import userRoutes from '@/routes/user.route';

export default function registerRoutes(server: FastifyInstance) {
  server.register(healthRoutes);
  server.register(webhookRoutes);
  server.register(chatRoutes);
  server.register(labelTemplateRoutes);
  server.register(sectorRoutes);
  server.register(userRoutes);
}
