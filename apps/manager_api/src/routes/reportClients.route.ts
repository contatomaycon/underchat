import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import AccountController from '@/controllers/account';
import { clientsViewPermissions } from '@/permissions/clients.permissions';
import { listAccountSchema } from '@core/schema/account/listAccount';

export default function reportClientsRoutes(server: FastifyInstance) {
  const accountController = container.resolve(AccountController);

  server.get('/clients/account', {
    schema: listAccountSchema,
    handler: accountController.listAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, clientsViewPermissions),
    ],
  });
}
