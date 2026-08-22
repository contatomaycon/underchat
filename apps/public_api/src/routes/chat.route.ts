import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { listChatsSchema } from '@core/schema/chat/listChats';
import { listKanbanSchema } from '@core/schema/chat/listKanban';
import {
  pinChatSchema,
  unpinChatSchema,
  viewPinnedChatSchema,
} from '@core/schema/chat/viewPinnedChat';
import { viewChatUnreadSummarySchema } from '@core/schema/chat/unreadSummary';
import ChatController from '@core/controllers/chat';
import { planGuard, planStatus } from '@core/middlewares/planAccess.middleware';
import { publicApiSchema } from '@core/common/functions/publicApiSchema';
import {
  chatPermissions,
  chatReadPermissions,
  contactViewPhonePermissions,
  forwardToOutputChatbotPermissions,
  generateMessageWithAiPermissions,
  kanbanPermissions,
  viewChatAttendantsPermissions,
} from '@core/permissions/publicApi.permissions';
import { updateChatsUserSchema } from '@core/schema/chat/updateChatsUser';
import {
  updateChatNotificationSettingsSchema,
  viewChatNotificationSettingsSchema,
} from '@core/schema/chat/notificationSettings';
import { listMessageChatsSchema } from '@core/schema/chat/listMessageChats';
import { createMessageChatsSchema } from '@core/schema/chat/createMessageChats';
import { viewLinkPreviewSchema } from '@core/schema/chat/viewLinkPreview';
import { reactMessageSchema } from '@core/schema/chat/reactMessage';
import { deleteMessageSchema } from '@core/schema/chat/deleteMessage';
import { editMessageSchema } from '@core/schema/chat/editMessage';
import { forwardMessageSchema } from '@core/schema/chat/forwardMessage';
import { updateChatStatusSchema } from '@core/schema/chat/updateChatStatus';
import { clearChatSummarySchema } from '@core/schema/chat/clearChatSummary';
import { joinChatSchema } from '@core/schema/chat/joinChat';
import { leaveChatSchema } from '@core/schema/chat/leaveChat';
import { startChatWithContactSchema } from '@core/schema/chat/startChatWithContact';
import { searchMessagesSchema } from '@core/schema/chat/searchMessages';
import { transferChatSchema } from '@core/schema/chat/transferChat';
import { searchChatsSchema } from '@core/schema/chat/searchChats';
import { viewWorkerConfigForChatSchema } from '@core/schema/chat/viewWorkerConfigForChat';
import { listTransferOptionsSchema } from '@core/schema/chat/listTransferOptions';
import { officialOpeningContextSchema } from '@core/schema/chat/officialOpeningContext';
import { officialConversationContextSchema } from '@core/schema/chat/officialConversationContext';
import { sendOfficialTemplateSchema } from '@core/schema/chat/sendOfficialTemplate';
import { listTransferUsersSchema } from '@core/schema/chat/listTransferUsers';
import { listTransferSectorsSchema } from '@core/schema/chat/listTransferSectors';
import { listTransferSectorUsersSchema } from '@core/schema/chat/listTransferSectorUsers';
import { bulkActionChatSchema } from '@core/schema/chat/bulkAction';
import { listChatContactsSchema } from '@core/schema/chat/listContacts';
import { viewChatContactSchema } from '@core/schema/chat/viewContact';
import { viewChatContactByPhoneSchema } from '@core/schema/chat/viewContactByPhone';
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
import { updateForwardToOutputChatbotSchema } from '@core/schema/chat/updateForwardToOutputChatbot';
import { viewChatAttendanceInactivitySchema } from '@core/schema/chat/viewChatAttendanceInactivity';
import { updateChatAttendanceInactivitySchema } from '@core/schema/chat/updateChatAttendanceInactivity';
import { listChatWorkersSchema } from '@core/schema/chat/listChatWorkers';
import { listChatUsersSchema } from '@core/schema/chat/listChatUsers';
import { listChatSectorsSchema } from '@core/schema/chat/listChatSectors';
import { removeChatContactLabelTemplateSchema } from '@core/schema/chat/removeContactLabelTemplate';
import { listChatContactChannelsSchema } from '@core/schema/chat/listContactChannels';
import { viewChatContactChannelsByContactIdSchema } from '@core/schema/chat/viewContactChannelsByContactId';
import { viewChatAttendantsSchema } from '@core/schema/chat/viewChatAttendants';
import { generateAiReplySchema } from '@core/schema/chat/generateAiReply';
import { transcribeAudioSchema } from '@core/schema/chat/transcribeAudio';
import { listOfflineChannelsSchema } from '@core/schema/dashboard/listOfflineChannels';
import { listChannelsStatusSchema } from '@core/schema/dashboard/listChannelsStatus';

