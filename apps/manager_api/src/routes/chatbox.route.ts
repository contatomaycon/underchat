import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ChatboxController from '@/controllers/chatbox';
import { chatboxPermissions } from '@/permissions/chatbox.permissions';
import { listChatboxUsersSchema } from '@core/schema/chatbox/listUsers';
import { listChatboxSectorsSchema } from '@core/schema/chatbox/listSectors';
import { listChatboxSectorUsersSchema } from '@core/schema/chatbox/listSectorUsers';

export default function chatboxRoutes(server: FastifyInstance) {
  const chatboxController = container.resolve(ChatboxController);

  server.get('/chatbox/users', {
    schema: listChatboxUsersSchema,
    handler: chatboxController.listUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatboxPermissions),
    ],
  });

  server.get('/chatbox/sectors', {
    schema: listChatboxSectorsSchema,
    handler: chatboxController.listSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatboxPermissions),
    ],
  });

  server.get('/chatbox/sectors/:sector_id/users', {
    schema: listChatboxSectorUsersSchema,
    handler: chatboxController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatboxPermissions),
    ],
  });
}
