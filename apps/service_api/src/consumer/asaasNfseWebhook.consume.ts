import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AsaasNfseWebhookConsume } from '@core/consumer/webhook/AsaasNfseWebhook.consume';

export function startAsaasNfseWebhookConsume(
  server: FastifyInstance
): AsaasNfseWebhookConsume {
  const asaasNfseWebhookConsume = container.resolve(AsaasNfseWebhookConsume);

  asaasNfseWebhookConsume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting asaas nfse webhook consume'
    );
  });

  return asaasNfseWebhookConsume;
}
