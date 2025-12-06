import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import NotificationsController from '@/controllers/notifications';
import { listNotificationsSchema } from '@core/schema/notifications/listNotifications';
import { updateNotificationsSchema } from '@core/schema/notifications/updateNotifications';
import { listWorkersSchema } from '@core/schema/notifications/listWorkers';
import {
  notificationsViewPermissions,
  notificationsUpdatePermissions,
} from '@/permissions';

export default async function notificationsRoutes(server: FastifyInstance) {
  const notificationsController = container.resolve(NotificationsController);

  server.get('/notifications', {
    schema: listNotificationsSchema,
    handler: notificationsController.listNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, notificationsViewPermissions),
    ],
  });

  server.patch('/notifications', {
    schema: updateNotificationsSchema,
    handler: notificationsController.updateNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, notificationsUpdatePermissions),
    ],
  });

  server.get('/notifications/workers', {
    schema: listWorkersSchema,
    handler: notificationsController.listWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, notificationsViewPermissions),
    ],
  });
}
