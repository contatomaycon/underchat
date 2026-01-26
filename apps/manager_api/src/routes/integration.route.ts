import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  integrationPermissions,
  integrationStatusUpdatePermissions,
  integrationGenerateKeyPermissions,
} from '@/permissions/integration.permissions';
import IntegrationController from '@/controllers/integration';
import { listIntegrationsSchema } from '@core/schema/integration/listIntegrations';
import { createIntegrationSchema } from '@core/schema/integration/createIntegration';
import { updateIntegrationSchema } from '@core/schema/integration/updateIntegration';
import { deleteIntegrationSchema } from '@core/schema/integration/deleteIntegration';
import { viewIntegrationByIdSchema } from '@core/schema/integration/viewIntegrationById';
import { updateIntegrationStatusSchema } from '@core/schema/integration/updateIntegrationStatus';
import { generateIntegrationKeySchema } from '@core/schema/integration/generateIntegrationKey';
import { listAvailableChannelsSchema } from '@core/schema/integration/listAvailableChannels';
import { viewWebhookMappingSchema } from '@core/schema/integration/viewWebhookMapping';
import { saveWebhookMappingSchema } from '@core/schema/integration/saveWebhookMapping';
import { viewWebhookDataSchema } from '@core/schema/integration/viewWebhookData';
import { listIntegrationUsersSchema } from '@core/schema/integration/listUsers';
import { listIntegrationSectorsSchema } from '@core/schema/integration/listSectors';
import { listIntegrationSectorUsersSchema } from '@core/schema/integration/listSectorUsers';
import { listIntegrationInputChatbotsSchema } from '@core/schema/integration/listInputChatbots';

export default function integrationRoutes(server: FastifyInstance) {
  const integrationController = container.resolve(IntegrationController);

  server.get('/integration', {
    schema: listIntegrationsSchema,
    handler: integrationController.listIntegrations,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.post('/integration', {
    schema: createIntegrationSchema,
    handler: integrationController.createIntegration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/view', {
    schema: viewIntegrationByIdSchema,
    handler: integrationController.viewIntegrationById,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.patch('/integration/update', {
    schema: updateIntegrationSchema,
    handler: integrationController.updateIntegration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.delete('/integration/delete', {
    schema: deleteIntegrationSchema,
    handler: integrationController.deleteIntegration,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.patch('/integration/status', {
    schema: updateIntegrationStatusSchema,
    handler: integrationController.updateIntegrationStatus,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          integrationStatusUpdatePermissions
        ),
    ],
  });

  server.post('/integration/generate-key', {
    schema: generateIntegrationKeySchema,
    handler: integrationController.generateIntegrationKey,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          integrationGenerateKeyPermissions
        ),
    ],
  });

  server.get('/integration/available-channels', {
    schema: listAvailableChannelsSchema,
    handler: integrationController.listAvailableChannels,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/webhook-mapping', {
    schema: viewWebhookMappingSchema,
    handler: integrationController.viewWebhookMapping,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.post('/integration/webhook-mapping', {
    schema: saveWebhookMappingSchema,
    handler: integrationController.saveWebhookMapping,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/webhook-data', {
    schema: viewWebhookDataSchema,
    handler: integrationController.viewWebhookData,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/users', {
    schema: listIntegrationUsersSchema,
    handler: integrationController.listUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/sectors', {
    schema: listIntegrationSectorsSchema,
    handler: integrationController.listSectors,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/sectors/:sector_id/users', {
    schema: listIntegrationSectorUsersSchema,
    handler: integrationController.listSectorUsers,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });

  server.get('/integration/input-chatbots', {
    schema: listIntegrationInputChatbotsSchema,
    handler: integrationController.listInputChatbots,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, integrationPermissions),
    ],
  });
}
