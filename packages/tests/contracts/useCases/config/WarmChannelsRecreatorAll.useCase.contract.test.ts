import 'reflect-metadata';

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { WarmChannelsRecreatorAllUseCase } from '@core/useCases/config/WarmChannelsRecreatorAll.useCase';

describe('WarmChannelsRecreatorAllUseCase', () => {
  const makeSettingsService = (warmupEnabled = true) => ({
    view: jest.fn(async () => ({
      warmup_enabled: warmupEnabled,
    })),
  });
  const makeQueueService = () => ({
    ensure: jest.fn(async () => undefined),
    publishReplenish: jest.fn(async () => undefined),
    publishDelete: jest.fn(async () => undefined),
  });

  it('throws when no ready warm channels match the filters', async () => {
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(async () => []),
      claimReadyForManualRecreate: jest.fn(),
    };
    const queueService = makeQueueService();
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      queueService as never,
      makeSettingsService() as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { server_id: 'srv-1' } as never)
    ).rejects.toThrow('no_warm_channels_to_recreate');
    expect(repository.listReadyWarmChannelsForRecreate).toHaveBeenCalledWith({
      server_id: 'srv-1',
      type: undefined,
      warm_pool_id: undefined,
      container_id: undefined,
      container_name: undefined,
      session_volume_name: undefined,
      search: undefined,
      created_at_from: undefined,
      created_at_to: undefined,
      updated_at_from: undefined,
      updated_at_to: undefined,
      last_health_at_from: undefined,
      last_health_at_to: undefined,
    });
    expect(repository.claimReadyForManualRecreate).not.toHaveBeenCalled();
    expect(queueService.ensure).not.toHaveBeenCalled();
  });

  it('rejects bulk recreation when automatic warmup is disabled', async () => {
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(),
      claimReadyForManualRecreate: jest.fn(),
    };
    const queueService = makeQueueService();
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      queueService as never,
      makeSettingsService(false) as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { server_id: 'srv-1' } as never)
    ).rejects.toThrow('warm_pool_warmup_disabled');
    expect(repository.listReadyWarmChannelsForRecreate).not.toHaveBeenCalled();
    expect(repository.claimReadyForManualRecreate).not.toHaveBeenCalled();
    expect(queueService.ensure).not.toHaveBeenCalled();
  });

  it('enqueues recreation for every ready warm channel matched by all filters', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const warmChannels = [
      {
        warm_pool_id: 'warm-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-1',
        container_name: 'warm-warm-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state: EWorkerWarmPoolState.ready,
      },
      {
        warm_pool_id: 'warm-2',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-2',
        container_name: 'warm-warm-2',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state: EWorkerWarmPoolState.ready,
      },
    ];
    let claimIndex = 0;
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(async () => warmChannels),
      claimReadyForManualRecreate: jest.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return {
          ...warmChannels[claimIndex++],
          state: EWorkerWarmPoolState.deleting,
        };
      }),
    };
    const queueService = makeQueueService();
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      queueService as never,
      makeSettingsService() as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        {
          server_id: 'srv-1',
          type: EWorkerType.baileys,
          warm_pool_id: 'warm',
          container_id: '',
          container_name: null,
          session_volume_name: 'volume',
          search: 'server',
        } as never
      )
    ).resolves.toEqual({ enqueued: 2 });
    expect(repository.listReadyWarmChannelsForRecreate).toHaveBeenCalledWith({
      server_id: 'srv-1',
      type: EWorkerType.baileys,
      warm_pool_id: 'warm',
      container_id: undefined,
      container_name: undefined,
      session_volume_name: 'volume',
      search: 'server',
      created_at_from: undefined,
      created_at_to: undefined,
      updated_at_from: undefined,
      updated_at_to: undefined,
      last_health_at_from: undefined,
      last_health_at_to: undefined,
    });
    expect(queueService.ensure).toHaveBeenCalledTimes(1);
    expect(repository.claimReadyForManualRecreate).toHaveBeenNthCalledWith(
      1,
      'warm-1'
    );
    expect(repository.claimReadyForManualRecreate).toHaveBeenNthCalledWith(
      2,
      'warm-2'
    );
    expect(queueService.publishReplenish).toHaveBeenCalledTimes(2);
    expect(queueService.publishReplenish).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        reason: 'manual',
      })
    );
    expect(queueService.publishDelete).toHaveBeenCalledTimes(2);
    expect(queueService.publishDelete).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        warm_pool_id: 'warm-1',
        container_id: 'container-1',
        session_volume_name: null,
        remove_volume: false,
        reason: 'manual',
      })
    );
    expect(maxInFlight).toBe(1);
  });

  it('skips rows reserved concurrently and reports only atomic recreation claims', async () => {
    const warmChannels = [
      {
        warm_pool_id: 'warm-raced',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        state: EWorkerWarmPoolState.ready,
      },
      {
        warm_pool_id: 'warm-claimed',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-claimed',
        container_name: 'warm-warm-claimed',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        state: EWorkerWarmPoolState.ready,
      },
    ];
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(async () => warmChannels),
      claimReadyForManualRecreate: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...warmChannels[1],
          state: EWorkerWarmPoolState.deleting,
        }),
    };
    const queueService = makeQueueService();
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      queueService as never,
      makeSettingsService() as never
    );

    await expect(
      useCase.execute(jest.fn() as never, {} as never)
    ).resolves.toEqual({ enqueued: 1 });
    expect(queueService.publishReplenish).toHaveBeenCalledTimes(1);
    expect(queueService.publishDelete).toHaveBeenCalledTimes(1);
  });
});
