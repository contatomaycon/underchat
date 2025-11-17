import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import {
  createChatPermissions,
  updateChatUserPermissions,
  viewChatPermissions,
} from '@/permissions';
import { listChatsUserSchema } from '@core/schema/chat/listChatsUser';
import { updateChatsUserSchema } from '@core/schema/chat/updateChatsUser';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { createChatSchema } from '@core/schema/chat/createChat';
import { viewLinkPreviewSchema } from '@core/schema/chat/viewLinkPreview';
import { reactMessageSchema } from '@core/schema/chat/reactMessage';
import { deleteMessageSchema } from '@core/schema/chat/deleteMessage';

export default function chatRoutes(server: FastifyInstance) {
  const chatController = container.resolve(ChatController);

  server.get('/chat', {
    schema: listChatsSchema,
    handler: chatController.listChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, viewChatPermissions),
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

  server.post('/chat/link-preview', {
    schema: viewLinkPreviewSchema,
    handler: chatController.viewChatLinkPreview,
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
        server.authenticateJwt(request, reply, viewChatPermissions),
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
        server.authenticateJwt(request, reply, viewChatPermissions),
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

  server.post('/chat/:chat_id/message/:message_id/react', {
    schema: reactMessageSchema,
    handler: chatController.reactMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, createChatPermissions),
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/delete', {
    schema: deleteMessageSchema,
    handler: chatController.deleteMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, createChatPermissions),
    ],
  });
}
