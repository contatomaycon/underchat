import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  aiAgentCreatePermissions,
  aiAgentDeletePermissions,
  aiAgentUpdatePermissions,
  aiAgentViewPermissions,
} from '@/permissions';
import VoiceIaController from '@/controllers/voiceIa';
import { listVoiceIaSchema } from '@core/schema/voiceIa/listVoiceIa';
import { createVoiceIaSchema } from '@core/schema/voiceIa/createVoiceIa';
import { viewVoiceIaSchema } from '@core/schema/voiceIa/viewVoiceIa';
import { updateVoiceIaSchema } from '@core/schema/voiceIa/updateVoiceIa';
import { deleteVoiceIaSchema } from '@core/schema/voiceIa/deleteVoiceIa';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default async function voiceIaRoutes(server: FastifyInstance) {
  const voiceIaController = container.resolve(VoiceIaController);

  server.get('/ai-agent/voice-ia', {
    schema: listVoiceIaSchema,
    handler: voiceIaController.listVoiceIa,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.post('/ai-agent/voice-ia', {
    schema: createVoiceIaSchema,
    handler: voiceIaController.createVoiceIa,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentCreatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/ai-agent/voice-ia/:voice_ia_id', {
    schema: viewVoiceIaSchema,
    handler: voiceIaController.viewVoiceIa,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.patch('/ai-agent/voice-ia/:voice_ia_id', {
    schema: updateVoiceIaSchema,
    handler: voiceIaController.updateVoiceIa,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentUpdatePermissions),
      planGuard,
      planStatus,
    ],
  });

  server.delete('/ai-agent/voice-ia/:voice_ia_id', {
    schema: deleteVoiceIaSchema,
    handler: voiceIaController.deleteVoiceIa,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, aiAgentDeletePermissions),
      planGuard,
      planStatus,
    ],
  });
}
