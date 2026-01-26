import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WebhookController from '@/controllers/webhook';
import { receiveWebhookSchema } from '@core/schema/webhook/receiveWebhook';

export default function webhookRoutes(server: FastifyInstance) {
  const webhookController = container.resolve(WebhookController);

  server.post('/webhook/:keyapi', {
    schema: receiveWebhookSchema,
    handler: webhookController.receiveWebhook,
    preHandler: [(request, reply) => server.authenticateKeyApi(request, reply)],
  });
}
