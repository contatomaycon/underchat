import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import RoleController from '@/controllers/role';
import {
  roleCreatePermissions,
  roleDeletePermissions,
  roleEditPermissions,
  roleViewPermissions,
} from '@/permissions/role.permissions';
import { listRoleSchema } from '@core/schema/role/listRole';
import { viewRoleSchema } from '@core/schema/role/viewRole';
import { deleteRoleSchema } from '@core/schema/role/deleteRole';
import { editRoleSchema } from '@core/schema/role/editRole';
import { createRoleSchema } from '@core/schema/role/createRole';
import { blockRoleSchema } from '@core/schema/role/blockRole';
import { unblockRoleSchema } from '@core/schema/role/unblockRole';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function roleRoutes(server: FastifyInstance) {
  const roleController = container.resolve(RoleController);

  server.get('/role', {
    schema: listRoleSchema,
    handler: roleController.listRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/role/:permission_role_id', {
    schema: viewRoleSchema,
    handler: roleController.viewRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/role/:permission_role_id', {
    schema: deleteRoleSchema,
    handler: roleController.deleteRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.put('/role/:permission_role_id', {
    schema: editRoleSchema,
    handler: roleController.editRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/role/:permission_role_id/block', {
    schema: blockRoleSchema,
    handler: roleController.blockRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/role/:permission_role_id/unblock', {
    schema: unblockRoleSchema,
    handler: roleController.unblockRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleEditPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/role', {
    schema: createRoleSchema,
    handler: roleController.createRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, roleCreatePermissions),
      planGuard,
      planStatus,
    ],
  });
}
