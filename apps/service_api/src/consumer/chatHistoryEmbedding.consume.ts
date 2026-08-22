import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatHistoryEmbeddingConsume } from '@core/consumer/chatHistory/ChatHistoryEmbedding.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startChatHistoryEmbeddingConsume(
  server: FastifyInstance
): ChatHistoryEmbeddingConsume {
  const chatHistoryEmbeddingConsume = container.resolve(
    ChatHistoryEmbeddingConsume
  );

  return launchServiceApiConsumerStartup(
    chatHistoryEmbeddingConsume,
    () => chatHistoryEmbeddingConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting chat history embedding consume'
      )
  );
}
