import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { AsaasNfseWebhookConsume } from '@core/consumer/Webhook/AsaasNfseWebhook.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const asaasNfseWebhookConsume = container.resolve(AsaasNfseWebhookConsume);

    asaasNfseWebhookConsume.execute(fastify).catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await asaasNfseWebhookConsume.close();
    });
  },
  { name: 'asaas-nfse-webhook-consume' }
);
