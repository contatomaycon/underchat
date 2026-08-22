import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageUpdateConsume } from '@core/consumer/message/MessageUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startMessageUpdateConsume(
  server: FastifyInstance
): MessageUpdateConsume {
  const messageUpdateConsume = container.resolve(MessageUpdateConsume);

  return launchServiceApiConsumerStartup(
    messageUpdateConsume,
    () => messageUpdateConsume.execute(),
    (error) =>
      server.log.error({ err: error }, 'Error starting message update consume')
  );
}
