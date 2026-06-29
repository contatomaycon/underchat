import 'reflect-metadata';
import { ConfigService } from '@core/services/config.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

describe('ConfigService', () => {
  it('lists channels with total', async () => {
    const listChannels = jest.fn(async () => [{ channel_id: 'c1' }]);
    const listChannelsTotal = jest.fn(async () => 7);
    const service = new ConfigService(
      {
        listChannels,
        listChannelsTotal,
        listAllNonDeletedChannelIds: jest.fn(),
        listAllNonDeletedChannelRecreateTargets: jest.fn(),
      } as never,
      { viewChannelBalancer: jest.fn() } as never,
      { getChannelsStatistics: jest.fn() } as never
    );

    await expect(
      service.listChannels(10, 2, { q: 'x' } as never)
    ).resolves.toEqual([[{ channel_id: 'c1' }], 7]);
    expect(listChannels).toHaveBeenCalledWith(10, 2, { q: 'x' });
    expect(listChannelsTotal).toHaveBeenCalledWith({ q: 'x' });
  });

  it('delegates balancer and listAllNonDeletedChannelIds', async () => {
    const viewChannelBalancer = jest.fn(async () => ({ worker_id: 'w1' }));
    const listAllNonDeletedChannelIds = jest.fn(async () => ['c1', 'c2']);
    const listAllNonDeletedChannelRecreateTargets = jest.fn(async () => [
      { worker_id: 'c1', server_id: 'srv-1' },
      { worker_id: 'c2', server_id: 'srv-2' },
    ]);
    const service = new ConfigService(
      {
        listChannels: jest.fn(),
        listChannelsTotal: jest.fn(),
        listAllNonDeletedChannelIds,
        listAllNonDeletedChannelRecreateTargets,
      } as never,
      { viewChannelBalancer } as never,
      { getChannelsStatistics: jest.fn() } as never
    );

    await expect(service.viewChannelBalancer('c1')).resolves.toEqual({
      worker_id: 'w1',
    });
    await expect(
      service.listAllNonDeletedChannelIds({ include_test: true } as never)
    ).resolves.toEqual(['c1', 'c2']);
    await expect(
      service.listAllNonDeletedChannelRecreateTargets({
        include_test: true,
      } as never)
    ).resolves.toEqual([
      { worker_id: 'c1', server_id: 'srv-1' },
      { worker_id: 'c2', server_id: 'srv-2' },
    ]);
  });

  it('maps channels statistics with default zero values', async () => {
    const getChannelsStatistics = jest.fn(async () => ({
      statusCounts: [
        { status_id: EWorkerStatus.online, count: 10 },
        { status_id: EWorkerStatus.error, count: 2 },
      ],
      total: 15,
    }));

    const service = new ConfigService(
      {
        listChannels: jest.fn(),
        listChannelsTotal: jest.fn(),
        listAllNonDeletedChannelIds: jest.fn(),
        listAllNonDeletedChannelRecreateTargets: jest.fn(),
      } as never,
      { viewChannelBalancer: jest.fn() } as never,
      { getChannelsStatistics } as never
    );

    await expect(service.getChannelsStatistics()).resolves.toEqual({
      online: 10,
      disponible: 0,
      new: 0,
      offline: 0,
      error: 2,
      mismatched: 0,
      stopped: 0,
      total: 15,
    });
  });
});
