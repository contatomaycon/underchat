import 'reflect-metadata';

jest.mock('@core/services/dashboard.service', () => ({
  DashboardService: class {},
}));

import { DashboardOfflineChannelsListerUseCase } from '@core/useCases/dashboard/DashboardOfflineChannelsLister.useCase';

describe('DashboardOfflineChannelsListerUseCase', () => {
  it('returns data from dashboard service', async () => {
    const result = { results: [{ channel: 'wpp', offline: true }] };
    const service = {
      getDashboardOfflineChannels: jest.fn(async () => result),
    };
    const useCase = new DashboardOfflineChannelsListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.getDashboardOfflineChannels).toHaveBeenCalledWith('acc-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      getDashboardOfflineChannels: jest.fn(async () => null),
    };
    const useCase = new DashboardOfflineChannelsListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toBeNull();
  });
});
