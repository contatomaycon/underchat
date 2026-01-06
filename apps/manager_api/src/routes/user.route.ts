import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import UserController from '@/controllers/user';
import {
  userCreatePermissions,
  userDeletePermissions,
  userUpdatePermissions,
  userViewPermissions,
  masterSessionPermissions,
} from '@/permissions';
import { listUserSchema } from '@core/schema/user/listUser';
import { listAllUsersSchema } from '@core/schema/user/listAllUsers';
import { deleteUserSchema } from '@core/schema/user/deleteUser';
import { viewUserSchema } from '@core/schema/user/viewUser';
import { viewUserPhoneSchema } from '@core/schema/user/viewUserPhone';
import { viewUserEmailSchema } from '@core/schema/user/viewUserEmail';
import { viewUserDocumentSchema } from '@core/schema/user/viewUserDocument';
import { viewUserAddress1Schema } from '@core/schema/user/viewUserAddress1';
import { viewUserAddress2Schema } from '@core/schema/user/viewUserAddress2';
import { createUserSchema } from '@core/schema/user/createUser';
import { editUserSchema } from '@core/schema/user/editUser';
import { assignUserRoleSchema } from '@core/schema/user/assignUserRole';
import { viewUserRoleSchema } from '@core/schema/user/viewUserRole';
import { uploadPhotoSchema } from '@core/schema/user/uploadPhoto';
import { deletePhotoSchema } from '@core/schema/user/deletePhoto';
import { listUserRolesSchema } from '@core/schema/user/listUserRoles';
import { sessionLoginSchema } from '@core/schema/user/sessionLogin';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function userRoutes(server: FastifyInstance) {
  const userController = container.resolve(UserController);

  server.get('/user', {
    schema: listUserSchema,
    handler: userController.listUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/all', {
    schema: listAllUsersSchema,
    handler: userController.listAllUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/user', {
    schema: createUserSchema,
    handler: userController.createUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id', {
    schema: viewUserSchema,
    handler: userController.viewUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/phone', {
    schema: viewUserPhoneSchema,
    handler: userController.viewUserPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/email', {
    schema: viewUserEmailSchema,
    handler: userController.viewUserEmail,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/document', {
    schema: viewUserDocumentSchema,
    handler: userController.viewUserDocument,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/address1', {
    schema: viewUserAddress1Schema,
    handler: userController.viewUserAddress1,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/address2', {
    schema: viewUserAddress2Schema,
    handler: userController.viewUserAddress2,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/user/:user_id', {
    schema: deleteUserSchema,
    handler: userController.deleteUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/user/:user_id', {
    schema: editUserSchema,
    handler: userController.updateUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/:user_id/role', {
    schema: viewUserRoleSchema,
    handler: userController.viewUserRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/user/:user_id/role', {
    schema: assignUserRoleSchema,
    handler: userController.assignUserRole,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/user/:user_id/photo', {
    schema: uploadPhotoSchema,
    handler: userController.uploadPhoto,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/user/:user_id/photo', {
    schema: deletePhotoSchema,
    handler: userController.deletePhoto,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/user/roles', {
    schema: listUserRolesSchema,
    handler: userController.listUserRoles,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/user/:user_id/session-login', {
    schema: sessionLoginSchema,
    handler: userController.sessionLogin,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, masterSessionPermissions),
    ],
  });
}
