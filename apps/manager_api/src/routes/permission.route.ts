import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import PermissionController from '@/controllers/permission';
import { permissionViewPermissions } from '@/permissions/permission.permissions';
import { listPermissionGroupsSchema } from '@core/schema/permission/listPermissionGroups';
import { viewPermissionGroupsUserSchema } from '@core/schema/permission/viewPermissionGroupsUser';

export default function permissionRoutes(server: FastifyInstance) {
  const permissionController = container.resolve(PermissionController);

  server.get('/permission/groups/user', {
    schema: listPermissionGroupsSchema,
    handler: permissionController.listPermissionGroups,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, permissionViewPermissions),
    ],
  });

  server.get('/permission/groups/user/:permission_role_id', {
    schema: viewPermissionGroupsUserSchema,
    handler: permissionController.listPermissionGroupsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, permissionViewPermissions),
    ],
  });
}
