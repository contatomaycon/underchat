import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import UserController from '@/controllers/user';
import { clientsViewPermissions } from '@/permissions/clients.permissions';
import { listUserSchema } from '@core/schema/user/listUser';
import { viewUserEmailSchema } from '@core/schema/user/viewUserEmail';
import { viewUserPhoneSchema } from '@core/schema/user/viewUserPhone';
import { viewUserDocumentSchema } from '@core/schema/user/viewUserDocument';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function reportUsersRoutes(server: FastifyInstance) {
  const userController = container.resolve(UserController);

  server.get('/users/user', {
    schema: listUserSchema,
    handler: userController.listUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, clientsViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/users/user/:user_id/email', {
    schema: viewUserEmailSchema,
    handler: userController.viewUserEmail,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, clientsViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/users/user/:user_id/phone', {
    schema: viewUserPhoneSchema,
    handler: userController.viewUserPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, clientsViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/users/user/:user_id/document', {
    schema: viewUserDocumentSchema,
    handler: userController.viewUserDocument,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, clientsViewPermissions),
      planGuard,
      planStatus,
    ],
  });
}
