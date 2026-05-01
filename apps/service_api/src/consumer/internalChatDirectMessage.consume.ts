import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { InternalChatDirectMessageConsume } from '@core/consumer/internalChat/InternalChatDirectMessage.consume';

export function startInternalChatDirectMessageConsume(
  server: FastifyInstance
): InternalChatDirectMessageConsume {
  const consume = container.resolve(InternalChatDirectMessageConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting internal chat direct message consume'
    );
  });

  return consume;
}
