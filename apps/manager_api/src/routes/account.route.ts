import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  accountCreatePermissions,
  accountDeletePermissions,
  accountListPermissions,
  accountUpdatePermissions,
  accountViewPermissions,
} from '@/permissions';
import AccountController from '@/controllers/account';
import { listAccountSchema } from '@core/schema/account/listAccount';
import { createAccountSchema } from '@core/schema/account/createAccount';
import { viewAccountSchema } from '@core/schema/account/viewAccount';
import { deleteAccountSchema } from '@core/schema/account/deleteAccount';
import { editAccountSchema } from '@core/schema/account/editAccount';

export default async function accountRoutes(server: FastifyInstance) {
  const accountController = container.resolve(AccountController);

  server.get('/account', {
    schema: listAccountSchema,
    handler: accountController.listAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountListPermissions),
    ],
  });

  server.post('/account', {
    schema: createAccountSchema,
    handler: accountController.createAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountCreatePermissions),
    ],
  });

  server.get('/account/:account_id', {
    schema: viewAccountSchema,
    handler: accountController.viewAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountViewPermissions),
    ],
  });

  server.delete('/account/:account_id', {
    schema: deleteAccountSchema,
    handler: accountController.deleteAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountDeletePermissions),
    ],
  });

  server.patch('/account/:account_id', {
    schema: editAccountSchema,
    handler: accountController.updateAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountUpdatePermissions),
    ],
  });
}
