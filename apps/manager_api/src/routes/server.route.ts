import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createServerSchema } from '@core/schema/server/createServer';
import ServerController from '@/controllers/server';
import {
  serverCreatePermissions,
  serverDeletePermissions,
  serverEditPermissions,
  serverLogsInstallPermissions,
  serverViewPermissions,
} from '@/permissions/server.permissions';
import { deleteServerSchema } from '@core/schema/server/deleteServer';
import { editServerSchema } from '@core/schema/server/editServer';
import { viewServerSchema } from '@core/schema/server/viewServer';
import { listServerSchema } from '@core/schema/server/listServer';
import { serverLogsInstallSchema } from '@core/schema/server/serverLogsInstall';

export default async function serverRoutes(server: FastifyInstance) {
  const serverController = container.resolve(ServerController);

  server.post('/server', {
    schema: createServerSchema,
    handler: serverController.createServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverCreatePermissions),
    ],
  });

  server.get('/server', {
    schema: listServerSchema,
    handler: serverController.listServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverViewPermissions),
    ],
  });

  server.delete('/server/:server_id', {
    schema: deleteServerSchema,
    handler: serverController.deleteServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverDeletePermissions),
    ],
  });

  server.put('/server/:server_id', {
    schema: editServerSchema,
    handler: serverController.editServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverEditPermissions),
    ],
  });

  server.get('/server/:server_id', {
    schema: viewServerSchema,
    handler: serverController.viewServer,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverViewPermissions),
    ],
  });

  server.get('/server/logs/install/:server_id', {
    schema: serverLogsInstallSchema,
    handler: serverController.serverLogsInstall,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, serverLogsInstallPermissions),
    ],
  });
}
