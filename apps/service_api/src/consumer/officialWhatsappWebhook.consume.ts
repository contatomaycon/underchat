import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { OfficialWhatsappWebhookConsume } from '@core/consumer/webhook/OfficialWhatsappWebhook.consume';

export function startOfficialWhatsappWebhookConsume(
  server: FastifyInstance
): OfficialWhatsappWebhookConsume {
  const officialWhatsappWebhookConsume = container.resolve(
    OfficialWhatsappWebhookConsume
  );

  officialWhatsappWebhookConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting official WhatsApp webhook consume'
    );
  });

  return officialWhatsappWebhookConsume;
}
