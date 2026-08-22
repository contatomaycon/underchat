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
import { AiAgentCreatorUseCase } from '@core/useCases/aiAgent/AiAgentCreator.useCase';

interface AgentState {
  ai_agent_type_id: string;
  status: EAiAgentStatus;
  api_key: string;
  base_url: string;
  openai_vector_store_id: string | null;
}

const translate = ((key: string) => key) as never;
const input = {
  ai_agent_type_id: EAiAgentType.gpt,
  name: 'GPT Agent',
  status: EAiAgentStatus.active,
  api_key: 'openai-key',
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-5.6',
  embedding_model: 'text-embedding-3-small',
};

const buildHarness = () => {
  let createdCount = 0;
  const agents = new Map<string, AgentState>();
  const aiAgentService = {
    createAiAgent: jest.fn(
      async (createInput: typeof input): Promise<string> => {
        createdCount += 1;
        const aiAgentId = `agent-${createdCount}`;
        agents.set(aiAgentId, {
          ai_agent_type_id: createInput.ai_agent_type_id,
          status: createInput.status,
          api_key: createInput.api_key,
          base_url: createInput.base_url,
          openai_vector_store_id: null,
        });
        return aiAgentId;
      }
    ),
    viewAiAgent: jest.fn(async (aiAgentId: string) => {
      return agents.get(aiAgentId) ?? null;
    }),
    deleteAiAgentById: jest.fn(async (aiAgentId: string) => {
      return agents.delete(aiAgentId);
    }),
  };
  const openAIAssistantService = {
    ensureVectorStore: jest.fn(async (aiAgentId: string) => {
      const vectorStoreId = `vs-${aiAgentId}`;
      const agent = agents.get(aiAgentId);
      if (agent) {
        agent.openai_vector_store_id = vectorStoreId;
      }
      return vectorStoreId;
    }),
    deleteVectorStore: jest.fn(async () => undefined),
  };
  const planAccountService = {
    validateCanCreateAiAgent: jest.fn(async () => undefined),
  };
  const useCase = new AiAgentCreatorUseCase(
    aiAgentService as never,
    openAIAssistantService as never,
    planAccountService as never
  );

  return {
    agents,
    aiAgentService,
    openAIAssistantService,
    useCase,
  };
};

describe('AiAgentCreatorUseCase rollback contract', () => {
  it('removes the persisted agent when vector-store provisioning fails', async () => {
    const harness = buildHarness();
    const provisioningError = new Error('OpenAI unavailable');
    harness.openAIAssistantService.ensureVectorStore.mockRejectedValueOnce(
      provisioningError
    );

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toBe(provisioningError);

    expect(harness.aiAgentService.deleteAiAgentById).toHaveBeenCalledWith(
      'agent-1',
      'account-1'
    );
    expect(harness.agents.size).toBe(0);
  });

  it('does not duplicate an agent when the caller retries after rollback', async () => {
    const harness = buildHarness();
    harness.openAIAssistantService.ensureVectorStore.mockRejectedValueOnce(
      new Error('Temporary OpenAI failure')
    );

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toThrow('Temporary OpenAI failure');
    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).resolves.toBe('agent-2');

    expect(harness.agents.size).toBe(1);
    expect(harness.agents.has('agent-1')).toBe(false);
    expect(harness.agents.has('agent-2')).toBe(true);
  });

  it('cleans the external resource after detecting an unpersisted vector-store id', async () => {
    const harness = buildHarness();
    harness.openAIAssistantService.ensureVectorStore.mockResolvedValueOnce(
      'vs-unpersisted'
    );

    await expect(
      harness.useCase.execute(translate, input as never, 'account-1')
    ).rejects.toThrow(
      'OpenAI vector store was provisioned but was not persisted.'
    );

    expect(harness.aiAgentService.deleteAiAgentById).toHaveBeenCalledWith(
      'agent-1',
      'account-1'
    );
    expect(
      harness.openAIAssistantService.deleteVectorStore
    ).toHaveBeenCalledWith(
      'openai-key',
      'https://api.openai.com/v1',
      'vs-unpersisted'
    );
    expect(
      harness.aiAgentService.deleteAiAgentById.mock.invocationCallOrder[0]
    ).toBeLessThan(
      harness.openAIAssistantService.deleteVectorStore.mock
        .invocationCallOrder[0]
    );
  });

  it('keeps the external resource when database rollback cannot be confirmed', async () => {
    const harness = buildHarness();
    harness.openAIAssistantService.ensureVectorStore.mockResolvedValueOnce(
      'vs-unpersisted'
    );
    harness.aiAgentService.deleteAiAgentById.mockRejectedValue(
      new Error('Database unavailable')
    );

    let thrown: unknown;
    try {
      await harness.useCase.execute(translate, input as never, 'account-1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(2);
    expect(harness.aiAgentService.deleteAiAgentById).toHaveBeenCalledTimes(3);
    expect(
      harness.openAIAssistantService.deleteVectorStore
    ).not.toHaveBeenCalled();
    expect(harness.agents.has('agent-1')).toBe(true);
  });
});
