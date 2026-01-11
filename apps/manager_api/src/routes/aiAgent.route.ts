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
import { listAiAgentPromptSchema } from '@core/schema/aiAgent/listAiAgentPrompt';
import { createAiAgentPromptSchema } from '@core/schema/aiAgent/createAiAgentPrompt';
import { viewAiAgentPromptSchema } from '@core/schema/aiAgent/viewAiAgentPrompt';
import { updateAiAgentPromptSchema } from '@core/schema/aiAgent/updateAiAgentPrompt';
import { deleteAiAgentPromptSchema } from '@core/schema/aiAgent/deleteAiAgentPrompt';
import { viewAiAgentConfigSchema } from '@core/schema/aiAgent/viewAiAgentConfig';
import { refreshAiAgentPromptSchema } from '@core/schema/aiAgent/refreshAiAgentPrompt';
import { refreshAllAiAgentPromptsSchema } from '@core/schema/aiAgent/refreshAllAiAgentPrompts';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default async function aiAgentRoutes(server: FastifyInstance) {
  const aiAgentController = container.resolve(AiAgentController);

  server.get('/ai-agent', {
    schema: listAiAgentSchema,
    handler: aiAgentController.listAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/types', {
    schema: listAiAgentTypeSchema,
    handler: aiAgentController.listAiAgentType,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/ai-agent', {
    schema: createAiAgentSchema,
    handler: aiAgentController.createAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/:ai_agent_id', {
    schema: viewAiAgentSchema,
    handler: aiAgentController.viewAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/ai-agent/:ai_agent_id', {
    schema: deleteAiAgentSchema,
    handler: aiAgentController.deleteAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/ai-agent/:ai_agent_id', {
    schema: updateAiAgentSchema,
    handler: aiAgentController.updateAiAgent,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/:ai_agent_id/prompt', {
    schema: listAiAgentPromptSchema,
    handler: aiAgentController.listAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/ai-agent/prompt', {
    schema: createAiAgentPromptSchema,
    handler: aiAgentController.createAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/prompt/:ai_agent_prompt_id', {
    schema: viewAiAgentPromptSchema,
    handler: aiAgentController.viewAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/ai-agent/prompt/:ai_agent_prompt_id', {
    schema: updateAiAgentPromptSchema,
    handler: aiAgentController.updateAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/ai-agent/prompt/:ai_agent_prompt_id', {
    schema: deleteAiAgentPromptSchema,
    handler: aiAgentController.deleteAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentDeletePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/ai-agent/prompt/:ai_agent_prompt_id/refresh', {
    schema: refreshAiAgentPromptSchema,
    handler: aiAgentController.refreshAiAgentPrompt,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/ai-agent/:ai_agent_id/prompt/refresh-all', {
    schema: refreshAllAiAgentPromptsSchema,
    handler: aiAgentController.refreshAllAiAgentPrompts,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/config', {
    schema: viewAiAgentConfigSchema,
    handler: aiAgentController.viewAiAgentConfig,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });
}
