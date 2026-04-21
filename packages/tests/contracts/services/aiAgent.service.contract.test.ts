import 'reflect-metadata';

jest.mock('@core/repositories/aiAgent/AiAgentLister.repository', () => ({
  AiAgentListerRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentCreator.repository', () => ({
  AiAgentCreatorRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentViewer.repository', () => ({
  AiAgentViewerRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentUpdater.repository', () => ({
  AiAgentUpdaterRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentDeleter.repository', () => ({
  AiAgentDeleterRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentTypeLister.repository', () => ({
  AiAgentTypeListerRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentPromptLister.repository', () => ({
  AiAgentPromptListerRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentPromptCreator.repository', () => ({
  AiAgentPromptCreatorRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentPromptViewer.repository', () => ({
  AiAgentPromptViewerRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentPromptUpdater.repository', () => ({
  AiAgentPromptUpdaterRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentPromptDeleter.repository', () => ({
  AiAgentPromptDeleterRepository: class {},
}));

jest.mock('@core/repositories/aiAgent/AiAgentUsageLister.repository', () => ({
  AiAgentUsageListerRepository: class {},
}));

jest.mock(
  '@core/repositories/aiAgent/AiAgentHumanTransferTargetLister.repository',
  () => ({
    AiAgentHumanTransferTargetListerRepository: class {},
  })
);

jest.mock(
  '@core/repositories/aiAgent/AiAgentHumanTransferUpserterTransaction.repository',
  () => ({
    AiAgentHumanTransferUpserterTransactionRepository: class {},
  })
);

import { AiAgentService } from '@core/services/aiAgent.service';

