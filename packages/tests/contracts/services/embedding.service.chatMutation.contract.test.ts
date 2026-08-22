import 'reflect-metadata';

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EmbeddingService } from '@core/services/embedding.service';

describe('EmbeddingService chat mutation', () => {
  it('adds the AI agent with a partial atomic script and never rewrites summary', async () => {
    const elasticDatabaseService = {
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  chat_id: 'chat-1',
                  account: { id: 'account-1' },
                  status: 'closed',
                  summary: {
                    revision: 12,
                    unread_count: 5,
                    last_message_id: 'message-new',
                  },
                  embedded_for_ai_agents: ['agent-existing'],
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: {
            hits: [{ _id: 'chat-1' }],
          },
        }),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const service = new EmbeddingService(
      {} as never,
      {} as never,
      {} as never,
      elasticDatabaseService as never,
      {} as never
    );

    await expect(
      service.markChatAsEmbedded('account-1', 'chat-1', 'agent-new')
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      {
        source: expect.stringContaining(
          'ctx._source.embedded_for_ai_agents.add(params.ai_agent_id)'
        ),
        params: {
          ai_agent_id: 'agent-new',
          closed_status: 'closed',
        },
      },
      {
        upsert: false,
        maxRetries: 5,
        refresh: true,
      }
    );
    const updateCalls = elasticDatabaseService.updateWithScriptOCC.mock
      .calls as unknown[][];
    const updateInput = updateCalls[0]?.[2];
    expect(updateInput).not.toHaveProperty('summary');
  });

  it('treats an already-added concurrent agent marker as an idempotent noop', async () => {
    const elasticDatabaseService = {
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  chat_id: 'chat-1',
                  account: { id: 'account-1' },
                  status: 'closed',
                  embedded_for_ai_agents: [],
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: {
            hits: [{ _id: 'chat-1' }],
          },
        }),
      updateWithScriptOCC: jest.fn(async () => 'noop'),
    };
    const service = new EmbeddingService(
      {} as never,
      {} as never,
      {} as never,
      elasticDatabaseService as never,
      {} as never
    );

    await expect(
      service.markChatAsEmbedded('account-1', 'chat-1', 'agent-1')
    ).resolves.toBe(true);
  });

  it('does not confirm the marker when the chat reopens during the OCC update', async () => {
    const elasticDatabaseService = {
      select: jest
        .fn()
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  chat_id: 'chat-1',
                  account: { id: 'account-1' },
                  status: 'closed',
                  embedded_for_ai_agents: [],
                },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          hits: {
            hits: [],
          },
        }),
      updateWithScriptOCC: jest.fn(async () => 'noop'),
    };
    const service = new EmbeddingService(
      {} as never,
      {} as never,
      {} as never,
      elasticDatabaseService as never,
      {} as never
    );

    await expect(
      service.markChatAsEmbedded('account-1', 'chat-1', 'agent-1')
    ).resolves.toBe(false);

    const updateCalls = elasticDatabaseService.updateWithScriptOCC.mock
      .calls as unknown[][];
    expect(updateCalls[0]?.[2]).toEqual(
      expect.objectContaining({
        source: expect.stringContaining(
          'ctx._source.status != params.closed_status'
        ),
      })
    );
  });
});
