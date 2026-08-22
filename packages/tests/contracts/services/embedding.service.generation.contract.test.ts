import 'reflect-metadata';

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (
      _redis: unknown,
      _lockKey: string,
      task: (context: {
        signal: AbortSignal;
        assertActive: () => void;
      }) => Promise<unknown>
    ) =>
      task({
        signal: new AbortController().signal,
        assertActive: jest.fn(),
      })
  ),
}));

import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EmbeddingService } from '@core/services/embedding.service';

const buildAgent = (overrides: Record<string, unknown> = {}) => ({
  ai_agent_type_id: EAiAgentType.deepseek,
  base_url: 'https://api.deepseek.com',
  api_key: 'test-key',
  model: 'deepseek-v4-flash',
  embedding_model: null,
  chunk_size: '600',
  chunk_overlap: '100',
  status: EAiAgentStatus.active,
  ...overrides,
});

const createPromptHarness = (agent = buildAgent()) => {
  const elasticClient = {
    indices: {
      exists: jest.fn(async () => true),
      putMapping: jest.fn(async () => ({})),
    },
    deleteByQuery: jest.fn(async () => ({})),
    search: jest.fn(),
  };
  const aiAgentViewerRepository = {
    viewAiAgent: jest.fn(async () => agent),
  };
  const aiAgentPromptViewerRepository = {
    viewAiAgentPrompt: jest.fn(async () => ({
      ai_agent_prompt_id: 'prompt-1',
      ai_agent_id: 'agent-1',
      value: 'prompt-source',
      status: EAiAgentStatus.active,
    })),
  };
  const elasticDatabaseService = {
    bulkUpdateWithScript: jest.fn(async () => ({
      updated: 1,
      noop: 0,
      failed: 0,
    })),
  };
  const service = new EmbeddingService(
    elasticClient as never,
    aiAgentViewerRepository as never,
    aiAgentPromptViewerRepository as never,
    elasticDatabaseService as never,
    {} as never
  );

  return {
    service,
    elasticClient,
    aiAgentViewerRepository,
    aiAgentPromptViewerRepository,
    elasticDatabaseService,
  };
};

