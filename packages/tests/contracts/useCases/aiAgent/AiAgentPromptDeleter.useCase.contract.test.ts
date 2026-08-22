import 'reflect-metadata';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { AiAgentPromptDeleterUseCase } from '@core/useCases/aiAgent/AiAgentPromptDeleter.useCase';

const prompt = {
  ai_agent_prompt_id: 'prompt-id',
  ai_agent_id: 'agent-id',
  value: 'https://storage.example.test/prompt.txt',
  openai_file_id: null,
  status: EAiAgentStatus.active,
  created_at: null,
  updated_at: null,
};

const createHarness = (overrides?: {
  deleteEmbeddingsResult?: boolean;
  deletePromptResult?: boolean;
}) => {
  const operations: string[] = [];
  const aiAgentService = {
    viewAiAgentPrompt: jest.fn().mockResolvedValue(prompt),
    updateAiAgentPromptById: jest.fn().mockImplementation(async () => {
      operations.push('deactivate-prompt');
      return true;
    }),
    deleteAiAgentPromptById: jest.fn().mockImplementation(async () => {
      operations.push('delete-prompt');
      return overrides?.deletePromptResult ?? true;
    }),
  };
  const embeddingService = {
    withEmbeddingGenerationLock: jest
      .fn()
      .mockImplementation(
        async (
          _accountId: string,
          _aiAgentId: string,
          callback: () => Promise<boolean>
        ) => callback()
      ),
    deletePromptEmbeddings: jest.fn().mockImplementation(async () => {
      operations.push('delete-embeddings');
      return overrides?.deleteEmbeddingsResult ?? true;
    }),
  };
  const storageService = {
    deleteImage: jest.fn().mockImplementation(async () => {
      operations.push('delete-source');
    }),
  };
  const openAIAssistantService = {
    registerPendingOpenAIFileCleanup: jest.fn(),
    cleanupPendingOpenAIFiles: jest.fn(),
  };

  return {
    operations,
    aiAgentService,
    embeddingService,
    storageService,
    useCase: new AiAgentPromptDeleterUseCase(
      aiAgentService as never,
      openAIAssistantService as never,
      storageService as never,
      embeddingService as never
    ),
  };
};

describe('AiAgentPromptDeleterUseCase consistency contract', () => {
  const translate = ((key: string) => key) as never;

  it('deactivates the prompt before deleting its embeddings and record', async () => {
    const harness = createHarness();

    await expect(
      harness.useCase.execute(translate, 'prompt-id', 'account-id')
    ).resolves.toBe(true);

    expect(harness.operations).toEqual([
      'deactivate-prompt',
      'delete-embeddings',
      'delete-prompt',
      'delete-source',
    ]);
    expect(harness.aiAgentService.updateAiAgentPromptById).toHaveBeenCalledWith(
      { status: EAiAgentStatus.inactive },
      'prompt-id',
      'account-id'
    );
  });

  it('keeps the record inactive when embedding cleanup fails', async () => {
    const harness = createHarness({ deleteEmbeddingsResult: false });

    await expect(
      harness.useCase.execute(translate, 'prompt-id', 'account-id')
    ).rejects.toThrow('ai_agent_prompt_deleter_error');

    expect(harness.operations).toEqual([
      'deactivate-prompt',
      'delete-embeddings',
    ]);
    expect(
      harness.aiAgentService.deleteAiAgentPromptById
    ).not.toHaveBeenCalled();
    expect(harness.storageService.deleteImage).not.toHaveBeenCalled();
  });

  it('does not remove the source when the database delete fails', async () => {
    const harness = createHarness({ deletePromptResult: false });

    await expect(
      harness.useCase.execute(translate, 'prompt-id', 'account-id')
    ).rejects.toThrow('ai_agent_prompt_deleter_error');

    expect(harness.operations).toEqual([
      'deactivate-prompt',
      'delete-embeddings',
      'delete-prompt',
    ]);
    expect(harness.storageService.deleteImage).not.toHaveBeenCalled();
  });
});
