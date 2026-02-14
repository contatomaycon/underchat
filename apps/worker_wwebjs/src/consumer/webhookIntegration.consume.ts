import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WebhookIntegrationWwebjsConsume } from '@core/consumer/webhook/WebhookIntegrationWwebjs.consume';

export function startWebhookIntegrationWwebjsConsume(
  server: FastifyInstance
): WebhookIntegrationWwebjsConsume {
  const consume = container.resolve(WebhookIntegrationWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting webhook integration consume'
    );
  });

  return consume;
}
