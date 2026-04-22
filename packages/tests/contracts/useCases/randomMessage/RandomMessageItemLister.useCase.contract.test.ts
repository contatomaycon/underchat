import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageItemListerUseCase } from '@core/useCases/randomMessage/RandomMessageItemLister.useCase';

describe('RandomMessageItemListerUseCase', () => {
  it('throws when random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
      listRandomMessageItems: jest.fn(),
    };
    const useCase = new RandomMessageItemListerUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', {} as never, 'acc-1')
    ).rejects.toThrow('random_message_not_found');
    expect(randomMessageService.listRandomMessageItems).not.toHaveBeenCalled();
  });

  it('uses default pagination when query has no pagination fields', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      listRandomMessageItems: jest.fn(async () => [[], 0]),
    };
    const useCase = new RandomMessageItemListerUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', {} as never, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
    expect(randomMessageService.listRandomMessageItems).toHaveBeenCalledWith(
      10,
      1,
      {},
      'rm-1',
      'acc-1'
    );
  });

  it('returns paginated random message items', async () => {
    const results = [{ random_message_item_id: 'rmi-1' }];
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      listRandomMessageItems: jest.fn(async () => [results, 3]),
    };
    const useCase = new RandomMessageItemListerUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        'rm-1',
        { per_page: 2, current_page: 2 } as never,
        'acc-1'
      )
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 2,
        count: 1,
        total: 3,
      },
      results,
    });
  });
});