export default function publicChatRoutes(server: FastifyInstance) {
  const chatController = container.resolve(ChatController);

  server.get('/chat', {
    schema: publicApiSchema(listChatsSchema),
    handler: chatController.listChats,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/kanban', {
    schema: publicApiSchema(listKanbanSchema),
    handler: chatController.listKanban,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, kanbanPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/pinned', {
    schema: publicApiSchema(viewPinnedChatSchema),
    handler: chatController.viewPinnedChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/pinned/:chat_id', {
    schema: publicApiSchema(pinChatSchema),
    handler: chatController.pinChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/chat/pinned/:chat_id', {
    schema: publicApiSchema(unpinChatSchema),
    handler: chatController.unpinChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/start-with-contact', {
    schema: publicApiSchema(startChatWithContactSchema),
    handler: chatController.startChatWithContact,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/link-preview', {
    schema: publicApiSchema(viewLinkPreviewSchema),
    handler: chatController.viewChatLinkPreview,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/notification-settings', {
    schema: publicApiSchema(viewChatNotificationSettingsSchema),
    handler: chatController.viewNotificationSettings,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/unread-summary', {
    schema: publicApiSchema(viewChatUnreadSummarySchema),
    handler: chatController.viewUnreadSummary,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.put('/chat/notification-settings', {
    schema: publicApiSchema(updateChatNotificationSettingsSchema),
    handler: chatController.updateNotificationSettings,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id', {
    schema: publicApiSchema(listMessageChatsSchema),
    handler: chatController.listMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id/attendants', {
    schema: publicApiSchema(viewChatAttendantsSchema),
    handler: chatController.viewChatAttendants,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          viewChatAttendantsPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id/search', {
    schema: publicApiSchema(searchMessagesSchema),
    handler: chatController.searchMessages,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id', {
    schema: publicApiSchema(createMessageChatsSchema),
    handler: chatController.createMessageChats,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.put('/chat/user', {
    schema: publicApiSchema(updateChatsUserSchema),
    handler: chatController.updateChatsUser,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/react', {
    schema: publicApiSchema(reactMessageSchema),
    handler: chatController.reactMessage,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/delete', {
    schema: publicApiSchema(deleteMessageSchema),
    handler: chatController.deleteMessage,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/edit', {
    schema: publicApiSchema(editMessageSchema),
    handler: chatController.editMessage,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/forward', {
    schema: publicApiSchema(forwardMessageSchema),
    handler: chatController.forwardMessage,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/status', {
    schema: publicApiSchema(updateChatStatusSchema),
    handler: chatController.updateChatStatus,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/clear-summary', {
    schema: publicApiSchema(clearChatSummarySchema),
    handler: chatController.clearChatSummary,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/join', {
    schema: publicApiSchema(joinChatSchema),
    handler: chatController.joinChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/leave', {
    schema: publicApiSchema(leaveChatSchema),
    handler: chatController.leaveChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/transfer', {
    schema: publicApiSchema(transferChatSchema),
    handler: chatController.transferChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/search', {
    schema: publicApiSchema(searchChatsSchema),
    handler: chatController.searchChats,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/worker/:worker_id/config', {
    schema: publicApiSchema(viewWorkerConfigForChatSchema),
    handler: chatController.viewWorkerConfigForChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer-options', {
    schema: publicApiSchema(listTransferOptionsSchema),
    handler: chatController.listTransferOptions,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/official-opening/context', {
    schema: publicApiSchema(officialOpeningContextSchema),
    handler: chatController.viewOfficialOpeningContext,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id/official-conversation/context', {
    schema: publicApiSchema(officialConversationContextSchema),
    handler: chatController.viewOfficialConversationContext,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/official-template', {
    schema: publicApiSchema(sendOfficialTemplateSchema),
    handler: chatController.sendOfficialTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/users', {
    schema: publicApiSchema(listTransferUsersSchema),
    handler: chatController.listTransferUsers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/sectors', {
    schema: publicApiSchema(listTransferSectorsSchema),
    handler: chatController.listTransferSectors,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/transfer/sectors/:sector_id/users', {
    schema: publicApiSchema(listTransferSectorUsersSchema),
    handler: chatController.listTransferSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/bulk-action', {
    schema: publicApiSchema(bulkActionChatSchema),
    handler: chatController.bulkActionChat,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contact-channels', {
    schema: publicApiSchema(listChatContactChannelsSchema),
    handler: chatController.listContactChannels,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts', {
    schema: publicApiSchema(listChatContactsSchema),
    handler: chatController.listContacts,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/channels', {
    schema: publicApiSchema(viewChatContactChannelsByContactIdSchema),
    handler: chatController.viewContactChannelsByContactId,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id', {
    schema: publicApiSchema(viewChatContactSchema),
    handler: chatController.viewContact,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/by-phone', {
    schema: publicApiSchema(viewChatContactByPhoneSchema),
    handler: chatController.viewContactByPhone,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts/batch', {
    schema: publicApiSchema(viewChatContactsBatchSchema),
    handler: chatController.viewContactsBatch,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/email', {
    schema: publicApiSchema(viewChatContactEmailSchema),
    handler: chatController.viewContactEmail,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/phone', {
    schema: publicApiSchema(viewChatContactPhoneSchema),
    handler: chatController.viewContactPhone,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, [
          chatPermissions,
          contactViewPhonePermissions,
        ]),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/contacts/:contact_id/document', {
    schema: publicApiSchema(viewChatContactDocumentSchema),
    handler: chatController.viewContactDocument,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/label-templates', {
    schema: publicApiSchema(listChatLabelTemplatesSchema),
    handler: chatController.listLabelTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts', {
    schema: publicApiSchema(createChatContactSchema),
    handler: chatController.createContact,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/contacts/:contact_id', {
    schema: publicApiSchema(updateChatContactSchema),
    handler: chatController.updateContact,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/chat/contacts/:contact_id/photo', {
    schema: publicApiSchema(deleteChatContactPhotoSchema),
    handler: chatController.deleteContactPhoto,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/contacts/:contact_id/validate', {
    schema: publicApiSchema(validateChatContactSchema),
    handler: chatController.validateContact,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/chat/contacts/:contact_id/labels/:label_template_id', {
    schema: publicApiSchema(removeChatContactLabelTemplateSchema),
    handler: chatController.removeContactLabelTemplate,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/quick-message-templates', {
    schema: publicApiSchema(listQuickMessageTemplatesSchema),
    handler: chatController.listQuickMessageTemplates,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/label', {
    schema: publicApiSchema(updateChatLabelSchema),
    handler: chatController.updateChatLabel,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/forward-to-output-chatbot', {
    schema: publicApiSchema(updateForwardToOutputChatbotSchema),
    handler: chatController.updateForwardToOutputChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          forwardToOutputChatbotPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/:chat_id/attendance-inactivity', {
    schema: publicApiSchema(viewChatAttendanceInactivitySchema),
    handler: chatController.viewChatAttendanceInactivity,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/chat/:chat_id/attendance-inactivity', {
    schema: publicApiSchema(updateChatAttendanceInactivitySchema),
    handler: chatController.updateChatAttendanceInactivity,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/workers', {
    schema: publicApiSchema(listChatWorkersSchema),
    handler: chatController.listChatWorkers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/users', {
    schema: publicApiSchema(listChatUsersSchema),
    handler: chatController.listChatUsers,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/sectors', {
    schema: publicApiSchema(listChatSectorsSchema),
    handler: chatController.listChatSectors,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/ai-generate', {
    schema: publicApiSchema(generateAiReplySchema),
    handler: chatController.generateAiReply,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(
          request,
          reply,
          generateMessageWithAiPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chat/:chat_id/message/:message_id/transcribe', {
    schema: publicApiSchema(transcribeAudioSchema),
    handler: chatController.transcribeAudio,
    preHandler: [
      (request, reply) =>
        server.authenticatePublicApiToken(request, reply, chatPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chat/offline-channels', {
    schema: publicApiSchema(listOfflineChannelsSchema),
    handler: chatController.listOfflineChannels,
    preHandler: [
      (request, reply) => server.authenticatePublicApiToken(request, reply, []),
    ],
  });

  server.get('/chat/channels-status', {
    schema: publicApiSchema(listChannelsStatusSchema),
    handler: chatController.listChannelsStatus,
    preHandler: [
      (request, reply) => server.authenticatePublicApiToken(request, reply, []),
    ],
  });
}
