import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WebhookController from '@/controllers/Webhook';
import { asaasPaymentWebhookSchema } from '@core/schema/payment/Webhook';
import { asaasInvoiceWebhookSchema } from '@core/schema/invoice/Webhook';

export default function webhookRoutes(server: FastifyInstance) {
  const webhookController = container.resolve(WebhookController);

  server.post('/webhook/invoice', {
    schema: asaasPaymentWebhookSchema,
    handler: webhookController.webhook,
  });

  server.post('/webhook/nfse', {
    schema: asaasInvoiceWebhookSchema,
    handler: webhookController.invoiceWebhook,
  });
}
