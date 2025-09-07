import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import UserController from '@/controllers/user';
import {
  userCreatePermissions,
  userDeletePermissions,
  userListPermissions,
  userUpdatePermissions,
  userViewPermissions,
} from '@/permissions';
import { listUserSchema } from '@core/schema/user/listUser';
import { deleteUserSchema } from '@core/schema/user/deleteUser';
import { viewUserSchema } from '@core/schema/user/viewUser';
import { createUserSchema } from '@core/schema/user/createUser';
import { editUserSchema } from '@core/schema/user/editUser';

export default async function userRoutes(server: FastifyInstance) {
  const userController = container.resolve(UserController);

  server.get('/user', {
    schema: listUserSchema,
    handler: userController.listUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userListPermissions),
    ],
  });

  server.post('/user', {
    schema: createUserSchema,
    handler: userController.createUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userCreatePermissions),
    ],
  });

  server.get('/user/:user_id', {
    schema: viewUserSchema,
    handler: userController.viewUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userViewPermissions),
    ],
  });

  server.delete('/user/:user_id', {
    schema: deleteUserSchema,
    handler: userController.deleteUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userDeletePermissions),
    ],
  });

  server.patch('/user/:user_id', {
    schema: editUserSchema,
    handler: userController.updateUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, userUpdatePermissions),
    ],
  });
}
