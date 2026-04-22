import 'reflect-metadata';

jest.mock('@core/services/crossSell.service', () => ({
  CrossSellService: class {},
}));

import { CrossSellListerUseCase } from '@core/useCases/planCrossSell/CrossSellLister.useCase';

describe('CrossSellListerUseCase', () => {
  it('uses default pagination when query values are absent', async () => {
    const service = {
      listCrossSells: jest.fn(async () => [[], 0]),
    };
    const useCase = new CrossSellListerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, {} as never)
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

    expect(service.listCrossSells).toHaveBeenCalledWith(10, 1, {});
  });

  it('uses query pagination and returns pagings with results', async () => {
    const query = { per_page: 3, current_page: 2 } as never;
    const results = [{ plan_cross_sell_id: 'pcs-1' }];
    const service = {
      listCrossSells: jest.fn(async () => [results, 4]),
    };
    const useCase = new CrossSellListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, query)).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 3,
        count: 1,
        total: 4,
      },
      results,
    });
  });
});
