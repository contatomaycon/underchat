import 'reflect-metadata';
import { WarmChannelsListerUseCase } from '@core/useCases/config/WarmChannelsLister.useCase';

describe('WarmChannelsListerUseCase', () => {
  it('uses default pagination for ready warm channels', async () => {
    const repository = {
      listReadyWarmChannels: jest.fn(async () => []),
      listReadyWarmChannelsTotal: jest.fn(async () => 0),
    };
    const useCase = new WarmChannelsListerUseCase(repository as never);

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
    expect(repository.listReadyWarmChannels).toHaveBeenCalledWith(10, 1, {});
    expect(repository.listReadyWarmChannelsTotal).toHaveBeenCalledWith({});
  });

  it('returns paginated ready warm channel results', async () => {
    const results = [{ warm_pool_id: 'warm-1' }];
    const repository = {
      listReadyWarmChannels: jest.fn(async () => results),
      listReadyWarmChannelsTotal: jest.fn(async () => 3),
    };
    const useCase = new WarmChannelsListerUseCase(repository as never);

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
