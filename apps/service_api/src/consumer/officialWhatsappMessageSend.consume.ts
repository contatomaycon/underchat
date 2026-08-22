import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { OfficialWhatsappMessageSendConsume } from '@core/consumer/message/OfficialWhatsappMessageSend.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startOfficialWhatsappMessageSendConsume(
  server: FastifyInstance
): OfficialWhatsappMessageSendConsume {
  const officialWhatsappMessageSendConsume = container.resolve(
    OfficialWhatsappMessageSendConsume
  );

  return launchServiceApiConsumerStartup(
    officialWhatsappMessageSendConsume,
    () => officialWhatsappMessageSendConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting official WhatsApp message send consume'
      )
  );
}
