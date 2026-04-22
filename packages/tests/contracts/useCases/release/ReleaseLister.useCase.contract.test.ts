import 'reflect-metadata';

jest.mock('@core/services/release.service', () => ({
  ReleaseService: class {},
}));

import { ReleaseListerUseCase } from '@core/useCases/release/ReleaseLister.useCase';

describe('ReleaseListerUseCase', () => {
  it('uses default pagination when query values are missing', async () => {
    const service = {
      listReleases: jest.fn(async () => [[], 0]),
    };
    const useCase = new ReleaseListerUseCase(service as never);

    await expect(
      useCase.execute({} as never, 'acc-1', 'user-1', 'pr-1')
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

    expect(service.listReleases).toHaveBeenCalledWith(
      10,
      1,
      {},
      'acc-1',
      'user-1',
      'pr-1'
    );
  });

  it('uses query pagination and returns pagings with results', async () => {
    const query = { per_page: 2, current_page: 2 } as never;
    const results = [{ release_id: 'rel-1' }];
    const service = {
      listReleases: jest.fn(async () => [results, 3]),
    };
    const useCase = new ReleaseListerUseCase(service as never);

    await expect(
      useCase.execute(query, 'acc-1', 'user-1', 'pr-1')
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
