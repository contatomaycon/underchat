import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageHistorySyncConsume } from '@core/consumer/message/MessageHistorySync.consume';

export function startMessageHistorySyncConsume(
  server: FastifyInstance
): MessageHistorySyncConsume {
  const messageHistorySyncConsume = container.resolve(
    MessageHistorySyncConsume
  );

  messageHistorySyncConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message history sync consume'
    );
  });

  return messageHistorySyncConsume;
}
