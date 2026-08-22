import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageHistorySyncConsume } from '@core/consumer/message/MessageHistorySync.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startMessageHistorySyncConsume(
  server: FastifyInstance
): MessageHistorySyncConsume {
  const messageHistorySyncConsume = container.resolve(
    MessageHistorySyncConsume
  );

  return launchServiceApiConsumerStartup(
    messageHistorySyncConsume,
    () => messageHistorySyncConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting message history sync consume'
      )
  );
}
