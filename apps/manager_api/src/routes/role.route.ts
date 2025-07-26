import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import RoleController from '@/controllers/role';
import {
  roleCreatePermissions,
  roleDeletePermissions,
  roleEditPermissions,
  roleListPermissions,
  roleViewPermissions,
} from '@/permissions/role.permissions';
import { listRoleSchema } from '@core/schema/role/listRole';
import { viewRoleSchema } from '@core/schema/role/viewRole';
import { deleteRoleSchema } from '@core/schema/role/deleteRole';
import { editRoleSchema } from '@core/schema/role/editRole';
import { createRoleSchema } from '@core/schema/role/createServer';

export default async function roleRoutes(server: FastifyInstance) {
  const roleController = container.resolve(RoleController);

  server.get('/role', {
    schema: listRoleSchema,
    handler: roleController.listRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleListPermissions),
    ],
  });

  server.get('/role/:permission_role_id', {
    schema: viewRoleSchema,
    handler: roleController.viewRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleViewPermissions),
    ],
  });

  server.delete('/role/:permission_role_id', {
    schema: deleteRoleSchema,
    handler: roleController.deleteRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleDeletePermissions),
    ],
  });

  server.patch('/role/:permission_role_id', {
    schema: editRoleSchema,
    handler: roleController.editRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleEditPermissions),
    ],
  });

  server.post('/role', {
    schema: createRoleSchema,
    handler: roleController.createRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleCreatePermissions),
    ],
  });
}
