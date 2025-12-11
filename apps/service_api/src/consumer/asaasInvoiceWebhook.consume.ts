import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const asaasInvoiceWebhookConsume = container.resolve(
      AsaasInvoiceWebhookConsume
    );

    asaasInvoiceWebhookConsume.execute(fastify).catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await asaasInvoiceWebhookConsume.close();
    });
  },
  { name: 'asaas-invoice-webhook-consume' }
);
