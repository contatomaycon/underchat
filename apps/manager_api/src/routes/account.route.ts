import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { accountPermissions } from '@/permissions';
import AccountController from '@/controllers/account';
import { listAccountSchema } from '@core/schema/account/listAccount';
import { createAccountSchema } from '@core/schema/account/createAccount';
import { viewAccountSchema } from '@core/schema/account/viewAccount';
import { deleteAccountSchema } from '@core/schema/account/deleteAccount';
import { editAccountSchema } from '@core/schema/account/editAccount';
import { viewAccountInfoSchema } from '@core/schema/account/viewAccountInfo';
import { createAccountInfoSchema } from '@core/schema/account/createAccountInfo';
import { editAccountInfoSchema } from '@core/schema/account/editAccountInfo';
import { listAllAccountsSchema } from '@core/schema/account/listAllAccounts';
import { listAccountSubscriptionsSchema } from '@core/schema/account/listAccountSubscriptions';
import { updatePlanAccountSchema } from '@core/schema/planAccount/updatePlanAccount';
import { viewPlanAccountSchema } from '@core/schema/planAccount/viewPlanAccount';
import { listPlanAccountExclusiveSchema } from '@core/schema/planAccountExclusive/listPlanAccountExclusive';
import { createPlanAccountExclusiveSchema } from '@core/schema/planAccountExclusive/createPlanAccountExclusive';
import { deletePlanAccountExclusiveSchema } from '@core/schema/planAccountExclusive/deletePlanAccountExclusive';
import { listExclusivePlansSchema } from '@core/schema/planAccountExclusive/listExclusivePlans';
import { blockAccountSchema } from '@core/schema/account/blockAccount';
import { unblockAccountSchema } from '@core/schema/account/unblockAccount';

export default async function accountRoutes(server: FastifyInstance) {
  const accountController = container.resolve(AccountController);

  server.get('/account/all', {
    schema: listAllAccountsSchema,
    handler: accountController.listAllAccounts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/all-with-details', {
    schema: listAccountSchema,
    handler: accountController.listAllAccountsWithDetails,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account', {
    schema: listAccountSchema,
    handler: accountController.listAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.post('/account', {
    schema: createAccountSchema,
    handler: accountController.createAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/:account_id', {
    schema: viewAccountSchema,
    handler: accountController.viewAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.delete('/account/:account_id', {
    schema: deleteAccountSchema,
    handler: accountController.deleteAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.patch('/account/:account_id', {
    schema: editAccountSchema,
    handler: accountController.updateAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/info/:account_id', {
    schema: viewAccountInfoSchema,
    handler: accountController.viewAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.post('/account/info', {
    schema: createAccountInfoSchema,
    handler: accountController.createAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.patch('/account/info/:account_info_id', {
    schema: editAccountInfoSchema,
    handler: accountController.updateAccountInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/:account_id/subscriptions', {
    schema: listAccountSubscriptionsSchema,
    handler: accountController.listAccountSubscriptions,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/:account_id/plan-account', {
    schema: viewPlanAccountSchema,
    handler: accountController.viewPlanAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.patch('/account/:account_id/plan-account', {
    schema: updatePlanAccountSchema,
    handler: accountController.updatePlanAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/:account_id/exclusive-plans', {
    schema: listPlanAccountExclusiveSchema,
    handler: accountController.listPlanAccountExclusive,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.get('/account/:account_id/exclusive-plans/available', {
    schema: listExclusivePlansSchema,
    handler: accountController.listExclusivePlans,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.post('/account/exclusive-plan', {
    schema: createPlanAccountExclusiveSchema,
    handler: accountController.createPlanAccountExclusive,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.delete('/account/exclusive-plan/:plan_account_exclusive_id', {
    schema: deletePlanAccountExclusiveSchema,
    handler: accountController.deletePlanAccountExclusive,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.patch('/account/:account_id/block', {
    schema: blockAccountSchema,
    handler: accountController.blockAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });

  server.patch('/account/:account_id/unblock', {
    schema: unblockAccountSchema,
    handler: accountController.unblockAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, accountPermissions),
    ],
  });
}
