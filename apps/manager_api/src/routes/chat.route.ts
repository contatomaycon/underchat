import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import ChatController from '@/controllers/chat';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';
import { chatPermissions } from '@/permissions';
import { updateChatsUserSchema } from '@core/schema/chat/updateChatsUser';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { viewLinkPreviewSchema } from '@core/schema/chat/viewLinkPreview';
import { reactMessageSchema } from '@core/schema/chat/reactMessage';
import { deleteMessageSchema } from '@core/schema/chat/deleteMessage';
import { editMessageSchema } from '@core/schema/chat/editMessage';
import { updateChatStatusSchema } from '@core/schema/chat/updateChatStatus';
import { clearChatSummarySchema } from '@core/schema/chat/clearChatSummary';
import { startChatWithContactSchema } from '@core/schema/chat/startChatWithContact';
import { searchMessagesSchema } from '@core/schema/chat/searchMessages';
import { transferChatSchema } from '@core/schema/chat/transferChat';
import { searchChatsSchema } from '@core/schema/chat/searchChats';
import { viewWorkerConfigForChatSchema } from '@core/schema/chat/viewWorkerConfigForChat';
import { listTransferOptionsSchema } from '@core/schema/chat/listTransferOptions';
import { listTransferUsersSchema } from '@core/schema/chat/listTransferUsers';
import { listTransferSectorsSchema } from '@core/schema/chat/listTransferSectors';
import { listTransferSectorUsersSchema } from '@core/schema/chat/listTransferSectorUsers';
import { listChatContactsSchema } from '@core/schema/chat/listContacts';
import { viewChatContactSchema } from '@core/schema/chat/viewContact';
import { viewChatContactsBatchSchema } from '@core/schema/chat/viewContactsBatch';
import { viewChatContactEmailSchema } from '@core/schema/chat/viewContactEmail';
import { viewChatContactPhoneSchema } from '@core/schema/chat/viewContactPhone';
import { viewChatContactDocumentSchema } from '@core/schema/chat/viewContactDocument';
import { listChatLabelTemplatesSchema } from '@core/schema/chat/listLabelTemplates';
import { createChatContactSchema } from '@core/schema/chat/createContact';
import { updateChatContactSchema } from '@core/schema/chat/updateContact';
import { deleteChatContactPhotoSchema } from '@core/schema/chat/deleteContactPhoto';
import { validateChatContactSchema } from '@core/schema/chat/validateContact';
import { listQuickMessageTemplatesSchema } from '@core/schema/chat/listQuickMessageTemplates';
import { updateChatLabelSchema } from '@core/schema/chat/updateChatLabel';
import { listChatWorkersSchema } from '@core/schema/chat/listChatWorkers';
import { listChatUsersSchema } from '@core/schema/chat/listChatUsers';
import { listChatSectorsSchema } from '@core/schema/chat/listChatSectors';

export default function chatRoutes(server: FastifyInstance) {
  const chatController = container.resolve(ChatController);

  server.get('/chat', {
    schema: listChatsSchema,
    handler: chatController.listChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/start-with-contact', {
    schema: startChatWithContactSchema,
    handler: chatController.startChatWithContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/link-preview', {
    schema: viewLinkPreviewSchema,
    handler: chatController.viewChatLinkPreview,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id', {
    schema: listMessageChatsSchema,
    handler: chatController.listMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id/search', {
    schema: searchMessagesSchema,
    handler: chatController.searchMessages,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id', {
    schema: createMessageChatsSchema,
    handler: chatController.createMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.put('/chat/user', {
    schema: updateChatsUserSchema,
    handler: chatController.updateChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/react', {
    schema: reactMessageSchema,
    handler: chatController.reactMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/delete', {
    schema: deleteMessageSchema,
    handler: chatController.deleteMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/edit', {
    schema: editMessageSchema,
    handler: chatController.editMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/status', {
    schema: updateChatStatusSchema,
    handler: chatController.updateChatStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/clear-summary', {
    schema: clearChatSummarySchema,
    handler: chatController.clearChatSummary,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/transfer', {
    schema: transferChatSchema,
    handler: chatController.transferChat,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/search', {
    schema: searchChatsSchema,
    handler: chatController.searchChats,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/worker/:worker_id/config', {
    schema: viewWorkerConfigForChatSchema,
    handler: chatController.viewWorkerConfigForChat,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer-options', {
    schema: listTransferOptionsSchema,
    handler: chatController.listTransferOptions,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/users', {
    schema: listTransferUsersSchema,
    handler: chatController.listTransferUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/sectors', {
    schema: listTransferSectorsSchema,
    handler: chatController.listTransferSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/sectors/:sector_id/users', {
    schema: listTransferSectorUsersSchema,
    handler: chatController.listTransferSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts', {
    schema: listChatContactsSchema,
    handler: chatController.listContacts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id', {
    schema: viewChatContactSchema,
    handler: chatController.viewContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts/batch', {
    schema: viewChatContactsBatchSchema,
    handler: chatController.viewContactsBatch,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/email', {
    schema: viewChatContactEmailSchema,
    handler: chatController.viewContactEmail,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/phone', {
    schema: viewChatContactPhoneSchema,
    handler: chatController.viewContactPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/document', {
    schema: viewChatContactDocumentSchema,
    handler: chatController.viewContactDocument,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/label-templates', {
    schema: listChatLabelTemplatesSchema,
    handler: chatController.listLabelTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts', {
    schema: createChatContactSchema,
    handler: chatController.createContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/contacts/:contact_id', {
    schema: updateChatContactSchema,
    handler: chatController.updateContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/chat/contacts/:contact_id/photo', {
    schema: deleteChatContactPhotoSchema,
    handler: chatController.deleteContactPhoto,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts/:contact_id/validate', {
    schema: validateChatContactSchema,
    handler: chatController.validateContact,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/quick-message-templates', {
    schema: listQuickMessageTemplatesSchema,
    handler: chatController.listQuickMessageTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/label', {
    schema: updateChatLabelSchema,
    handler: chatController.updateChatLabel,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/workers', {
    schema: listChatWorkersSchema,
    handler: chatController.listChatWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/users', {
    schema: listChatUsersSchema,
    handler: chatController.listChatUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/sectors', {
    schema: listChatSectorsSchema,
    handler: chatController.listChatSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });
}
