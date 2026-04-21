import 'reflect-metadata';

jest.mock('@core/services/dashboard.service', () => ({
  DashboardService: class {},
}));

import { DashboardChannelsStatusListerUseCase } from '@core/useCases/dashboard/DashboardChannelsStatusLister.useCase';

describe('DashboardChannelsStatusListerUseCase', () => {
  it('returns data from dashboard service', async () => {
    const result = { results: [{ channel: 'wpp' }] };
    const service = {
      getDashboardChannelsStatus: jest.fn(async () => result),
    };
    const useCase = new DashboardChannelsStatusListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.getDashboardChannelsStatus).toHaveBeenCalledWith('acc-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      getDashboardChannelsStatus: jest.fn(async () => null),
    };
    const useCase = new DashboardChannelsStatusListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toBeNull();
  });
});
