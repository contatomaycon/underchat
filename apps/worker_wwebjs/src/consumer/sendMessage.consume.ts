import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendWwebjsConsume } from '@core/consumer/message/MessageSendWwebjs.consume';

export function startSendMessageWwebjsConsume(
  server: FastifyInstance
): MessageSendWwebjsConsume {
  const consume = container.resolve(MessageSendWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message send consume');
  });

  return consume;
}
