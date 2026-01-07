import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ChatbotController from '@/controllers/chatbot';
import { chatbotPermissions } from '@/permissions/chatbot.permissions';
import { createChatbotSchema } from '@core/schema/chatbot/createChatbot';
import { listChatbotSchema } from '@core/schema/chatbot/listChatbot';
import { updateChatbotSchema } from '@core/schema/chatbot/updateChatbot';
import { listChatbotUsersSchema } from '@core/schema/chatbot/listUsers';
import { listChatbotSectorsSchema } from '@core/schema/chatbot/listSectors';
import { listChatbotSectorUsersSchema } from '@core/schema/chatbot/listSectorUsers';
import { listChatbotChatTagsSchema } from '@core/schema/chatbot/listChatTags';
import { listChatbotAiAgentsSchema } from '@core/schema/chatbot/listAiAgents';
import { saveChatbotFlowSchema } from '@core/schema/chatbot/saveChatbotFlow';
import { listChatbotFlowSchema } from '@core/schema/chatbot/listChatbotFlow';
import { saveChatbotFlowConfigurationsSchema } from '@core/schema/chatbot/saveChatbotFlowConfigurations';
import { listChatbotFlowConfigurationsSchema } from '@core/schema/chatbot/listChatbotFlowConfigurations';
import { deleteChatbotSchema } from '@core/schema/chatbot/deleteChatbot';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function chatbotRoutes(server: FastifyInstance) {
  const chatbotController = container.resolve(ChatbotController);

  server.post('/chatbot', {
    schema: createChatbotSchema,
    handler: chatbotController.createChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot', {
    schema: listChatbotSchema,
    handler: chatbotController.listChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.put('/chatbot/:chatbot_id', {
    schema: updateChatbotSchema,
    handler: chatbotController.updateChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/chatbot/:chatbot_id', {
    schema: deleteChatbotSchema,
    handler: chatbotController.deleteChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/users', {
    schema: listChatbotUsersSchema,
    handler: chatbotController.listUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/sectors', {
    schema: listChatbotSectorsSchema,
    handler: chatbotController.listSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/sectors/:sector_id/users', {
    schema: listChatbotSectorUsersSchema,
    handler: chatbotController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/tags', {
    schema: listChatbotChatTagsSchema,
    handler: chatbotController.listChatTags,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/ai-agents', {
    schema: listChatbotAiAgentsSchema,
    handler: chatbotController.listAiAgents,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chatbot/flow', {
    schema: saveChatbotFlowSchema,
    handler: chatbotController.saveChatbotFlow,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/flow', {
    schema: listChatbotFlowSchema,
    handler: chatbotController.listChatbotFlow,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/chatbot/flow/configurations', {
    schema: saveChatbotFlowConfigurationsSchema,
    handler: chatbotController.saveChatbotFlowConfigurations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/chatbot/flow/configurations', {
    schema: listChatbotFlowConfigurationsSchema,
    handler: chatbotController.listChatbotFlowConfigurations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
      planGuard,
      planStatus,
    ],
  });
}
