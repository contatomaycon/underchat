import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import PermissionController from '@/controllers/permission';
import { permissionViewPermissions } from '@/permissions/permission.permissions';
import { listPermissionGroupsSchema } from '@core/schema/permission/listPermissionGroups';

export default function permissionRoutes(server: FastifyInstance) {
  const permissionController = container.resolve(PermissionController);

  server.get('/permission/groups', {
    schema: listPermissionGroupsSchema,
    handler: permissionController.listPermissionGroups,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, permissionViewPermissions),
    ],
  });
}
