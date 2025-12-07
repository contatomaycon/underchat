import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ConfigController from '@/controllers/config';
import { listNotificationsSchema } from '@core/schema/notifications/listNotifications';
import { updateNotificationsSchema } from '@core/schema/notifications/updateNotifications';
import { listWorkersSchema } from '@core/schema/notifications/listWorkers';
import { listSentNotificationsSchema } from '@core/schema/notifications/listSentNotifications';
import { listNfseSchema } from '@core/schema/config/listNfse';
import { updateNfseSchema } from '@core/schema/config/updateNfse';
import { configPermissions } from '@/permissions';

export default async function configRoutes(server: FastifyInstance) {
  const configController = container.resolve(ConfigController);

  server.get('/config/notifications', {
    schema: listNotificationsSchema,
    handler: configController.listNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/notifications', {
    schema: updateNotificationsSchema,
    handler: configController.updateNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/notifications/workers', {
    schema: listWorkersSchema,
    handler: configController.listWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/notifications/sent', {
    schema: listSentNotificationsSchema,
    handler: configController.listSentNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.get('/config/nfse', {
    schema: listNfseSchema,
    handler: configController.listNfse,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });

  server.patch('/config/nfse', {
    schema: updateNfseSchema,
    handler: configController.updateNfse,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, configPermissions),
    ],
  });
}
