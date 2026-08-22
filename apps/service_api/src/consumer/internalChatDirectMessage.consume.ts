import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { InternalChatDirectMessageConsume } from '@core/consumer/internalChat/InternalChatDirectMessage.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startInternalChatDirectMessageConsume(
  server: FastifyInstance
): InternalChatDirectMessageConsume {
  const consume = container.resolve(InternalChatDirectMessageConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting internal chat direct message consume'
      )
  );
}
