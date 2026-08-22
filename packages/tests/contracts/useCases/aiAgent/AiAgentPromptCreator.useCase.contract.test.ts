import 'reflect-metadata';

import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { AiAgentPromptCreatorUseCase } from '@core/useCases/aiAgent/AiAgentPromptCreator.useCase';

const file = {
  filename: 'knowledge.txt',
  mimetype: 'text/plain',
  data: Buffer.from('knowledge'),
};

const buildHarness = () => {
  const aiAgentService = {
    createAiAgentPrompt: jest.fn(async () => 'prompt-1'),
    deleteAiAgentPromptById: jest.fn(async () => true),
    viewAiAgent: jest.fn(async () => ({
      ai_agent_type_id: 'provider-1',
    })),
  };
  const storageService = {
    uploadDocument: jest.fn(async () => ({
      url: 'https://storage.example.com/knowledge.txt',
    })),
    deleteImage: jest.fn(async () => true),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    aiAgentPromptEmbedding: jest.fn(() => 'prompt-embedding'),
  };
  const useCase = new AiAgentPromptCreatorUseCase(
    aiAgentService as never,
    storageService as never,
    streamProducerService as never,
    kafkaServiceQueueService as never
  );

  return {
    useCase,
    aiAgentService,
    storageService,
    streamProducerService,
  };
};

const translate = ((key: string) => key) as never;
const input = {
  ai_agent_id: 'agent-1',
  status: EAiAgentStatus.active,
  file,
};

describe('AiAgentPromptCreatorUseCase rollback contract', () => {
  it('removes the upload when prompt persistence fails', async () => {
    const harness = buildHarness();
    harness.aiAgentService.createAiAgentPrompt.mockRejectedValue(
      new Error('Database unavailable')
    );

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toThrow('Database unavailable');

    expect(harness.storageService.deleteImage).toHaveBeenCalledWith(
      'https://storage.example.com/knowledge.txt'
    );
  });

  it('removes the prompt and source when queue delivery fails', async () => {
    const harness = buildHarness();
    harness.streamProducerService.send.mockRejectedValue(
      new Error('Kafka unavailable')
    );

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toThrow('Kafka unavailable');

    expect(harness.aiAgentService.deleteAiAgentPromptById).toHaveBeenCalledWith(
      'prompt-1',
      'account-1'
    );
    expect(harness.storageService.deleteImage).toHaveBeenCalledWith(
      'https://storage.example.com/knowledge.txt'
    );
  });

  it('retains the source if prompt rollback cannot be confirmed', async () => {
    const harness = buildHarness();
    harness.streamProducerService.send.mockRejectedValue(
      new Error('Kafka unavailable')
    );
    harness.aiAgentService.deleteAiAgentPromptById.mockResolvedValue(false);

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toThrow('Kafka unavailable');

    expect(harness.storageService.deleteImage).not.toHaveBeenCalled();
  });
});
