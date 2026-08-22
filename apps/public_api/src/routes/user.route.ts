import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { container } from 'tsyringe';
import UserController from '@core/controllers/user';
import {
  userCreatePermissions,
  userDeletePermissions,
  userUpdatePermissions,
  userViewPermissions,
} from '@core/permissions/publicApi.permissions';
import { assignUserRoleSchema } from '@core/schema/user/assignUserRole';
import { blockUserSchema } from '@core/schema/user/blockUser';
import { createUserSchema } from '@core/schema/user/createUser';
import { deletePhotoSchema } from '@core/schema/user/deletePhoto';
import { deleteUserSchema } from '@core/schema/user/deleteUser';
import { editUserSchema } from '@core/schema/user/editUser';
import { listAllUsersSchema } from '@core/schema/user/listAllUsers';
import { listUserSchema } from '@core/schema/user/listUser';
import { listUserChannelsSchema } from '@core/schema/user/listUserChannels';
import { listUserRolesSchema } from '@core/schema/user/listUserRoles';
import { listUserSectorsSchema } from '@core/schema/user/listUserSectors';
import { unblockUserSchema } from '@core/schema/user/unblockUser';
import { updateAttendanceHoursSchema } from '@core/schema/user/updateAttendanceHours';
import { uploadPhotoSchema } from '@core/schema/user/uploadPhoto';
import { viewAttendanceHoursSchema } from '@core/schema/user/viewAttendanceHours';
import { viewAttendanceHoursStatusSchema } from '@core/schema/user/viewAttendanceHoursStatus';
import { viewUserSchema } from '@core/schema/user/viewUser';
import { viewUserAddress1Schema } from '@core/schema/user/viewUserAddress1';
import { viewUserAddress2Schema } from '@core/schema/user/viewUserAddress2';
import { viewUserChannelsSchema } from '@core/schema/user/viewUserChannels';
import { viewUserDocumentSchema } from '@core/schema/user/viewUserDocument';
import { viewUserEmailSchema } from '@core/schema/user/viewUserEmail';
import { viewUserPhoneSchema } from '@core/schema/user/viewUserPhone';
import { viewUserRoleSchema } from '@core/schema/user/viewUserRole';
import { viewUserSectorsSchema } from '@core/schema/user/viewUserSectors';
import { planGuard, planStatus } from '@core/middlewares/planAccess.middleware';
import { listPublicUsers } from '@/controllers/user/listPublicUsers';
import {
  guardPublicUserReferences,
  guardPublicUserTarget,
} from '@/middlewares/publicUserScope.middleware';
import { publicUserSchema } from '@/schema/user/publicUserSchema';

type PermissionGroup = Parameters<
  FastifyInstance['authenticatePublicApiToken']
>[2];

