import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  releaseViewPermissions,
  releaseCreatePermissions,
  releaseDeletePermissions,
  releaseUpdatePermissions,
} from '@/permissions';
import ReleaseController from '@/controllers/release';
import { listReleaseSchema } from '@core/schema/release/listRelease';
import { viewReleaseSchema } from '@core/schema/release/viewRelease';
import { createReleaseSchema } from '@core/schema/release/createRelease';
import { listReleaseUsersSchema } from '@core/schema/release/listReleaseUsers';
import { listReleaseAccountsSchema } from '@core/schema/release/listReleaseAccounts';
import { listReleasePermissionRolesSchema } from '@core/schema/release/listReleasePermissionRoles';
import { listReleaseNotificationsSchema } from '@core/schema/release/listReleaseNotifications';
import { deleteReleaseSchema } from '@core/schema/release/deleteRelease';
import { editReleaseSchema } from '@core/schema/release/editRelease';

export default async function releaseRoutes(server: FastifyInstance) {
  const releaseController = container.resolve(ReleaseController);

  server.get('/release/notifications', {
    schema: listReleaseNotificationsSchema,
    handler: releaseController.listReleaseNotifications,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.get('/release', {
    schema: listReleaseSchema,
    handler: releaseController.listRelease,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.get('/release/users', {
    schema: listReleaseUsersSchema,
    handler: releaseController.listReleaseUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.get('/release/accounts', {
    schema: listReleaseAccountsSchema,
    handler: releaseController.listReleaseAccounts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.get('/release/permission-roles', {
    schema: listReleasePermissionRolesSchema,
    handler: releaseController.listReleasePermissionRoles,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.get('/release/:release_id', {
    schema: viewReleaseSchema,
    handler: releaseController.viewRelease,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseViewPermissions),
    ],
  });

  server.delete('/release/:release_id', {
    schema: deleteReleaseSchema,
    handler: releaseController.deleteRelease,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseDeletePermissions),
    ],
  });

  server.patch('/release/:release_id', {
    schema: editReleaseSchema,
    handler: releaseController.editRelease,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseUpdatePermissions),
    ],
  });

  server.post('/release', {
    schema: createReleaseSchema,
    handler: releaseController.createRelease,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, releaseCreatePermissions),
    ],
  });
}
