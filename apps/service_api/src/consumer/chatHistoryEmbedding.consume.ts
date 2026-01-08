import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatHistoryEmbeddingConsume } from '@core/consumer/chatHistory/ChatHistoryEmbedding.consume';

export function startChatHistoryEmbeddingConsume(
  server: FastifyInstance
): ChatHistoryEmbeddingConsume {
  const chatHistoryEmbeddingConsume = container.resolve(
    ChatHistoryEmbeddingConsume
  );

  chatHistoryEmbeddingConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting chat history embedding consume'
    );
  });

  return chatHistoryEmbeddingConsume;
}
