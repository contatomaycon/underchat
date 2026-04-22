import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));

import { ChannelsListerUseCase } from '@core/useCases/config/ChannelsLister.useCase';

describe('ChannelsListerUseCase', () => {
  it('uses default pagination when query has no pagination fields', async () => {
    const configService = {
      listChannels: jest.fn(async () => [[], 0]),
    };
    const useCase = new ChannelsListerUseCase(configService as never);

    await expect(useCase.execute({} as never)).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });

    expect(configService.listChannels).toHaveBeenCalledWith(10, 1, {});
  });

  it('returns paginated channel list', async () => {
    const results = [{ worker_id: 'worker-1' }];
    const configService = {
      listChannels: jest.fn(async () => [results, 3]),
    };
    const useCase = new ChannelsListerUseCase(configService as never);

    await expect(
      useCase.execute({ per_page: 2, current_page: 2 } as never)
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
