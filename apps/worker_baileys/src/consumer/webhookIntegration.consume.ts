import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WebhookIntegrationConsume } from '@core/consumer/webhook/WebhookIntegration.consume';

export function startWebhookIntegrationConsume(
  server: FastifyInstance
): WebhookIntegrationConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] webhookIntegration.consume: startWebhookIntegrationConsume iniciado',
    { ts: t0 }
  );
  const webhookIntegrationConsume = container.resolve(
    WebhookIntegrationConsume
  );
  webhookIntegrationConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting webhook integration consume'
    );
  });
  console.log(
    '[worker_baileys:init] webhookIntegration.consume: startWebhookIntegrationConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return webhookIntegrationConsume;
}
