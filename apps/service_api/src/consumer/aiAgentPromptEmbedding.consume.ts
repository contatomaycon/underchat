import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentPromptEmbeddingConsume } from '@core/consumer/aiAgent/AiAgentPromptEmbedding.consume';

export function startAiAgentPromptEmbeddingConsume(
  server: FastifyInstance
): AiAgentPromptEmbeddingConsume {
  const aiAgentPromptEmbeddingConsume = container.resolve(
    AiAgentPromptEmbeddingConsume
  );

  aiAgentPromptEmbeddingConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting AI agent prompt embedding consume'
    );
  });

  return aiAgentPromptEmbeddingConsume;
}
