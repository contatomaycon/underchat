import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendWwebjsDlqConsume } from '@core/consumer/message/MessageSendWwebjsDlq.consume';

export function startSendMessageWwebjsDlqConsume(
  server: FastifyInstance
): MessageSendWwebjsDlqConsume {
  const consume = container.resolve(MessageSendWwebjsDlqConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message send DLQ consume');
  });

  return consume;
}
