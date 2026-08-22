import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentPromptEmbeddingConsume } from '@core/consumer/aiAgent/AiAgentPromptEmbedding.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startAiAgentPromptEmbeddingConsume(
  server: FastifyInstance
): AiAgentPromptEmbeddingConsume {
  const aiAgentPromptEmbeddingConsume = container.resolve(
    AiAgentPromptEmbeddingConsume
  );

  return launchServiceApiConsumerStartup(
    aiAgentPromptEmbeddingConsume,
    () => aiAgentPromptEmbeddingConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting AI agent prompt embedding consume'
      )
  );
}
