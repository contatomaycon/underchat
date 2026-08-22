import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

import { ChatListerUseCase } from '@core/useCases/chat/ChatLister.useCase';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

function emptyElasticResult() {
  return {
    hits: {
      total: {
        value: 0,
        relation: 'eq',
      },
      hits: [],
    },
  };
}

describe('ChatListerUseCase elastic sort', () => {
  const makeUseCase = () =>
    new ChatListerUseCase({} as never, {} as never) as unknown as {
      buildElasticsearchSort(sortBy: string, sortOrder: string): unknown[];
    };

  it('sets unmapped_type for nested keyword sorts', () => {
    const useCase = makeUseCase();

    expect(useCase.buildElasticsearchSort('sector.name', 'asc')).toEqual([
      {
        'sector.name.keyword': {
          order: 'asc',
          unmapped_type: 'keyword',
          nested: {
            path: 'sector',
          },
        },
      },
    ]);
  });

  it('sets unmapped_type for nested summary date sort', () => {
    const useCase = makeUseCase();

    expect(
      useCase.buildElasticsearchSort('summary.last_message', 'desc')
    ).toEqual([
      {
        'summary.last_date': {
          order: 'desc',
          unmapped_type: 'date',
          nested: {
            path: 'summary',
          },
        },
      },
    ]);
  });

  it('filters unread conversations in list and count queries', async () => {
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue(emptyElasticResult()),
    };
    const chatUserService = {
      viewChatUser: jest.fn().mockResolvedValue(null),
    };
    const useCase = new ChatListerUseCase(
      elasticDatabaseService as never,
      chatUserService as never
    );

    await useCase.execute(
      'account-1',
      {
        current_page: 1,
        per_page: 20,
        status: EChatStatus.queue,
        filter_unread_conversations: true,
      },
      'user-1',
      [],
      [],
      []
    );

    const selectCalls = elasticDatabaseService.select.mock.calls;
    expect(selectCalls[0][0]).toBe(EElasticIndex.chat);

    const initialQueryJson = JSON.stringify(selectCalls[0][1]);
    expect(initialQueryJson).toContain('"path":"summary"');
    expect(initialQueryJson).toContain('"summary.unread_count":{"gt":0}');

    const countQueryJson = JSON.stringify(selectCalls[1][1]);
    expect(countQueryJson).toContain('"path":"summary"');
    expect(countQueryJson).toContain('"summary.unread_count":{"gt":0}');
  });
});
