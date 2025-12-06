import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { AsaasPaymentWebhookConsume } from '@core/consumer/Webhook/AsaasPaymentWebhook.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const asaasPaymentWebhookConsume = container.resolve(
      AsaasPaymentWebhookConsume
    );

    asaasPaymentWebhookConsume.execute(fastify).catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await asaasPaymentWebhookConsume.close();
    });
  },
  { name: 'asaas-payment-webhook-consume' }
);
