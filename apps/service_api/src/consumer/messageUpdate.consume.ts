import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageUpdateConsume } from '@core/consumer/message/MessageUpdate.consume';

export function startMessageUpdateConsume(
  server: FastifyInstance
): MessageUpdateConsume {
  const messageUpdateConsume = container.resolve(MessageUpdateConsume);

  messageUpdateConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message update consume');
  });

  return messageUpdateConsume;
}