export default function publicUserRoutes(server: FastifyInstance): void {
  const userController = container.resolve(UserController);
  const authenticate =
    (permissions: PermissionGroup): preHandlerHookHandler =>
    (request, reply) =>
      server.authenticatePublicApiToken(request, reply, permissions);
  const targetScoped = [guardPublicUserTarget, planGuard, planStatus];

  server.get('/user', {
    schema: publicUserSchema(listUserSchema, {
      omitAccountIdFrom: 'querystring',
    }),
    handler: userController.listUser,
    preHandler: [
      authenticate(userViewPermissions),
      guardPublicUserReferences,
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/all', {
    schema: publicUserSchema(listAllUsersSchema, { requireExecutor: false }),
    handler: listPublicUsers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiAccountToken(request, reply),
      planGuard,
      planStatus,
    ],
  });

  server.post('/user', {
    schema: publicUserSchema(createUserSchema, {
      omitAccountIdFrom: 'body',
    }),
    handler: userController.createUser,
    preHandler: [
      authenticate(userCreatePermissions),
      guardPublicUserReferences,
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/me/attendance-hours/status', {
    schema: publicUserSchema(viewAttendanceHoursStatusSchema),
    handler: userController.viewAttendanceHoursStatus,
    preHandler: [authenticate([]), planGuard, planStatus],
  });

  server.get('/user/:user_id/attendance-hours', {
    schema: publicUserSchema(viewAttendanceHoursSchema),
    handler: userController.viewAttendanceHours,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.put('/user/:user_id/attendance-hours', {
    schema: publicUserSchema(updateAttendanceHoursSchema),
    handler: userController.updateAttendanceHours,
    preHandler: [authenticate(userUpdatePermissions), ...targetScoped],
  });

  server.get('/user/:user_id', {
    schema: publicUserSchema(viewUserSchema),
    handler: userController.viewUser,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.post('/user/:user_id/block', {
    schema: publicUserSchema(blockUserSchema),
    handler: userController.blockUser,
    preHandler: [authenticate(userUpdatePermissions), ...targetScoped],
  });

  server.post('/user/:user_id/unblock', {
    schema: publicUserSchema(unblockUserSchema),
    handler: userController.unblockUser,
    preHandler: [authenticate(userUpdatePermissions), ...targetScoped],
  });

  server.get('/user/:user_id/phone', {
    schema: publicUserSchema(viewUserPhoneSchema),
    handler: userController.viewUserPhone,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.get('/user/:user_id/email', {
    schema: publicUserSchema(viewUserEmailSchema),
    handler: userController.viewUserEmail,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.get('/user/:user_id/document', {
    schema: publicUserSchema(viewUserDocumentSchema),
    handler: userController.viewUserDocument,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.get('/user/:user_id/address1', {
    schema: publicUserSchema(viewUserAddress1Schema),
    handler: userController.viewUserAddress1,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.get('/user/:user_id/address2', {
    schema: publicUserSchema(viewUserAddress2Schema),
    handler: userController.viewUserAddress2,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.delete('/user/:user_id', {
    schema: publicUserSchema(deleteUserSchema),
    handler: userController.deleteUser,
    preHandler: [authenticate(userDeletePermissions), ...targetScoped],
  });

  server.patch('/user/:user_id', {
    schema: publicUserSchema(editUserSchema, { omitAccountIdFrom: 'body' }),
    handler: userController.updateUser,
    preHandler: [
      authenticate(userUpdatePermissions),
      guardPublicUserTarget,
      guardPublicUserReferences,
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/role', {
    schema: publicUserSchema(viewUserRoleSchema),
    handler: userController.viewUserRole,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.post('/user/:user_id/role', {
    schema: publicUserSchema(assignUserRoleSchema),
    handler: userController.assignUserRole,
    preHandler: [
      authenticate(userUpdatePermissions),
      guardPublicUserTarget,
      guardPublicUserReferences,
      planGuard,
      planStatus,
    ],
  });

  server.post('/user/:user_id/photo', {
    schema: publicUserSchema(uploadPhotoSchema),
    handler: userController.uploadPhoto,
    preHandler: [authenticate(userUpdatePermissions), ...targetScoped],
  });

  server.delete('/user/:user_id/photo', {
    schema: publicUserSchema(deletePhotoSchema),
    handler: userController.deletePhoto,
    preHandler: [authenticate(userUpdatePermissions), ...targetScoped],
  });

  server.get('/user/roles', {
    schema: publicUserSchema(listUserRolesSchema, {
      omitAccountIdFrom: 'querystring',
    }),
    handler: userController.listUserRoles,
    preHandler: [authenticate(userViewPermissions), planGuard, planStatus],
  });

  server.get('/user/sectors', {
    schema: publicUserSchema(listUserSectorsSchema, {
      omitAccountIdFrom: 'querystring',
    }),
    handler: userController.listUserSectors,
    preHandler: [authenticate(userViewPermissions), planGuard, planStatus],
  });

  server.get('/user/:user_id/sectors', {
    schema: publicUserSchema(viewUserSectorsSchema),
    handler: userController.viewUserSectors,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });

  server.get('/user/channels', {
    schema: publicUserSchema(listUserChannelsSchema),
    handler: userController.listUserChannels,
    preHandler: [authenticate(userViewPermissions), planGuard, planStatus],
  });

  server.get('/user/:user_id/channels', {
    schema: publicUserSchema(viewUserChannelsSchema),
    handler: userController.viewUserChannels,
    preHandler: [authenticate(userViewPermissions), ...targetScoped],
  });
}
