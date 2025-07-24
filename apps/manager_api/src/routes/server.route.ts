import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createServerSchema } from '@core/schema/server/createServer';
import ServerController from '@/controllers/server';
import {
  serverCreatePermissions,
  serverDeletePermissions,
  serverEditPermissions,
} from '@/permissions/server.permissions';
import { deleteServerSchema } from '@core/schema/server/deleteServer';
import { editServerSchema } from '@core/schema/server/editServer';

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
}