describe('EmbeddingService generation contracts', () => {
  it('versions prompt document IDs and fingerprints when chunk configuration changes', async () => {
    const first = createPromptHarness(buildAgent({ chunk_size: '600' }));
    const second = createPromptHarness(buildAgent({ chunk_size: '500' }));

    await first.service.processAndStoreEmbeddings(
      'account-1',
      'agent-1',
      'prompt-1',
      'Pergunta curta com a mesma resposta.',
      'prompt-source'
    );
    await second.service.processAndStoreEmbeddings(
      'account-1',
      'agent-1',
      'prompt-1',
      'Pergunta curta com a mesma resposta.',
      'prompt-source'
    );

    type BulkOperation = {
      id: string;
      upsert: {
        content_fingerprint: string;
        content_revision: string;
        chunk_count: number;
      };
      script: {
        source: string;
      };
    };
    const firstCalls = first.elasticDatabaseService.bulkUpdateWithScript.mock
      .calls as unknown as Array<[string, BulkOperation[]]>;
    const secondCalls = second.elasticDatabaseService.bulkUpdateWithScript.mock
      .calls as unknown as Array<[string, BulkOperation[]]>;
    const firstOperation = firstCalls[0]?.[1]?.[0];
    const secondOperation = secondCalls[0]?.[1]?.[0];

    expect(firstOperation).toBeDefined();
    expect(secondOperation).toBeDefined();
    if (!firstOperation || !secondOperation) {
      throw new Error('Expected prompt embedding bulk operations.');
    }

    expect(firstOperation.id).not.toBe(secondOperation.id);
    expect(firstOperation.upsert.content_fingerprint).not.toBe(
      secondOperation.upsert.content_fingerprint
    );
    expect(firstOperation.upsert.content_revision).not.toBe(
      secondOperation.upsert.content_revision
    );
    expect(firstOperation.script.source).toContain(
      'ctx._source.embedding_generation == params.embedding_generation'
    );
    expect(firstOperation.script.source).toContain("ctx.op == 'create'");
    expect(firstOperation.upsert.chunk_count).toBe(1);
  });

  it('rejects a stale prompt job before it writes a superseded generation', async () => {
    const originalAgent = buildAgent({ chunk_size: '600' });
    const changedAgent = buildAgent({ chunk_size: '500' });
    const harness = createPromptHarness(originalAgent);
    harness.aiAgentViewerRepository.viewAiAgent
      .mockResolvedValueOnce(originalAgent)
      .mockResolvedValue(changedAgent);

    await expect(
      harness.service.processAndStoreEmbeddings(
        'account-1',
        'agent-1',
        'prompt-1',
        'Conteúdo do prompt',
        'prompt-source'
      )
    ).rejects.toThrow('configuration changed');

    expect(
      harness.elasticDatabaseService.bulkUpdateWithScript
    ).not.toHaveBeenCalled();
  });

  it('requires every expected chunk before a prompt generation is complete', async () => {
    const harness = createPromptHarness();
    harness.elasticClient.search
      .mockResolvedValueOnce({
        aggregations: {
          prompt_ids: {
            buckets: [
              {
                key: 'prompt-1',
                doc_count: 1,
                content_revisions: {
                  buckets: [
                    {
                      doc_count: 1,
                      expected_chunk_count: { value: 2 },
                    },
                  ],
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        aggregations: {
          prompt_ids: {
            buckets: [
              {
                key: 'prompt-1',
                doc_count: 2,
                content_revisions: {
                  buckets: [
                    {
                      doc_count: 2,
                      expected_chunk_count: { value: 2 },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

    await expect(
      harness.service.hasCompletePromptEmbeddingGeneration(
        'account-1',
        'agent-1',
        ['prompt-1']
      )
    ).resolves.toBe(false);
    await expect(
      harness.service.hasCompletePromptEmbeddingGeneration(
        'account-1',
        'agent-1',
        ['prompt-1']
      )
    ).resolves.toBe(true);
  });

  it('rejects mixed prompt revisions even when their combined count looks complete', async () => {
    const harness = createPromptHarness();
    harness.elasticClient.search.mockResolvedValue({
      aggregations: {
        prompt_ids: {
          buckets: [
            {
              key: 'prompt-1',
              doc_count: 2,
              content_revisions: {
                buckets: [
                  {
                    doc_count: 1,
                    expected_chunk_count: { value: 2 },
                  },
                  {
                    doc_count: 1,
                    expected_chunk_count: { value: 2 },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    await expect(
      harness.service.hasCompletePromptEmbeddingGeneration(
        'account-1',
        'agent-1',
        ['prompt-1']
      )
    ).resolves.toBe(false);
  });

  it('keeps BM25 relevance ordering for prompt and chat lexical fallback', () => {
    const harness = createPromptHarness();
    const internal = harness.service as unknown as {
      buildTextSearchQuery(
        accountId: string,
        aiAgentId: string,
        queryText: string,
        topK: number
      ): Record<string, unknown>;
      buildChatHistoryTextSearchQuery(
        accountId: string,
        aiAgentId: string,
        queryText: string,
        topK: number,
        chatIds: string[]
      ): Record<string, unknown>;
    };

    const promptQuery = internal.buildTextSearchQuery(
      'account-1',
      'agent-1',
      'horário de atendimento',
      5
    );
    const chatQuery = internal.buildChatHistoryTextSearchQuery(
      'account-1',
      'agent-1',
      'pedido anterior',
      5,
      ['chat-1']
    );

    expect(promptQuery).not.toHaveProperty('sort');
    expect(chatQuery).not.toHaveProperty('sort');
    expect(promptQuery).toHaveProperty(
      'query.bool.must.0.match.chunk_text.query',
      'horário de atendimento'
    );
    expect(chatQuery).toHaveProperty(
      'query.bool.must.0.match.message_text.query',
      'pedido anterior'
    );
  });

  it('does not delete or mark chat history when the bulk write is incomplete', async () => {
    const agent = buildAgent();
    const elasticClient = {
      indices: {
        exists: jest.fn(async () => true),
        putMapping: jest.fn(async () => ({})),
        refresh: jest.fn(async () => ({})),
      },
      search: jest.fn(async () => ({ hits: { hits: [] } })),
      deleteByQuery: jest.fn(async () => ({})),
    };
    const aiAgentViewerRepository = {
      viewAiAgent: jest.fn(async () => agent),
    };
    const aiAgentPromptViewerRepository = {
      viewAiAgentPrompt: jest.fn(),
    };
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: {
          hits: [
            {
              _source: {
                message_id: 'message-1',
                content: {
                  type: 'text',
                  message: 'Mensagem para indexar',
                },
                type_user: ETypeUserChat.client,
                phone: '5511999999999',
              },
            },
          ],
        },
      })),
      bulkCreateIdempotent: jest.fn(async () => ({
        created: 0,
        conflicts: 0,
        failed: 0,
      })),
      updateWithScriptOCC: jest.fn(),
    };
    const service = new EmbeddingService(
      elasticClient as never,
      aiAgentViewerRepository as never,
      aiAgentPromptViewerRepository as never,
      elasticDatabaseService as never,
      {} as never
    );
    const internal = service as unknown as {
      processChatHistoryEmbeddingsInternal(
        accountId: string,
        chatId: string,
        aiAgentId: string,
        phone?: string | null
      ): Promise<number>;
    };

    await expect(
      internal.processChatHistoryEmbeddingsInternal(
        'account-1',
        'chat-1',
        'agent-1',
        '5511999999999'
      )
    ).rejects.toThrow('Failed to persist all chat history embeddings');

    expect(elasticClient.deleteByQuery).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('rebuilds a chat after a partial bulk instead of treating one document as complete', async () => {
    const agent = buildAgent();
    const elasticClient = {
      indices: {
        exists: jest.fn(async () => true),
        putMapping: jest.fn(async () => ({})),
        refresh: jest.fn(async () => ({})),
      },
      deleteByQuery: jest.fn(async () => ({})),
    };
    const aiAgentViewerRepository = {
      viewAiAgent: jest.fn(async () => agent),
    };
    const aiAgentPromptViewerRepository = {
      viewAiAgentPrompt: jest.fn(),
    };
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: {
          hits: [
            {
              _source: {
                message_id: 'message-1',
                content: {
                  type: 'text',
                  message: 'Mensagem para reconstruir',
                },
                type_user: ETypeUserChat.client,
                phone: '5511999999999',
              },
            },
          ],
        },
      })),
      bulkCreateIdempotent: jest
        .fn()
        .mockResolvedValueOnce({
          created: 0,
          conflicts: 0,
          failed: 0,
        })
        .mockResolvedValueOnce({
          created: 1,
          conflicts: 0,
          failed: 0,
        }),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const service = new EmbeddingService(
      elasticClient as never,
      aiAgentViewerRepository as never,
      aiAgentPromptViewerRepository as never,
      elasticDatabaseService as never,
      {} as never
    );
    const internal = service as unknown as {
      processChatHistoryEmbeddingsInternal(
        accountId: string,
        chatId: string,
        aiAgentId: string,
        phone?: string | null
      ): Promise<number>;
    };

    await expect(
      internal.processChatHistoryEmbeddingsInternal(
        'account-1',
        'chat-1',
        'agent-1',
        '5511999999999'
      )
    ).rejects.toThrow('Failed to persist all chat history embeddings');

    await expect(
      internal.processChatHistoryEmbeddingsInternal(
        'account-1',
        'chat-1',
        'agent-1',
        '5511999999999'
      )
    ).resolves.toBe(1);

    expect(elasticDatabaseService.bulkCreateIdempotent).toHaveBeenCalledTimes(
      2
    );
    expect(elasticClient.deleteByQuery).toHaveBeenCalledTimes(1);
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(1);
  });
});
