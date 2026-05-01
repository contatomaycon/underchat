import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { InternalChatGroupMessageConsume } from '@core/consumer/internalChat/InternalChatGroupMessage.consume';

export function startInternalChatGroupMessageConsume(
  server: FastifyInstance
): InternalChatGroupMessageConsume {
  const consume = container.resolve(InternalChatGroupMessageConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting internal chat group message consume'
    );
  });

  return consume;
}
