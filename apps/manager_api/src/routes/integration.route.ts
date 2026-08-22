import {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
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
import {
  generatePublicApiTokenSchema,
  revokePublicApiTokenSchema,
  viewPublicApiTokenSchema,
} from '@core/schema/integration/apiToken';
import {
  activateOutboundWebhookSchema,
  createOutboundWebhookSchema,
  deleteOutboundWebhookSchema,
  listOutboundWebhookDeliveriesSchema,
  listOutboundWebhookEventsSchema,
  listOutboundWebhooksSchema,
  redeliverOutboundWebhookDeliverySchema,
  rotateOutboundWebhookSecretSchema,
  testOutboundWebhookSchema,
  updateOutboundWebhookSchema,
  viewOutboundWebhookDeliverySchema,
  viewOutboundWebhookSchema,
} from '@core/schema/integration/outboundWebhook';
import { planProductGuard } from '@/plugins/planProductGuard';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import type { EPermissionsRoles } from '@core/common/enums/EPermissions';
import {
  integrationEntitlementEpochMismatchResponseSchema,
  integrationPlanErrorResponses,
} from '@core/schema/integration/planEntitlementError.schema';

const withIntegrationPlanResponses = <T extends { response: object }>(
  schema: T
): T =>
  ({
    ...schema,
    response: {
      ...schema.response,
      ...integrationPlanErrorResponses,
    },
  }) as T;

export default function integrationRoutes(server: FastifyInstance) {
  const integrationController = container.resolve(IntegrationController);
  const integrationProductGuard = planProductGuard(EPlanProduct.integration);
  const integrationPreHandlers = (permissions: EPermissionsRoles[]) => [
    (request: FastifyRequest, reply: FastifyReply) =>
      server.authenticateJwt(request, reply, permissions),
    integrationProductGuard,
  ];

  server.get('/integration/outbound-webhooks/events', {
    schema: withIntegrationPlanResponses(listOutboundWebhookEventsSchema),
    handler: integrationController.listOutboundWebhookEvents,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/outbound-webhooks', {
    schema: withIntegrationPlanResponses(listOutboundWebhooksSchema),
    handler: integrationController.listOutboundWebhooks,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/outbound-webhooks/:id', {
    schema: withIntegrationPlanResponses(viewOutboundWebhookSchema),
    handler: integrationController.viewOutboundWebhook,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post('/integration/outbound-webhooks', {
    schema: withIntegrationPlanResponses(createOutboundWebhookSchema),
    handler: integrationController.createOutboundWebhook,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.patch('/integration/outbound-webhooks/:id', {
    schema: withIntegrationPlanResponses(updateOutboundWebhookSchema),
    handler: integrationController.updateOutboundWebhook,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.delete('/integration/outbound-webhooks/:id', {
    schema: withIntegrationPlanResponses(deleteOutboundWebhookSchema),
    handler: integrationController.deleteOutboundWebhook,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post('/integration/outbound-webhooks/:id/test', {
    schema: withIntegrationPlanResponses({
      ...testOutboundWebhookSchema,
      response: {
        ...testOutboundWebhookSchema.response,
        409: integrationEntitlementEpochMismatchResponseSchema,
      },
    }),
    handler: integrationController.testOutboundWebhook,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post('/integration/outbound-webhooks/:id/secret/rotate', {
    schema: withIntegrationPlanResponses(rotateOutboundWebhookSecretSchema),
    handler: integrationController.rotateOutboundWebhookSecret,
    preHandler: integrationPreHandlers(integrationGenerateKeyPermissions),
  });

  server.patch('/integration/outbound-webhooks/:id/activate', {
    schema: withIntegrationPlanResponses(activateOutboundWebhookSchema),
    handler: integrationController.activateOutboundWebhook,
    preHandler: integrationPreHandlers(integrationStatusUpdatePermissions),
  });

  server.get('/integration/outbound-webhooks/:id/deliveries', {
    schema: withIntegrationPlanResponses(listOutboundWebhookDeliveriesSchema),
    handler: integrationController.listOutboundWebhookDeliveries,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/outbound-webhooks/:id/deliveries/:deliveryId', {
    schema: withIntegrationPlanResponses(viewOutboundWebhookDeliverySchema),
    handler: integrationController.viewOutboundWebhookDelivery,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post(
    '/integration/outbound-webhooks/:id/deliveries/:deliveryId/redeliver',
    {
      schema: withIntegrationPlanResponses({
        ...redeliverOutboundWebhookDeliverySchema,
        response: {
          ...redeliverOutboundWebhookDeliverySchema.response,
          409: integrationEntitlementEpochMismatchResponseSchema,
        },
      }),
      handler: integrationController.redeliverOutboundWebhookDelivery,
      preHandler: integrationPreHandlers(integrationPermissions),
    }
  );

  server.get('/integration/api-token', {
    schema: withIntegrationPlanResponses(viewPublicApiTokenSchema),
    handler: integrationController.viewPublicApiToken,
    preHandler: integrationPreHandlers(integrationGenerateKeyPermissions),
  });

  server.post('/integration/api-token/generate', {
    schema: withIntegrationPlanResponses(generatePublicApiTokenSchema),
    handler: integrationController.generatePublicApiToken,
    preHandler: integrationPreHandlers(integrationGenerateKeyPermissions),
  });

  server.delete('/integration/api-token', {
    schema: withIntegrationPlanResponses(revokePublicApiTokenSchema),
    handler: integrationController.revokePublicApiToken,
    preHandler: integrationPreHandlers(integrationGenerateKeyPermissions),
  });

  server.get('/integration', {
    schema: withIntegrationPlanResponses(listIntegrationsSchema),
    handler: integrationController.listIntegrations,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post('/integration', {
    schema: withIntegrationPlanResponses(createIntegrationSchema),
    handler: integrationController.createIntegration,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/view', {
    schema: withIntegrationPlanResponses(viewIntegrationByIdSchema),
    handler: integrationController.viewIntegrationById,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.patch('/integration/update', {
    schema: withIntegrationPlanResponses(updateIntegrationSchema),
    handler: integrationController.updateIntegration,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.delete('/integration/delete', {
    schema: withIntegrationPlanResponses(deleteIntegrationSchema),
    handler: integrationController.deleteIntegration,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.patch('/integration/status', {
    schema: withIntegrationPlanResponses(updateIntegrationStatusSchema),
    handler: integrationController.updateIntegrationStatus,
    preHandler: integrationPreHandlers(integrationStatusUpdatePermissions),
  });

  server.post('/integration/generate-key', {
    schema: withIntegrationPlanResponses(generateIntegrationKeySchema),
    handler: integrationController.generateIntegrationKey,
    preHandler: integrationPreHandlers(integrationGenerateKeyPermissions),
  });

  server.get('/integration/available-channels', {
    schema: withIntegrationPlanResponses(listAvailableChannelsSchema),
    handler: integrationController.listAvailableChannels,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/webhook-mapping', {
    schema: withIntegrationPlanResponses(viewWebhookMappingSchema),
    handler: integrationController.viewWebhookMapping,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.post('/integration/webhook-mapping', {
    schema: withIntegrationPlanResponses(saveWebhookMappingSchema),
    handler: integrationController.saveWebhookMapping,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/webhook-data', {
    schema: withIntegrationPlanResponses(viewWebhookDataSchema),
    handler: integrationController.viewWebhookData,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/users', {
    schema: withIntegrationPlanResponses(listIntegrationUsersSchema),
    handler: integrationController.listUsers,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/sectors', {
    schema: withIntegrationPlanResponses(listIntegrationSectorsSchema),
    handler: integrationController.listSectors,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/sectors/:sector_id/users', {
    schema: withIntegrationPlanResponses(listIntegrationSectorUsersSchema),
    handler: integrationController.listSectorUsers,
    preHandler: integrationPreHandlers(integrationPermissions),
  });

  server.get('/integration/input-chatbots', {
    schema: withIntegrationPlanResponses(listIntegrationInputChatbotsSchema),
    handler: integrationController.listInputChatbots,
    preHandler: integrationPreHandlers(integrationPermissions),
  });
}
