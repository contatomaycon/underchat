import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import { listChatPermissions, listChatUserPermissions } from '@/permissions';
import { listChatsUserSchema } from '@core/schema/chat/listChatsUser';

export default async function chatRoutes(server: FastifyInstance) {
  const chatController = container.resolve(ChatController);

  server.get('/chat', {
    schema: listChatsSchema,
    handler: chatController.listChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, listChatPermissions),
    ],
  });

  server.get('/chat/user', {
    schema: listChatsUserSchema,
    handler: chatController.listChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, listChatUserPermissions),
    ],
  });
}
