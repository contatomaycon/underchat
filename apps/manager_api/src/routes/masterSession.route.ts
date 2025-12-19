import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import MasterSessionController from '@/controllers/masterSession';
import { masterSessionPermissions } from '@/permissions';
import { listAccountsSchema } from '@core/schema/masterSession/listAccounts';
import { loginSchema } from '@core/schema/masterSession/login';

export default function masterSessionRoutes(server: FastifyInstance) {
  const masterSessionController = container.resolve(MasterSessionController);

  server.get('/master-session/accounts', {
    schema: listAccountsSchema,
    handler: masterSessionController.listAccounts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, masterSessionPermissions),
    ],
  });

  server.post('/master-session/login', {
    schema: loginSchema,
    handler: masterSessionController.login,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, masterSessionPermissions),
    ],
  });
}
