import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { OfficialWhatsappWebhookConsume } from '@core/consumer/webhook/OfficialWhatsappWebhook.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startOfficialWhatsappWebhookConsume(
  server: FastifyInstance
): OfficialWhatsappWebhookConsume {
  const officialWhatsappWebhookConsume = container.resolve(
    OfficialWhatsappWebhookConsume
  );

  return launchServiceApiConsumerStartup(
    officialWhatsappWebhookConsume,
    () => officialWhatsappWebhookConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting official WhatsApp webhook consume'
      )
  );
}
