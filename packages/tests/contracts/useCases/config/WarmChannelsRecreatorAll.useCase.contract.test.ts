import 'reflect-metadata';

jest.mock('@core/useCases/config/WarmChannelRecreator.useCase', () => ({
  WarmChannelRecreatorUseCase: class {},
}));

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { WarmChannelsRecreatorAllUseCase } from '@core/useCases/config/WarmChannelsRecreatorAll.useCase';

describe('WarmChannelsRecreatorAllUseCase', () => {
  const makeSettingsService = (warmupEnabled = true) => ({
    view: jest.fn(async () => ({
      warmup_enabled: warmupEnabled,
    })),
  });

  it('throws when no ready warm channels match the filters', async () => {
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(async () => []),
    };
    const recreator = {
      enqueueRecreate: jest.fn(),
    };
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      recreator as never,
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
    expect(recreator.enqueueRecreate).not.toHaveBeenCalled();
  });

  it('rejects bulk recreation when automatic warmup is disabled', async () => {
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(),
    };
    const recreator = {
      enqueueRecreate: jest.fn(),
    };
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      recreator as never,
      makeSettingsService(false) as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { server_id: 'srv-1' } as never)
    ).rejects.toThrow('warm_pool_warmup_disabled');
    expect(repository.listReadyWarmChannelsForRecreate).not.toHaveBeenCalled();
    expect(recreator.enqueueRecreate).not.toHaveBeenCalled();
  });

  it('enqueues recreation for every ready warm channel matched by all filters', async () => {
    const warmChannels = [
      {
        warm_pool_id: 'warm-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: 'volume-1',
        state: EWorkerWarmPoolState.ready,
      },
      {
        warm_pool_id: 'warm-2',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        session_volume_name: 'volume-2',
        state: EWorkerWarmPoolState.ready,
      },
    ];
    const repository = {
      listReadyWarmChannelsForRecreate: jest.fn(async () => warmChannels),
    };
    const recreator = {
      enqueueRecreate: jest.fn(async () => undefined),
    };
    const useCase = new WarmChannelsRecreatorAllUseCase(
      repository as never,
      recreator as never,
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
    expect(recreator.enqueueRecreate).toHaveBeenCalledTimes(2);
    expect(recreator.enqueueRecreate).toHaveBeenNthCalledWith(
      1,
      warmChannels[0]
    );
    expect(recreator.enqueueRecreate).toHaveBeenNthCalledWith(
      2,
      warmChannels[1]
    );
  });
});
