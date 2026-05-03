import 'reflect-metadata';

jest.mock('@core/mappings/internalChatMessage.mappings', () => ({
  internalChatMessageMappings: jest.fn(() => ({
    mappings: { properties: {} },
  })),
}));

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { InternalChatMessageRepository } from '@core/repositories/internalChat/InternalChatMessage.repository';

describe('InternalChatMessageRepository.searchMessages', () => {
  it('queries Elasticsearch for visible text in one internal conversation', async () => {
    const select = jest.fn().mockResolvedValue({
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              message_id: 'message-1',
              account_id: 'account-1',
              conversation_id: 'conversation-1',
              type_user: ETypeUserChat.operator,
              user: {
                id: 'user-1',
                name: 'User',
                photo: null,
              },
              content: {
                type: EMessageType.text,
                message: 'needle text',
              },
              date: '2026-05-02T10:00:00.000Z',
              deleted: false,
            },
          },
        ],
      },
    });
    const elasticDatabaseService = {
      indices: jest.fn().mockResolvedValue(undefined),
      select,
    };
    const repository = new InternalChatMessageRepository(
      elasticDatabaseService as never
    );

    await expect(
      repository.searchMessages({
        accountId: 'account-1',
        conversationId: 'conversation-1',
        search: 'needle',
        currentPage: 2,
        perPage: 25,
      })
    ).resolves.toEqual({
      results: [
        expect.objectContaining({
          message_id: 'message-1',
        }),
      ],
      total: 1,
    });

    expect(select).toHaveBeenCalledWith(
      EElasticIndex.internal_chat_message,
      expect.objectContaining({
        from: 25,
        size: 25,
        sort: [{ date: { order: 'desc' } }],
        query: {
          bool: {
            filter: [
              { term: { account_id: 'account-1' } },
              { term: { conversation_id: 'conversation-1' } },
            ],
            must: [
              {
                nested: {
                  path: 'content',
                  query: {
                    bool: {
                      must: [
                        {
                          match: {
                            'content.message': {
                              query: 'needle',
                              operator: 'and',
                            },
                          },
                        },
                      ],
                      must_not: [
                        {
                          term: {
                            'content.type': EMessageType.delete_message,
                          },
                        },
                        {
                          term: {
                            'content.type': EMessageType.system,
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
            must_not: [{ term: { deleted: true } }],
          },
        },
      })
    );
  });
});
