import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { InternalChatGroupMessageConsume } from '@core/consumer/internalChat/InternalChatGroupMessage.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startInternalChatGroupMessageConsume(
  server: FastifyInstance
): InternalChatGroupMessageConsume {
  const consume = container.resolve(InternalChatGroupMessageConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting internal chat group message consume'
      )
  );
}
