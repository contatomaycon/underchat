import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  accountCreatePermissions,
  accountDeletePermissions,
  accountUpdatePermissions,
  accountViewPermissions,
} from '@/permissions';
import AccountController from '@/controllers/account';
import { listAccountSchema } from '@core/schema/account/listAccount';
import { createAccountSchema } from '@core/schema/account/createAccount';
import { viewAccountSchema } from '@core/schema/account/viewAccount';
import { deleteAccountSchema } from '@core/schema/account/deleteAccount';
import { editAccountSchema } from '@core/schema/account/editAccount';
import { viewAccountInfoSchema } from '@core/schema/account/viewAccountInfo';
import { createAccountInfoSchema } from '@core/schema/account/createAccountInfo';
import { editAccountInfoSchema } from '@core/schema/account/editAccountInfo';
import { deleteAccountInfoSchema } from '@core/schema/account/deleteAccountInfo';
import { listAllAccountsSchema } from '@core/schema/account/listAllAccounts';
import { listAccountSubscriptionsSchema } from '@core/schema/account/listAccountSubscriptions';

export default async function accountRoutes(server: FastifyInstance) {
  const accountController = container.resolve(AccountController);

  server.get('/account/all', {
    schema: listAllAccountsSchema,
    handler: accountController.listAllAccounts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountViewPermissions),
    ],
  });

  server.get('/account', {
    schema: listAccountSchema,
    handler: accountController.listAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountViewPermissions),
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

  server.get('/account-info/:account_id', {
    schema: viewAccountInfoSchema,
    handler: accountController.viewAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountViewPermissions),
    ],
  });

  server.post('/account-info', {
    schema: createAccountInfoSchema,
    handler: accountController.createAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountCreatePermissions),
    ],
  });

  server.patch('/account-info/:account_info_id', {
    schema: editAccountInfoSchema,
    handler: accountController.updateAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountUpdatePermissions),
    ],
  });

  server.delete('/account-info/:account_info_id', {
    schema: deleteAccountInfoSchema,
    handler: accountController.deleteAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountDeletePermissions),
    ],
  });

  server.get('/account/:account_id/subscriptions', {
    schema: listAccountSubscriptionsSchema,
    handler: accountController.listAccountSubscriptions,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountViewPermissions),
    ],
  });
}
