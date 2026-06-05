import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest
    .fn()
    .mockReturnValueOnce('delete-request-1')
    .mockReturnValueOnce('replenish-request-1'),
}));

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-06-05T12:00:00.000Z'),
}));

jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class {},
}));

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { WarmChannelRecreatorUseCase } from '@core/useCases/config/WarmChannelRecreator.useCase';

describe('WarmChannelRecreatorUseCase', () => {
  it('rejects a warm pool entry that is not ready', async () => {
    const repository = {
      viewById: jest.fn(async () => ({
        warm_pool_id: 'warm-1',
        state: EWorkerWarmPoolState.assigned,
      })),
    };
    const queueService = {
      ensure: jest.fn(),
      publishDelete: jest.fn(),
      publishReplenish: jest.fn(),
    };
    const useCase = new WarmChannelRecreatorUseCase(
      repository as never,
      queueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'warm-1')).rejects.toThrow(
      'warm_channel_not_found'
    );
    expect(queueService.publishDelete).not.toHaveBeenCalled();
    expect(queueService.publishReplenish).not.toHaveBeenCalled();
  });

  it('publishes delete and replenish requests for a ready warm channel only', async () => {
    const warm = {
      warm_pool_id: 'warm-1',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'container-1',
      container_name: 'warm-container-1',
      session_volume_name: 'volume-1',
      state: EWorkerWarmPoolState.ready,
    };
    const repository = {
      viewById: jest.fn(async () => warm),
    };
    const queueService = {
      ensure: jest.fn(async () => undefined),
      publishDelete: jest.fn(async () => undefined),
      publishReplenish: jest.fn(async () => undefined),
    };
    const useCase = new WarmChannelRecreatorUseCase(
      repository as never,
      queueService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'warm-1')
    ).resolves.toEqual({ enqueued: 1 });
    expect(repository.viewById).toHaveBeenCalledWith('warm-1');
    expect(queueService.ensure).toHaveBeenCalledTimes(1);
    expect(queueService.publishDelete).toHaveBeenCalledWith({
      request_id: 'delete-request-1',
      warm_pool_id: 'warm-1',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'container-1',
      container_name: 'warm-container-1',
      session_volume_name: 'volume-1',
      remove_volume: true,
      reason: 'manual',
      requested_at: '2026-06-05T12:00:00.000Z',
    });
    expect(queueService.publishReplenish).toHaveBeenCalledWith({
      request_id: 'replenish-request-1',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.baileys,
      reason: 'manual',
      requested_at: '2026-06-05T12:00:00.000Z',
    });
  });
});
