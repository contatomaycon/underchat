import 'reflect-metadata';

import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { AiAgentPromptUpdaterUseCase } from '@core/useCases/aiAgent/AiAgentPromptUpdater.useCase';

const prompt = {
  ai_agent_prompt_id: 'prompt-1',
  ai_agent_id: 'agent-1',
  value: 'https://storage.example.com/old.txt',
  status: EAiAgentStatus.active,
  openai_file_id: null,
};

const file = {
  filename: 'knowledge.txt',
  mimetype: 'text/plain',
  data: Buffer.from('new knowledge'),
};

const buildHarness = () => {
  const aiAgentService = {
    viewAiAgentPrompt: jest.fn(async () => prompt),
    updateAiAgentPromptById: jest.fn(),
    viewAiAgent: jest.fn(async () => ({
      ai_agent_type_id: 'provider-1',
    })),
    updateAiAgentPromptOpenAIFileId: jest.fn(async () => true),
  };
  const storageService = {
    uploadDocument: jest.fn(async () => ({
      url: 'https://storage.example.com/new.txt',
    })),
    deleteImage: jest.fn(async () => true),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    aiAgentPromptEmbedding: jest.fn(() => 'prompt-embedding'),
  };
  const embeddingService = {
    withEmbeddingGenerationLock: jest.fn(
      async (
        _accountId: string,
        _aiAgentId: string,
        task: () => Promise<boolean>
      ) => task()
    ),
    deletePromptEmbeddings: jest.fn(async () => true),
  };
  const useCase = new AiAgentPromptUpdaterUseCase(
    aiAgentService as never,
    {} as never,
    storageService as never,
    streamProducerService as never,
    kafkaServiceQueueService as never,
    embeddingService as never
  );

  return {
    useCase,
    aiAgentService,
    storageService,
    streamProducerService,
    embeddingService,
  };
};

const translate = ((key: string) => key) as never;

describe('AiAgentPromptUpdaterUseCase copy-on-write contract', () => {
  it('removes only the new upload when the database update fails', async () => {
    const harness = buildHarness();
    harness.aiAgentService.updateAiAgentPromptById.mockResolvedValue(false);

    await expect(
      harness.useCase.execute(
        translate,
        'prompt-1',
        { file } as never,
        'account-1'
      )
    ).rejects.toThrow('ai_agent_prompt_update_error');

    expect(harness.storageService.deleteImage).toHaveBeenCalledTimes(1);
    expect(harness.storageService.deleteImage).toHaveBeenCalledWith(
      'https://storage.example.com/new.txt'
    );
  });

  it('rolls the prompt back and preserves the old source when publish fails', async () => {
    const harness = buildHarness();
    harness.aiAgentService.updateAiAgentPromptById
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    harness.streamProducerService.send.mockRejectedValue(
      new Error('Kafka unavailable')
    );

    await expect(
      harness.useCase.execute(
        translate,
        'prompt-1',
        { file } as never,
        'account-1'
      )
    ).rejects.toThrow('Kafka unavailable');

    expect(
      harness.aiAgentService.updateAiAgentPromptById
    ).toHaveBeenNthCalledWith(
      2,
      {
        value: prompt.value,
        status: prompt.status,
      },
      'prompt-1',
      'account-1'
    );
    expect(harness.storageService.deleteImage).toHaveBeenCalledWith(
      'https://storage.example.com/new.txt'
    );
    expect(harness.storageService.deleteImage).not.toHaveBeenCalledWith(
      prompt.value
    );
  });

  it('deletes the old source only after the new generation was queued', async () => {
    const harness = buildHarness();
    harness.aiAgentService.updateAiAgentPromptById.mockResolvedValue(true);

    await expect(
      harness.useCase.execute(
        translate,
        'prompt-1',
        { file } as never,
        'account-1'
      )
    ).resolves.toBe(true);

    expect(harness.storageService.deleteImage).toHaveBeenCalledWith(
      prompt.value
    );
    expect(
      harness.streamProducerService.send.mock.invocationCallOrder[0]
    ).toBeLessThan(
      harness.storageService.deleteImage.mock.invocationCallOrder[0]
    );
  });

  it('does not reactivate a prompt after inactive cleanup has started', async () => {
    const harness = buildHarness();
    harness.aiAgentService.updateAiAgentPromptById.mockResolvedValue(true);
    harness.embeddingService.deletePromptEmbeddings.mockResolvedValue(false);

    await expect(
      harness.useCase.execute(
        translate,
        'prompt-1',
        { status: EAiAgentStatus.inactive } as never,
        'account-1'
      )
    ).rejects.toThrow('Failed to remove inactive prompt embeddings.');

    expect(
      harness.aiAgentService.updateAiAgentPromptById
    ).toHaveBeenCalledTimes(1);
    expect(harness.aiAgentService.updateAiAgentPromptById).toHaveBeenCalledWith(
      {
        value: prompt.value,
        status: EAiAgentStatus.inactive,
      },
      'prompt-1',
      'account-1'
    );
  });
});
