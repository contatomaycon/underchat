import 'reflect-metadata';

jest.mock('@core/services/aiAgentProviderConfiguration.service', () => ({
  prepareAiAgentProviderConfiguration: jest.fn(async () => ({
    base_url: 'https://api.openai.com/v1',
    api_key: 'openai-key',
    model: 'gpt-5.6',
    embedding_model: 'text-embedding-3-small',
  })),
}));

import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentVoiceInputMode } from '@core/common/enums/EAiAgentVoiceInputMode';
import { EAiAgentVoiceOutputMode } from '@core/common/enums/EAiAgentVoiceOutputMode';
import { prepareAiAgentProviderConfiguration } from '@core/services/aiAgentProviderConfiguration.service';
import { AiAgentUpdaterUseCase } from '@core/useCases/aiAgent/AiAgentUpdater.useCase';

const prepareAiAgentProviderConfigurationMock = jest.mocked(
  prepareAiAgentProviderConfiguration
);
const translate = ((key: string) => key) as never;
const existingAgent = {
  ai_agent_id: 'agent-1',
  account_id: 'account-1',
  ai_agent_type_id: EAiAgentType.gpt,
  ai_agent_type_name: 'GPT',
  name: 'GPT Agent',
  base_url: 'https://api.openai.com/v1',
  api_key: 'openai-key',
  model: 'gpt-5.6',
  embedding_model: 'text-embedding-3-small',
  chunk_size: '600',
  chunk_overlap: '100',
  openai_assistant_id: null,
  openai_vector_store_id: 'vs-missing',
  status: EAiAgentStatus.active,
  system_prompt: 'Be helpful',
  enable_human_transfer: false,
  enable_human_transfer_by_prompt: false,
  voice_ia_id: null,
  voice_ia_input_mode: EAiAgentVoiceInputMode.audio_and_text,
  voice_ia_output_mode: EAiAgentVoiceOutputMode.audio,
  created_at: null,
  updated_at: null,
};

const createHarness = (activeAgent: typeof existingAgent = existingAgent) => {
  const aiAgentService = {
    viewAiAgent: jest
      .fn()
      .mockResolvedValueOnce(existingAgent)
      .mockResolvedValue(activeAgent),
    updateAiAgentById: jest.fn().mockResolvedValue(true),
    updateAiAgentOpenAIIds: jest.fn().mockResolvedValue(true),
    listAiAgentPrompts: jest.fn().mockResolvedValue([
      {
        ai_agent_prompt_id: 'prompt-1',
        status: EAiAgentStatus.active,
      },
    ]),
  };
  const openAIAssistantService = {
    ensureVectorStore: jest.fn().mockResolvedValue('vs-replacement'),
    deleteVectorStore: jest.fn().mockResolvedValue(undefined),
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
    hasCompletePromptEmbeddingGeneration: jest.fn().mockResolvedValue(true),
    invalidateChatHistoryEmbeddingGeneration: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const promptRefresher = {
    execute: jest.fn().mockResolvedValue(true),
  };
  const useCase = new AiAgentUpdaterUseCase(
    aiAgentService as never,
    openAIAssistantService as never,
    {
      ensureCanActivateAiAgentIfNeeded: jest.fn(),
    } as never,
    embeddingService as never,
    promptRefresher as never
  );

  return {
    aiAgentService,
    openAIAssistantService,
    embeddingService,
    promptRefresher,
    useCase,
  };
};

describe('AiAgentUpdaterUseCase vector-store recovery contract', () => {
  beforeEach(() => {
    prepareAiAgentProviderConfigurationMock.mockResolvedValue({
      base_url: 'https://api.openai.com/v1',
      api_key: 'openai-key',
      model: 'gpt-5.6',
      embedding_model: 'text-embedding-3-small',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('forces prompt refresh when OpenAI replaces a missing vector store', async () => {
    const harness = createHarness();

    await expect(
      harness.useCase.execute(
        translate,
        'agent-1',
        { name: 'Renamed agent' },
        'account-1'
      )
    ).resolves.toBe(true);

    expect(harness.promptRefresher.execute).toHaveBeenCalledWith(
      translate,
      'agent-1',
      'account-1'
    );
    expect(
      harness.embeddingService.hasCompletePromptEmbeddingGeneration
    ).not.toHaveBeenCalled();
    expect(
      harness.openAIAssistantService.deleteVectorStore
    ).not.toHaveBeenCalled();
  });

  it('clears the broken reference and deletes the replacement when refresh fails', async () => {
    const harness = createHarness();
    const refreshError = new Error('Kafka unavailable');
    harness.promptRefresher.execute.mockRejectedValue(refreshError);
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });

    await expect(
      harness.useCase.execute(
        translate,
        'agent-1',
        { name: 'Renamed agent' },
        'account-1'
      )
    ).rejects.toBe(refreshError);

    expect(harness.promptRefresher.execute).toHaveBeenCalledTimes(3);
    expect(harness.aiAgentService.updateAiAgentOpenAIIds).toHaveBeenCalledWith(
      'agent-1',
      'account-1',
      {
        openai_vector_store_id: null,
      }
    );
    expect(
      harness.openAIAssistantService.deleteVectorStore
    ).toHaveBeenCalledWith(
      'openai-key',
      'https://api.openai.com/v1',
      'vs-replacement'
    );
  });

  it('restores the previous store when only the replacement credentials saw a 404', async () => {
    const replacementAgent = {
      ...existingAgent,
      base_url: 'https://replacement.example.test/v1',
      api_key: 'replacement-key',
    };
    const harness = createHarness(replacementAgent);
    const refreshError = new Error('Kafka unavailable');
    prepareAiAgentProviderConfigurationMock.mockResolvedValue({
      base_url: replacementAgent.base_url,
      api_key: replacementAgent.api_key,
      model: replacementAgent.model,
      embedding_model: replacementAgent.embedding_model,
    });
    harness.promptRefresher.execute.mockRejectedValue(refreshError);
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });

    await expect(
      harness.useCase.execute(
        translate,
        'agent-1',
        {
          base_url: replacementAgent.base_url,
          api_key: replacementAgent.api_key,
        },
        'account-1'
      )
    ).rejects.toBe(refreshError);

    expect(harness.aiAgentService.updateAiAgentOpenAIIds).toHaveBeenCalledWith(
      'agent-1',
      'account-1',
      {
        openai_vector_store_id: 'vs-missing',
      }
    );
    expect(
      harness.openAIAssistantService.deleteVectorStore
    ).toHaveBeenCalledWith(
      'replacement-key',
      'https://replacement.example.test/v1',
      'vs-replacement'
    );
  });
});
