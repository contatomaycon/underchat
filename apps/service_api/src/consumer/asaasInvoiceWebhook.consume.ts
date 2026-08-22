import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startAsaasInvoiceWebhookConsume(
  server: FastifyInstance
): AsaasInvoiceWebhookConsume {
  const asaasInvoiceWebhookConsume = container.resolve(
    AsaasInvoiceWebhookConsume
  );

  return launchServiceApiConsumerStartup(
    asaasInvoiceWebhookConsume,
    () => asaasInvoiceWebhookConsume.execute(server),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting asaas invoice webhook consume'
      )
  );
}
