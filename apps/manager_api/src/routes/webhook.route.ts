import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import WebhookController from '@/controllers/webhook';
import { asaasInvoiceWebhookSchema } from '@core/schema/payment/Webhook';
import { asaasNfseWebhookSchema } from '@core/schema/nfse/Webhook';
import {
  whatsappEmbeddedWebhookReceiveSchema,
  whatsappEmbeddedWebhookVerificationSchema,
} from '@core/schema/webhook/whatsappEmbedded';

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

  server.get('/webhook/whatsapp/embedded', {
    schema: whatsappEmbeddedWebhookVerificationSchema,
    handler: webhookController.verifyWhatsappEmbeddedWebhook,
  });

  server.post('/webhook/whatsapp/embedded', {
    schema: whatsappEmbeddedWebhookReceiveSchema,
    handler: webhookController.receiveWhatsappEmbeddedWebhook,
  });
}
