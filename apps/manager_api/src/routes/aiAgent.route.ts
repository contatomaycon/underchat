import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  aiAgentCreatePermissions,
  aiAgentDeletePermissions,
  aiAgentUpdatePermissions,
  aiAgentViewPermissions,
} from '@/permissions';
import AiAgentController from '@/controllers/aiAgent';
import { listAiAgentSchema } from '@core/schema/aiAgent/listAiAgent';
import { createAiAgentSchema } from '@core/schema/aiAgent/createAiAgent';
import { viewAiAgentSchema } from '@core/schema/aiAgent/viewAiAgent';
import { deleteAiAgentSchema } from '@core/schema/aiAgent/deleteAiAgent';
import { updateAiAgentSchema } from '@core/schema/aiAgent/updateAiAgent';
import { listAiAgentTypeSchema } from '@core/schema/aiAgent/listAiAgentType';

export default async function aiAgentRoutes(server: FastifyInstance) {
  const aiAgentController = container.resolve(AiAgentController);

  server.get('/ai-agent', {
    schema: listAiAgentSchema,
    handler: aiAgentController.listAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
    ],
  });

  server.get('/ai-agent/types', {
    schema: listAiAgentTypeSchema,
    handler: aiAgentController.listAiAgentType,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
    ],
  });

  server.post('/ai-agent', {
    schema: createAiAgentSchema,
    handler: aiAgentController.createAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentCreatePermissions),
    ],
  });

  server.get('/ai-agent/:ai_agent_id', {
    schema: viewAiAgentSchema,
    handler: aiAgentController.viewAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
    ],
  });

  server.delete('/ai-agent/:ai_agent_id', {
    schema: deleteAiAgentSchema,
    handler: aiAgentController.deleteAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentDeletePermissions),
    ],
  });

  server.patch('/ai-agent/:ai_agent_id', {
    schema: updateAiAgentSchema,
    handler: aiAgentController.updateAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
    ],
  });
}
