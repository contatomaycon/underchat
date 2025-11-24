import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import { chatPermissions } from '@/permissions';
import { listChatsUserSchema } from '@core/schema/chat/listChatsUser';
import { updateChatsUserSchema } from '@core/schema/chat/updateChatsUser';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { createChatSchema } from '@core/schema/chat/createChat';
import { viewLinkPreviewSchema } from '@core/schema/chat/viewLinkPreview';
import { reactMessageSchema } from '@core/schema/chat/reactMessage';
import { deleteMessageSchema } from '@core/schema/chat/deleteMessage';
import { editMessageSchema } from '@core/schema/chat/editMessage';
import { updateChatStatusSchema } from '@core/schema/chat/updateChatStatus';
import { clearChatSummarySchema } from '@core/schema/chat/clearChatSummary';
import { startChatWithContactSchema } from '@core/schema/chat/startChatWithContact';
import { searchMessagesSchema } from '@core/schema/chat/searchMessages';
import { transferChatSchema } from '@core/schema/chat/transferChat';

export default function chatRoutes(server: FastifyInstance) {
  const chatController = container.resolve(ChatController);

  server.get('/chat', {
    schema: listChatsSchema,
    handler: chatController.listChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat', {
    schema: createChatSchema,
    handler: chatController.createChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/start-with-contact', {
    schema: startChatWithContactSchema,
    handler: chatController.startChatWithContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/link-preview', {
    schema: viewLinkPreviewSchema,
    handler: chatController.viewChatLinkPreview,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.get('/chat/:chat_id', {
    schema: listMessageChatsSchema,
    handler: chatController.listMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.get('/chat/:chat_id/search', {
    schema: searchMessagesSchema,
    handler: chatController.searchMessages,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id', {
    schema: createMessageChatsSchema,
    handler: chatController.createMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.get('/chat/user', {
    schema: listChatsUserSchema,
    handler: chatController.listChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.put('/chat/user', {
    schema: updateChatsUserSchema,
    handler: chatController.updateChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/react', {
    schema: reactMessageSchema,
    handler: chatController.reactMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/delete', {
    schema: deleteMessageSchema,
    handler: chatController.deleteMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/edit', {
    schema: editMessageSchema,
    handler: chatController.editMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.patch('/chat/:chat_id/status', {
    schema: updateChatStatusSchema,
    handler: chatController.updateChatStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id/clear-summary', {
    schema: clearChatSummarySchema,
    handler: chatController.clearChatSummary,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });

  server.post('/chat/:chat_id/transfer', {
    schema: transferChatSchema,
    handler: chatController.transferChat,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
    ],
  });
}
