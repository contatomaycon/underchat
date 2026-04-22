import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));

import { ChannelsStatisticsUseCase } from '@core/useCases/config/ChannelsStatistics.useCase';

describe('ChannelsStatisticsUseCase', () => {
  it('returns zeroed statistics when total is zero', async () => {
    const configService = {
      getChannelsStatistics: jest.fn(async () => ({
        online: 0,
        disponible: 0,
        new: 0,
        offline: 0,
        error: 0,
        mismatched: 0,
        stopped: 0,
        total: 0,
      })),
    };
    const useCase = new ChannelsStatisticsUseCase(configService as never);

    await expect(useCase.execute()).resolves.toEqual({
      online: { total: 0, percentage: 0 },
      disponible: { total: 0, percentage: 0 },
      new: { total: 0, percentage: 0 },
      offline: { total: 0, percentage: 0 },
      error: { total: 0, percentage: 0 },
      mismatched: { total: 0, percentage: 0 },
      stopped: { total: 0, percentage: 0 },
      total: 0,
    });
  });

  it('returns percentage values when total is greater than zero', async () => {
    const configService = {
      getChannelsStatistics: jest.fn(async () => ({
        online: 4,
        disponible: 3,
        new: 1,
        offline: 1,
        error: 0,
        mismatched: 1,
        stopped: 0,
        total: 10,
      })),
    };
    const useCase = new ChannelsStatisticsUseCase(configService as never);

    await expect(useCase.execute()).resolves.toEqual({
      online: { total: 4, percentage: 40 },
      disponible: { total: 3, percentage: 30 },
      new: { total: 1, percentage: 10 },
      offline: { total: 1, percentage: 10 },
      error: { total: 0, percentage: 0 },
      mismatched: { total: 1, percentage: 10 },
      stopped: { total: 0, percentage: 0 },
      total: 10,
    });
  });
});
