import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';

export function startSendMessageConsume(
  server: FastifyInstance
): MessageSendConsume {
  const messageSendConsume = container.resolve(MessageSendConsume);

  messageSendConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message send consume');
  });

  return messageSendConsume;
}
