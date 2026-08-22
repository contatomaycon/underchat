import 'reflect-metadata';

import { AiAgentUpdaterUseCase } from '@core/useCases/aiAgent/AiAgentUpdater.useCase';

describe('AiAgentUpdaterUseCase rollback contract', () => {
  it('restores the previous vector store together with provider fields', async () => {
    const aiAgentService = {
      updateAiAgentById: jest.fn(async () => true),
      updateAiAgentOpenAIIds: jest.fn(async () => true),
    };
    const useCase = new AiAgentUpdaterUseCase(
      aiAgentService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const internal = useCase as unknown as {
      rollbackAiAgentUpdate(
        rollbackBody: { model: string },
        aiAgentId: string,
        accountId: string,
        previousVectorStoreId: string | null
      ): Promise<void>;
    };

    await internal.rollbackAiAgentUpdate(
      { model: 'gpt-5.6' },
      'agent-1',
      'account-1',
      'vs-previous'
    );

    expect(aiAgentService.updateAiAgentById).toHaveBeenCalledWith(
      { model: 'gpt-5.6' },
      'agent-1',
      'account-1'
    );
    expect(aiAgentService.updateAiAgentOpenAIIds).toHaveBeenCalledWith(
      'agent-1',
      'account-1',
      {
        openai_vector_store_id: 'vs-previous',
      }
    );
  });

  it('can restore a previously absent vector store', async () => {
    const aiAgentService = {
      updateAiAgentById: jest.fn(async () => true),
      updateAiAgentOpenAIIds: jest.fn(async () => true),
    };
    const useCase = new AiAgentUpdaterUseCase(
      aiAgentService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const internal = useCase as unknown as {
      rollbackAiAgentUpdate(
        rollbackBody: { model: string },
        aiAgentId: string,
        accountId: string,
        previousVectorStoreId: string | null
      ): Promise<void>;
    };

    await internal.rollbackAiAgentUpdate(
      { model: 'gpt-5.6' },
      'agent-1',
      'account-1',
      null
    );

    expect(aiAgentService.updateAiAgentOpenAIIds).toHaveBeenCalledWith(
      'agent-1',
      'account-1',
      {
        openai_vector_store_id: null,
      }
    );
  });
});
