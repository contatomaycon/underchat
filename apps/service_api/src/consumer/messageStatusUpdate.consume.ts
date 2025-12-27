import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageStatusUpdateConsume } from '@core/consumer/message/MessageStatusUpdate.consume';

export function startMessageStatusUpdateConsume(
  server: FastifyInstance
): MessageStatusUpdateConsume {
  const messageStatusUpdateConsume = container.resolve(
    MessageStatusUpdateConsume
  );

  messageStatusUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message status update consume'
    );
  });

  return messageStatusUpdateConsume;
}
