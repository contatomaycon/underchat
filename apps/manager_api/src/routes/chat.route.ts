import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import {
  createChatPermissions,
  listChatPermissions,
  listChatUserPermissions,
  updateChatUserPermissions,
} from '@/permissions';
import { listChatsUserSchema } from '@core/schema/chat/listChatsUser';
import { updateChatsUserSchema } from '@core/schema/chat/updateChatsUser';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { createChatSchema } from '@core/schema/chat/createChat';

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

  server.post('/chat', {
    schema: createChatSchema,
    handler: chatController.createChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, createChatPermissions),
    ],
  });

  server.get('/chat/:chat_id', {
    schema: listMessageChatsSchema,
    handler: chatController.listMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, listChatPermissions),
    ],
  });

  server.post('/chat/:chat_id', {
    schema: createMessageChatsSchema,
    handler: chatController.createMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, createChatPermissions),
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

  server.put('/chat/user', {
    schema: updateChatsUserSchema,
    handler: chatController.updateChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, updateChatUserPermissions),
    ],
  });
}
