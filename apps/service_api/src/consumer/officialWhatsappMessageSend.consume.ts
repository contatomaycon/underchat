import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { OfficialWhatsappMessageSendConsume } from '@core/consumer/message/OfficialWhatsappMessageSend.consume';

export function startOfficialWhatsappMessageSendConsume(
  server: FastifyInstance
): OfficialWhatsappMessageSendConsume {
  const officialWhatsappMessageSendConsume = container.resolve(
    OfficialWhatsappMessageSendConsume
  );

  officialWhatsappMessageSendConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting official WhatsApp message send consume'
    );
  });

  return officialWhatsappMessageSendConsume;
}
