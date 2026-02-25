import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendDlqConsume } from '@core/consumer/message/MessageSendDlq.consume';

export function startSendMessageDlqConsume(
  server: FastifyInstance
): MessageSendDlqConsume {
  const consume = container.resolve(MessageSendDlqConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message send DLQ consume');
  });

  return consume;
}
