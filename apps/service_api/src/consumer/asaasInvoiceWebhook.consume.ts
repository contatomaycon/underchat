import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';

export function startAsaasInvoiceWebhookConsume(
  server: FastifyInstance
): AsaasInvoiceWebhookConsume {
  const asaasInvoiceWebhookConsume = container.resolve(
    AsaasInvoiceWebhookConsume
  );

  asaasInvoiceWebhookConsume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting asaas invoice webhook consume'
    );
  });

  return asaasInvoiceWebhookConsume;
}