describe('AiAgentService', () => {
  const makeService = () => {
    const aiAgentListerRepository = {
      listAiAgents: jest.fn(async () => [
        {
          ai_agent_id: 'agent-1',
          name: 'Agent 1',
        },
      ]),
      listAiAgentsTotal: jest.fn(async () => 1),
      listActiveAiAgentsForChatbot: jest.fn(async () => [
        {
          ai_agent_id: 'agent-1',
          name: 'Agent 1',
        },
      ]),
      totalAiAgentByAccountId: jest.fn(async () => 7),
    };

    const aiAgentCreatorRepository = {
      createAiAgent: jest.fn<Promise<string | null>, any[]>(
        async () => 'agent-1'
      ),
    };

    const aiAgentViewerRepository = {
      viewAiAgent: jest.fn<Promise<any>, any[]>(async () => ({
        ai_agent_id: 'agent-1',
        name: 'Agent 1',
      })),
    };

    const aiAgentUpdaterRepository = {
      updateAiAgentById: jest.fn<Promise<boolean>, any[]>(async () => true),
      updateAiAgentOpenAIIds: jest.fn<Promise<boolean>, any[]>(
        async () => true
      ),
    };

    const aiAgentDeleterRepository = {
      deleteAiAgentPromptsByAgentId: jest.fn(async () => undefined),
      deleteAiAgentById: jest.fn<Promise<boolean>, any[]>(async () => true),
    };

    const aiAgentTypeListerRepository = {
      listAiAgentTypes: jest.fn(async () => [{ ai_agent_type_id: 'type-1' }]),
    };

    const aiAgentPromptListerRepository = {
      listAiAgentPrompts: jest.fn(async () => [
        { ai_agent_prompt_id: 'prompt-1' },
      ]),
    };

    const aiAgentPromptCreatorRepository = {
      createAiAgentPrompt: jest.fn(async () => 'prompt-1'),
    };

    const aiAgentPromptViewerRepository = {
      viewAiAgentPrompt: jest.fn(async () => ({
        ai_agent_prompt_id: 'prompt-1',
      })),
    };

    const aiAgentPromptUpdaterRepository = {
      updateAiAgentPromptById: jest.fn(async () => true),
      updateAiAgentPromptOpenAIFileId: jest.fn(async () => true),
    };

    const aiAgentPromptDeleterRepository = {
      deleteAiAgentPromptById: jest.fn(async () => true),
    };

    const aiAgentUsageListerRepository = {
      listByAiAgentId: jest.fn(async () => [{ usage: 123 }]),
      totalByAiAgentId: jest.fn(async () => 1),
    };

    const aiAgentHumanTransferTargetListerRepository = {
      listByAiAgentId: jest.fn<Promise<any[]>, any[]>(async () => []),
    };

    const aiAgentHumanTransferUpserterTransactionRepository = {
      upsert: jest.fn(async () => true),
    };

    const redis = {
      get: jest.fn<Promise<string | null>, [string]>(async () => null),
      setex: jest.fn<Promise<'OK'>, [string, number, string]>(async () => 'OK'),
      del: jest.fn<Promise<number>, [string]>(async () => 1),
    };

    const service = new AiAgentService(
      aiAgentListerRepository as never,
      aiAgentCreatorRepository as never,
      aiAgentViewerRepository as never,
      aiAgentUpdaterRepository as never,
      aiAgentDeleterRepository as never,
      aiAgentTypeListerRepository as never,
      aiAgentPromptListerRepository as never,
      aiAgentPromptCreatorRepository as never,
      aiAgentPromptViewerRepository as never,
      aiAgentPromptUpdaterRepository as never,
      aiAgentPromptDeleterRepository as never,
      aiAgentUsageListerRepository as never,
      aiAgentHumanTransferTargetListerRepository as never,
      aiAgentHumanTransferUpserterTransactionRepository as never,
      redis as never
    );

    return {
      service,
      aiAgentListerRepository,
      aiAgentCreatorRepository,
      aiAgentViewerRepository,
      aiAgentUpdaterRepository,
      aiAgentDeleterRepository,
      aiAgentTypeListerRepository,
      aiAgentPromptListerRepository,
      aiAgentPromptCreatorRepository,
      aiAgentPromptViewerRepository,
      aiAgentPromptUpdaterRepository,
      aiAgentPromptDeleterRepository,
      aiAgentUsageListerRepository,
      aiAgentHumanTransferTargetListerRepository,
      aiAgentHumanTransferUpserterTransactionRepository,
      redis,
    };
  };

  it('lists ai agents and total from lister repository', async () => {
    const { service, aiAgentListerRepository } = makeService();

    await expect(
      service.listAiAgents(10, 1, { search: 'agent' } as never, 'acc-1')
    ).resolves.toEqual([
      [
        {
          ai_agent_id: 'agent-1',
          name: 'Agent 1',
        },
      ],
      1,
    ]);

    expect(aiAgentListerRepository.listAiAgents).toHaveBeenCalledWith(
      10,
      1,
      { search: 'agent' },
      'acc-1'
    );
    expect(aiAgentListerRepository.listAiAgentsTotal).toHaveBeenCalledWith(
      { search: 'agent' },
      'acc-1'
    );
  });

  it('uses cache when viewing ai agent and falls back to repository + cache write', async () => {
    const { service, redis, aiAgentViewerRepository } = makeService();

    redis.get.mockResolvedValueOnce(
      JSON.stringify({ ai_agent_id: 'agent-cache', name: 'Cached Agent' })
    );

    await expect(service.viewAiAgent('agent-cache', 'acc-1')).resolves.toEqual({
      ai_agent_id: 'agent-cache',
      name: 'Cached Agent',
    });
    expect(aiAgentViewerRepository.viewAiAgent).not.toHaveBeenCalled();

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce({
      ai_agent_id: 'agent-1',
      name: 'Agent 1',
    });

    await expect(service.viewAiAgent('agent-1', 'acc-1')).resolves.toEqual({
      ai_agent_id: 'agent-1',
      name: 'Agent 1',
    });

    expect(aiAgentViewerRepository.viewAiAgent).toHaveBeenCalledWith(
      'agent-1',
      'acc-1'
    );
    expect(redis.setex).toHaveBeenCalledWith(
      'ai-agent:view:agent-1:acc-1',
      600,
      JSON.stringify({ ai_agent_id: 'agent-1', name: 'Agent 1' })
    );

    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce(null);
    await expect(
      service.viewAiAgent('agent-null', 'acc-1')
    ).resolves.toBeNull();
  });

  it('invalidates cache for create/update/delete/openai-id updates when operation succeeds', async () => {
    const {
      service,
      aiAgentCreatorRepository,
      aiAgentUpdaterRepository,
      aiAgentDeleterRepository,
      redis,
    } = makeService();

    await expect(
      service.createAiAgent({ name: 'Agent 1' } as never, 'acc-1')
    ).resolves.toBe('agent-1');
    expect(redis.del).toHaveBeenCalledWith('ai-agent:view:agent-1:acc-1');

    aiAgentCreatorRepository.createAiAgent.mockResolvedValueOnce(null);
    await expect(
      service.createAiAgent({ name: 'Agent 2' } as never, 'acc-1')
    ).resolves.toBeNull();

    await expect(
      service.updateAiAgentById(
        { name: 'Updated' } as never,
        'agent-1',
        'acc-1'
      )
    ).resolves.toBe(true);

    aiAgentUpdaterRepository.updateAiAgentById.mockResolvedValueOnce(false);
    await expect(
      service.updateAiAgentById(
        { name: 'No update' } as never,
        'agent-1',
        'acc-1'
      )
    ).resolves.toBe(false);

    await expect(service.deleteAiAgentById('agent-1', 'acc-1')).resolves.toBe(
      true
    );

    aiAgentDeleterRepository.deleteAiAgentById.mockResolvedValueOnce(false);
    await expect(service.deleteAiAgentById('agent-1', 'acc-1')).resolves.toBe(
      false
    );

    await expect(
      service.updateAiAgentOpenAIIds('agent-1', 'acc-1', {
        openai_assistant_id: 'asst-1',
      })
    ).resolves.toBe(true);

    aiAgentUpdaterRepository.updateAiAgentOpenAIIds.mockResolvedValueOnce(
      false
    );
    await expect(
      service.updateAiAgentOpenAIIds('agent-1', 'acc-1', {
        openai_vector_store_id: 'vs-1',
      })
    ).resolves.toBe(false);
  });

  it('delegates prompt, type and counter/list methods', async () => {
    const {
      service,
      aiAgentTypeListerRepository,
      aiAgentPromptListerRepository,
      aiAgentPromptCreatorRepository,
      aiAgentPromptViewerRepository,
      aiAgentPromptUpdaterRepository,
      aiAgentPromptDeleterRepository,
      aiAgentDeleterRepository,
      aiAgentListerRepository,
      aiAgentUsageListerRepository,
    } = makeService();

    await expect(service.listAiAgentTypes()).resolves.toEqual([
      { ai_agent_type_id: 'type-1' },
    ]);
    expect(aiAgentTypeListerRepository.listAiAgentTypes).toHaveBeenCalledWith();

    await expect(
      service.listAiAgentPrompts({ search: 'x' } as never, 'acc-1')
    ).resolves.toEqual([{ ai_agent_prompt_id: 'prompt-1' }]);
    expect(
      aiAgentPromptListerRepository.listAiAgentPrompts
    ).toHaveBeenCalledWith({ search: 'x' }, 'acc-1');

    await expect(
      service.createAiAgentPrompt({ prompt: 'hello' } as never, 'acc-1')
    ).resolves.toBe('prompt-1');
    expect(
      aiAgentPromptCreatorRepository.createAiAgentPrompt
    ).toHaveBeenCalledWith({ prompt: 'hello' }, 'acc-1');

    await expect(
      service.viewAiAgentPrompt('prompt-1', 'acc-1')
    ).resolves.toEqual({ ai_agent_prompt_id: 'prompt-1' });
    expect(
      aiAgentPromptViewerRepository.viewAiAgentPrompt
    ).toHaveBeenCalledWith('prompt-1', 'acc-1');

    await expect(
      service.updateAiAgentPromptById(
        { prompt: 'updated' } as never,
        'prompt-1',
        'acc-1'
      )
    ).resolves.toBe(true);

    await expect(
      service.deleteAiAgentPromptById('prompt-1', 'acc-1')
    ).resolves.toBe(true);

    await expect(
      service.updateAiAgentPromptOpenAIFileId('prompt-1', 'acc-1', 'file-1')
    ).resolves.toBe(true);
    expect(
      aiAgentPromptUpdaterRepository.updateAiAgentPromptOpenAIFileId
    ).toHaveBeenCalledWith('prompt-1', 'acc-1', 'file-1');

    await expect(
      service.deleteAiAgentPromptsByAgentId('agent-1', 'acc-1')
    ).resolves.toBeUndefined();
    expect(
      aiAgentDeleterRepository.deleteAiAgentPromptsByAgentId
    ).toHaveBeenCalledWith('agent-1', 'acc-1');

    await expect(
      service.listActiveAiAgentsForChatbot('acc-1')
    ).resolves.toEqual([
      {
        ai_agent_id: 'agent-1',
        name: 'Agent 1',
      },
    ]);
    await expect(service.totalAiAgentByAccountId('acc-1')).resolves.toBe(7);

    await expect(
      service.listAiAgentUsage('agent-1', 'acc-1', 15, 2)
    ).resolves.toEqual([[{ usage: 123 }], 1]);
    expect(aiAgentUsageListerRepository.listByAiAgentId).toHaveBeenCalledWith(
      'agent-1',
      'acc-1',
      15,
      2
    );
    expect(aiAgentUsageListerRepository.totalByAiAgentId).toHaveBeenCalledWith(
      'agent-1',
      'acc-1'
    );
  });

  it('builds human transfer view from grouped sector targets and default booleans', async () => {
    const {
      service,
      redis,
      aiAgentViewerRepository,
      aiAgentHumanTransferTargetListerRepository,
    } = makeService();

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce({
      ai_agent_id: 'agent-1',
      enable_human_transfer: null,
      enable_human_transfer_by_prompt: undefined,
    });
    aiAgentHumanTransferTargetListerRepository.listByAiAgentId.mockResolvedValueOnce(
      [
        { sector_id: 'sector-1', user_id: 'user-1' },
        { sector_id: 'sector-1', user_id: 'user-2' },
        { sector_id: 'sector-2', user_id: null },
        { sector_id: null, user_id: 'ignored-user' },
      ]
    );

    await expect(
      service.viewAiAgentHumanTransfer('agent-1', 'acc-1')
    ).resolves.toEqual({
      enable_human_transfer: false,
      enable_human_transfer_by_prompt: false,
      sector_targets: [
        {
          sector_id: 'sector-1',
          user_ids: ['user-1', 'user-2'],
        },
        {
          sector_id: 'sector-2',
          user_ids: [],
        },
      ],
    });
  });

  it('handles human transfer when ai agent does not exist and upsert outcomes', async () => {
    const {
      service,
      redis,
      aiAgentViewerRepository,
      aiAgentHumanTransferUpserterTransactionRepository,
    } = makeService();

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce(null);

    await expect(
      service.viewAiAgentHumanTransfer('agent-missing', 'acc-1')
    ).resolves.toBeNull();

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce(null);
    await expect(
      service.upsertAiAgentHumanTransfer('agent-missing', 'acc-1', {
        enable_human_transfer: true,
        enable_human_transfer_by_prompt: false,
        sector_targets: [],
      })
    ).resolves.toBe(false);

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce({
      ai_agent_id: 'agent-1',
    });
    aiAgentHumanTransferUpserterTransactionRepository.upsert.mockResolvedValueOnce(
      false
    );
    await expect(
      service.upsertAiAgentHumanTransfer('agent-1', 'acc-1', {
        enable_human_transfer: true,
        enable_human_transfer_by_prompt: false,
        sector_targets: [],
      })
    ).resolves.toBe(false);

    redis.get.mockResolvedValueOnce(null);
    aiAgentViewerRepository.viewAiAgent.mockResolvedValueOnce({
      ai_agent_id: 'agent-1',
    });
    aiAgentHumanTransferUpserterTransactionRepository.upsert.mockResolvedValueOnce(
      true
    );

    await expect(
      service.upsertAiAgentHumanTransfer('agent-1', 'acc-1', {
        enable_human_transfer: true,
        enable_human_transfer_by_prompt: true,
        sector_targets: [
          {
            sector_id: 'sector-1',
            user_ids: ['user-1'],
          },
        ],
      })
    ).resolves.toBe(true);

    expect(redis.del).toHaveBeenCalledWith('ai-agent:view:agent-1:acc-1');
  });
});
