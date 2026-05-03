import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import InternalChatController from '@/controllers/internalChat';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';
import {
  contactViewPhonePermissions,
  internalChatGroupCreatePermissions,
  internalChatGroupMembersPermissions,
  internalChatGroupTransferLeaderPermissions,
  internalChatGroupUpdatePermissions,
  internalChatReadPermissions,
  internalChatWritePermissions,
} from '@/permissions';
import { listConversationsSchema } from '@core/schema/internalChat/listConversations';
import { listUsersSchema } from '@core/schema/internalChat/listUsers';
import { listInternalChatContactsSchema } from '@core/schema/internalChat/listContacts';
import { openDirectSchema } from '@core/schema/internalChat/openDirect';
import { viewConversationSchema } from '@core/schema/internalChat/viewConversation';
import { viewInternalChatContactPhoneSchema } from '@core/schema/internalChat/viewContactPhone';
import { closeConversationSchema } from '@core/schema/internalChat/closeConversation';
import { markReadSchema } from '@core/schema/internalChat/markRead';
import { listMessagesSchema } from '@core/schema/internalChat/listMessages';
import { createMessageSchema } from '@core/schema/internalChat/createMessage';
import { reactMessageSchema } from '@core/schema/internalChat/reactMessage';
import { editMessageSchema } from '@core/schema/internalChat/editMessage';
import { deleteMessageSchema } from '@core/schema/internalChat/deleteMessage';
import { activitySchema } from '@core/schema/internalChat/activity';
import { createGroupSchema } from '@core/schema/internalChat/createGroup';
import { updateGroupSchema } from '@core/schema/internalChat/updateGroup';
import { addGroupMemberSchema } from '@core/schema/internalChat/addGroupMember';
import { listGroupMembersSchema } from '@core/schema/internalChat/listGroupMembers';
import { removeGroupMemberSchema } from '@core/schema/internalChat/removeGroupMember';
import { transferLeaderSchema } from '@core/schema/internalChat/transferLeader';
import { realtimeTokenSchema } from '@core/schema/internalChat/realtimeToken';
import { viewInternalChatLinkPreviewSchema } from '@core/schema/internalChat/viewLinkPreview';

export default function internalChatRoutes(server: FastifyInstance) {
  const controller = container.resolve(InternalChatController);

  server.get('/internal-chat/conversations', {
    schema: listConversationsSchema,
    handler: controller.listConversations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/users', {
    schema: listUsersSchema,
    handler: controller.listUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/contacts', {
    schema: listInternalChatContactsSchema,
    handler: controller.listContacts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/contacts/:contact_id/phone', {
    schema: viewInternalChatContactPhoneSchema,
    handler: controller.viewContactPhone,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      (request, reply) =>
        server.authenticateJwt(request, reply, contactViewPhonePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/link-preview', {
    schema: viewInternalChatLinkPreviewSchema,
    handler: controller.viewLinkPreview,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/open-direct', {
    schema: openDirectSchema,
    handler: controller.openDirect,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/realtime-token', {
    schema: realtimeTokenSchema,
    handler: controller.realtimeToken,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/activity', {
    schema: activitySchema,
    handler: controller.activity,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/groups', {
    schema: createGroupSchema,
    handler: controller.createGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          internalChatGroupCreatePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/internal-chat/groups/:id', {
    schema: updateGroupSchema,
    handler: controller.updateGroup,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          internalChatGroupUpdatePermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/groups/:id/members', {
    schema: listGroupMembersSchema,
    handler: controller.listGroupMembers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/groups/:id/members', {
    schema: addGroupMemberSchema,
    handler: controller.addGroupMember,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          internalChatGroupMembersPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/internal-chat/groups/:id/members/:user_id', {
    schema: removeGroupMemberSchema,
    handler: controller.removeGroupMember,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          internalChatGroupMembersPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/internal-chat/groups/:id/leader', {
    schema: transferLeaderSchema,
    handler: controller.transferLeader,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          internalChatGroupTransferLeaderPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/:conversation_id', {
    schema: viewConversationSchema,
    handler: controller.viewConversation,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/close', {
    schema: closeConversationSchema,
    handler: controller.closeConversation,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/mark-read', {
    schema: markReadSchema,
    handler: controller.markRead,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/internal-chat/:conversation_id/messages', {
    schema: listMessagesSchema,
    handler: controller.listMessages,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatReadPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/messages', {
    schema: createMessageSchema,
    handler: controller.createMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/messages/:message_id/react', {
    schema: reactMessageSchema,
    handler: controller.reactMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/messages/:message_id/edit', {
    schema: editMessageSchema,
    handler: controller.editMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/internal-chat/:conversation_id/messages/:message_id/delete', {
    schema: deleteMessageSchema,
    handler: controller.deleteMessage,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, internalChatWritePermissions),
      planGuard,
      planStatus,
    ],
  });
}
