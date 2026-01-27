import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WebhookIntegrationConsume } from '@core/consumer/webhook/WebhookIntegration.consume';

export function startWebhookIntegrationConsume(
  server: FastifyInstance
): WebhookIntegrationConsume {
  const webhookIntegrationConsume = container.resolve(
    WebhookIntegrationConsume
  );

  webhookIntegrationConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting webhook integration consume'
    );
  });

  return webhookIntegrationConsume;
}
