import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import { listChatPermissions } from '@/permissions';

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
}
