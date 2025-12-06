import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WebhookController from '@/controllers/Webhook';
import { asaasInvoiceWebhookSchema } from '@core/schema/payment/Webhook';
import { asaasNfseWebhookSchema } from '@core/schema/nfse/Webhook';

export default function webhookRoutes(server: FastifyInstance) {
  const webhookController = container.resolve(WebhookController);

  server.post('/webhook/invoice', {
    schema: asaasInvoiceWebhookSchema,
    handler: webhookController.invoiceWebhook,
  });

  server.post('/webhook/nfse', {
    schema: asaasNfseWebhookSchema,
    handler: webhookController.nfseWebhook,
  });
}
