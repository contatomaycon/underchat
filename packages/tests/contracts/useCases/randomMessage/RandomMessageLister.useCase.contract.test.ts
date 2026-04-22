import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageListerUseCase } from '@core/useCases/randomMessage/RandomMessageLister.useCase';

describe('RandomMessageListerUseCase', () => {
  it('uses default pagination when query does not provide pagination fields', async () => {
    const randomMessageService = {
      listRandomMessages: jest.fn(async () => [[], 0]),
    };
    const useCase = new RandomMessageListerUseCase(
      randomMessageService as never
    );

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
    expect(randomMessageService.listRandomMessages).toHaveBeenCalledWith(
      10,
      1,
      {},
      'acc-1'
    );
  });

  it('returns paginated random messages', async () => {
    const results = [{ random_message_id: 'rm-1' }];
    const randomMessageService = {
      listRandomMessages: jest.fn(async () => [results, 4]),
    };
    const useCase = new RandomMessageListerUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute({ per_page: 2, current_page: 2 } as never, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 2,
        count: 1,
        total: 4,
      },
      results,
    });
  });
});
