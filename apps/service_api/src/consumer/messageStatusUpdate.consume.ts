import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageStatusUpdateConsume } from '@core/consumer/message/MessageStatusUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startMessageStatusUpdateConsume(
  server: FastifyInstance
): MessageStatusUpdateConsume {
  const messageStatusUpdateConsume = container.resolve(
    MessageStatusUpdateConsume
  );

  return launchServiceApiConsumerStartup(
    messageStatusUpdateConsume,
    () => messageStatusUpdateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting message status update consume'
      )
  );
}
