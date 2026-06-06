import 'reflect-metadata';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerUpdaterUseCase } from './WorkerUpdater.useCase';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));

jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class WorkerWarmPoolQueueService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

const t = ((key: string) => key) as never;

function buildUseCase(
  overrides: {
    currentServerStatusId?: EServerStatus;
    currentServerId?: string;
    nextServerId?: string;
    currentWorkerType?: EWorkerType;
    warmPool?: {
      warm_pool_id: string;
      container_id?: string | null;
      container_name?: string | null;
      session_volume_name?: string | null;
    } | null;
  } = {}
) {
  const callOrder: string[] = [];
  const currentServerId = overrides.currentServerId ?? 'server-old';
  const nextServerId = overrides.nextServerId ?? 'server-new';
  const currentWorkerType = overrides.currentWorkerType ?? EWorkerType.wwebjs;

  const workerService = {
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: currentWorkerType,
    })),
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: currentServerId,
      server_status_id: overrides.currentServerStatusId ?? EServerStatus.online,
      account_id: 'account-1',
    })),
    viewWorker: jest.fn(async () => ({
      status: { id: EWorkerStatus.online },
    })),
    listWorkerServers: jest.fn(async () => [
      {
        server_id: nextServerId,
        name: 'Server new',
      },
    ]),
    updateWorkerById: jest.fn(async () => {
      callOrder.push('update');
      return true;
    }),
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const workerConfigService = {
    refreshTypingSimulationCache: jest.fn(async () => undefined),
  };

  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => ({
      warmup_enabled: false,
      reservation_ttl_seconds: 90,
    })),
  };
  const workerWarmPoolRepository = {
    releaseExpiredReservations: jest.fn(async () => 0),
    reserveReady: jest.fn(async () => overrides.warmPool ?? null),
  };
  const workerLifecycleQueueService = {
    publish: jest.fn(async (payload: { action: string }) => {
      callOrder.push(payload.action);
    }),
  };
  const workerWarmPoolQueueService = {
    publishReplenish: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
  };

  const useCase = new WorkerUpdaterUseCase(
    workerService as never,
    accountService as never,
    workerConfigService as never,
    workerWarmPoolSettingsService as never,
    workerWarmPoolRepository as never,
    workerLifecycleQueueService as never,
    workerWarmPoolQueueService as never,
    centrifugoService as never
  );

  return {
    useCase,
    callOrder,
    workerService,
    workerLifecycleQueueService,
    workerWarmPoolRepository,
    currentServerId,
    nextServerId,
  };
}

describe('WorkerUpdaterUseCase', () => {
  it('enqueues previous-server cleanup before recreate on server change', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      server_id: deps.nextServerId,
      worker_status_id: EWorkerStatus.recreating,
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_id: 'worker-1',
        server_id: deps.currentServerId,
        operation_id: 'uuid-v7',
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        server_id: deps.nextServerId,
        remove_session: true,
        remove_volume: true,
        operation_id: 'uuid-v7',
      })
    );
    expect(deps.callOrder).toEqual([
      'update',
      'cleanup_previous_runtime',
      'recreate',
    ]);
  });

  it('skips previous-server cleanup when the previous server is offline', async () => {
    const deps = buildUseCase({
      currentServerStatusId: EServerStatus.offline,
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: deps.nextServerId,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        server_id: deps.nextServerId,
      })
    );
    expect(deps.callOrder).toEqual(['update', 'recreate']);
  });

  it('does not enqueue lifecycle when the selected server is unchanged', async () => {
    const deps = buildUseCase({
      nextServerId: 'server-old',
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Wwebjs',
        server_id: 'server-old',
      })
    ).resolves.toBe(true);

    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-1',
        name: 'Wwebjs',
      }
    );
  });

  it('enqueues recreate without pre-cleanup on same-server type change without warm runtime', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Baileys',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_status_id: EWorkerStatus.recreating,
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_type_id: EWorkerType.baileys,
        remove_session: true,
        remove_volume: true,
      })
    );
  });

  it('enqueues cleanup before warm activation when a warm runtime is reserved', async () => {
    const deps = buildUseCase({
      warmPool: {
        warm_pool_id: 'warm-1',
        container_id: 'container-warm',
        container_name: 'warm-container',
        session_volume_name: 'warm-1',
      },
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Baileys',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      reason: 'warm_activation_queued',
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        server_id: deps.currentServerId,
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
        worker_type_id: EWorkerType.baileys,
      })
    );
  });
});
