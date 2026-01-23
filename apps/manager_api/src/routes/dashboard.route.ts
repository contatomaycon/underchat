import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import DashboardController from '@/controllers/dashboard';
import { getDashboardStatsSchema } from '@core/schema/dashboard/getDashboardStats';
import { getDashboardConversationsSchema } from '@core/schema/dashboard/getDashboardConversations';
import { getDashboardAdditionalSchema } from '@core/schema/dashboard/getDashboardAdditional';
import { listOfflineChannelsSchema } from '@core/schema/dashboard/listOfflineChannels';

export default function dashboardRoutes(server: FastifyInstance) {
  const dashboardController = container.resolve(DashboardController);

  server.get('/dashboard/stats', {
    schema: getDashboardStatsSchema,
    handler: dashboardController.getDashboardStats,
    preHandler: [
      (request, reply) => server.authenticateJwt(request, reply, []),
    ],
  });

  server.get('/dashboard/conversations', {
    schema: getDashboardConversationsSchema,
    handler: dashboardController.getDashboardConversations,
    preHandler: [
      (request, reply) => server.authenticateJwt(request, reply, []),
    ],
  });

  server.get('/dashboard/additional', {
    schema: getDashboardAdditionalSchema,
    handler: dashboardController.getDashboardAdditional,
    preHandler: [
      (request, reply) => server.authenticateJwt(request, reply, []),
    ],
  });

  server.get('/dashboard/offline-channels', {
    schema: listOfflineChannelsSchema,
    handler: dashboardController.listOfflineChannels,
    preHandler: [
      (request, reply) => server.authenticateJwt(request, reply, []),
    ],
  });
}
