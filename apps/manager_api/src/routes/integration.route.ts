import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  integrationPermissions,
  integrationStatusUpdatePermissions,
  integrationGenerateKeyPermissions,
} from '@/permissions/integration.permissions';
import IntegrationController from '@/controllers/integration';
import { viewIntegrationSchema } from '@core/schema/integration/viewIntegration';
import { updateIntegrationStatusSchema } from '@core/schema/integration/updateIntegrationStatus';
import { generateIntegrationKeySchema } from '@core/schema/integration/generateIntegrationKey';
import { viewWebhookMappingSchema } from '@core/schema/integration/viewWebhookMapping';
import { saveWebhookMappingSchema } from '@core/schema/integration/saveWebhookMapping';
import { viewWebhookDataSchema } from '@core/schema/integration/viewWebhookData';

export default function integrationRoutes(server: FastifyInstance) {
  const integrationController = container.resolve(IntegrationController);

  server.get('/integration', {
    schema: viewIntegrationSchema,
    handler: integrationController.viewIntegration,
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
}
