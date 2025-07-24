import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { createServerSchema } from '@core/schema/server/createServer';
import ServerController from '@/controllers/server';
import {
  serverCreatePermissions,
  serverDeletePermissions,
} from '@/permissions/server.permissions';
import { deleteServerSchema } from '@core/schema/server/deleteServer';

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
}
