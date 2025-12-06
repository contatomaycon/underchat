import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WebhookController from '@/controllers/Webhook';
import { asaasPaymentWebhookSchema } from '@core/schema/payment/Webhook';

export default function webhookRoutes(server: FastifyInstance) {
  const webhookController = container.resolve(WebhookController);

  server.post('/webhook/invoice', {
    schema: asaasPaymentWebhookSchema,
    handler: webhookController.webhook,
  });
}
