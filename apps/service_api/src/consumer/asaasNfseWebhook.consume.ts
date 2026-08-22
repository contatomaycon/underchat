import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AsaasNfseWebhookConsume } from '@core/consumer/webhook/AsaasNfseWebhook.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startAsaasNfseWebhookConsume(
  server: FastifyInstance
): AsaasNfseWebhookConsume {
  const asaasNfseWebhookConsume = container.resolve(AsaasNfseWebhookConsume);

  return launchServiceApiConsumerStartup(
    asaasNfseWebhookConsume,
    () => asaasNfseWebhookConsume.execute(server),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting asaas nfse webhook consume'
      )
  );
}
