import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import ChatbotController from '@/controllers/chatbot';
import { chatbotPermissions } from '@/permissions/chatbot.permissions';
import { createChatbotSchema } from '@core/schema/chatbot/createChatbot';
import { listChatbotSchema } from '@core/schema/chatbot/listChatbot';
import { listChatbotUsersSchema } from '@core/schema/chatbot/listUsers';
import { listChatbotSectorsSchema } from '@core/schema/chatbot/listSectors';
import { listChatbotSectorUsersSchema } from '@core/schema/chatbot/listSectorUsers';
import { listChatbotChatTagsSchema } from '@core/schema/chatbot/listChatTags';

export default function chatbotRoutes(server: FastifyInstance) {
  const chatbotController = container.resolve(ChatbotController);

  server.post('/chatbot', {
    schema: createChatbotSchema,
    handler: chatbotController.createChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });

  server.get('/chatbot', {
    schema: listChatbotSchema,
    handler: chatbotController.listChatbot,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });

  server.get('/chatbot/users', {
    schema: listChatbotUsersSchema,
    handler: chatbotController.listUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });

  server.get('/chatbot/sectors', {
    schema: listChatbotSectorsSchema,
    handler: chatbotController.listSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });

  server.get('/chatbot/sectors/:sector_id/users', {
    schema: listChatbotSectorUsersSchema,
    handler: chatbotController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });

  server.get('/chatbot/tags', {
    schema: listChatbotChatTagsSchema,
    handler: chatbotController.listChatTags,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, chatbotPermissions),
    ],
  });
}
