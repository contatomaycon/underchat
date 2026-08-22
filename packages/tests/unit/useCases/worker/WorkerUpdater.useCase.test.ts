import 'reflect-metadata';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';

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

const unofficialProviderHandoffMatrix = [
  [EWorkerType.baileys, EWorkerType.wwebjs],
  [EWorkerType.baileys, EWorkerType.whatsmeow],
  [EWorkerType.wwebjs, EWorkerType.baileys],
  [EWorkerType.wwebjs, EWorkerType.whatsmeow],
  [EWorkerType.whatsmeow, EWorkerType.baileys],
  [EWorkerType.whatsmeow, EWorkerType.wwebjs],
] as const;

function providerForWorkerType(
  workerType: (typeof unofficialProviderHandoffMatrix)[number][number]
): 'baileys' | 'wwebjs' | 'whatsmeow' {
  if (workerType === EWorkerType.baileys) return 'baileys';
  if (workerType === EWorkerType.wwebjs) return 'wwebjs';
  return 'whatsmeow';
}

function buildUseCase(
  overrides: {
    currentServerStatusId?: EServerStatus;
    currentServerId?: string;
    nextServerId?: string;
    currentWorkerType?: EWorkerType;
    sessionStorage?: EWorkerSessionStorage;
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
    viewWorkerForMonitorConsistent: jest.fn(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      deleted_at: null,
      server_id: currentServerId,
      worker_type_id: currentWorkerType,
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: null,
      session_storage:
        overrides.sessionStorage ?? EWorkerSessionStorage.legacy_volume,
    })),
    viewWorkerType: jest.fn(async () => ({
      worker_type_id: currentWorkerType,
    })),
    viewWorkerBalancer: jest.fn(async () => ({
      server_id: currentServerId,
      server_status_id: overrides.currentServerStatusId ?? EServerStatus.online,
      account_id: 'account-1',
    })),
    viewWorkerLifecycleServer: jest.fn(async () => ({
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
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
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
    prepare: jest.fn(async () => undefined),
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
  it('does not reserve a warm runtime for a session-preserving recreate', async () => {
    const deps = buildUseCase({
      warmPool: {
        warm_pool_id: 'warm-1',
      },
    });

    await expect(
      (
        deps.useCase as unknown as {
          tryReserveWarmRuntimeForRecreate(input: {
            accountId: string;
            workerId: string;
            serverId: string;
            workerType: EWorkerType;
            removeSession?: boolean;
            removeVolume?: boolean;
          }): Promise<unknown>;
        }
      ).tryReserveWarmRuntimeForRecreate({
        accountId: 'account-1',
        workerId: 'worker-1',
        serverId: 'server-1',
        workerType: EWorkerType.baileys,
        removeSession: false,
        removeVolume: false,
      })
    ).resolves.toBeNull();

    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
  });

  it('converts legacy storage to PostgreSQL and enqueues volume cleanup before a server move', async () => {
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

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        server_id: deps.nextServerId,
        session_storage: EWorkerSessionStorage.postgres,
        number: null,
        connection_date: null,
        worker_status_id: EWorkerStatus.recreating,
      }),
      expect.any(Object)
    );

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_id: 'worker-1',
        server_id: deps.currentServerId,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
        operation_id: 'uuid-v7',
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        server_id: deps.nextServerId,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
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

  it('skips previous-server cleanup for a portable PostgreSQL session when the previous server is offline', async () => {
    const deps = buildUseCase({
      currentServerStatusId: EServerStatus.offline,
      sessionStorage: EWorkerSessionStorage.postgres,
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

  it('keeps legacy-volume cleanup durable when the previous server is offline', async () => {
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

    expect(
      deps.workerLifecycleQueueService.publish.mock.calls.map(
        ([payload]) => payload.action
      )
    ).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        server_id: deps.currentServerId,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        server_id: deps.nextServerId,
        cleanup_previous_runtime_required: true,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
      })
    );
  });

  it('does not convert a non-WhatsApp legacy worker to PostgreSQL on a server move', async () => {
    const deps = buildUseCase({
      currentWorkerType: EWorkerType.telegram,
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Telegram',
        server_id: deps.nextServerId,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
    });

    const inputUpdate = (
      deps.workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock
    ).mock.calls[0]?.[1];
    expect(inputUpdate).toEqual(
      expect.objectContaining({
        worker_id: 'worker-1',
        server_id: deps.nextServerId,
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(inputUpdate).not.toHaveProperty('session_storage');
    expect(inputUpdate).not.toHaveProperty('number');
    expect(inputUpdate).not.toHaveProperty('connection_date');
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.telegram,
        session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({
        previous_session_storage: expect.anything(),
      })
    );
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

  it.each(unofficialProviderHandoffMatrix)(
    'converts legacy-volume provider change %s -> %s into a fresh PostgreSQL session',
    async (sourceType, targetType) => {
      const deps = buildUseCase({ currentWorkerType: sourceType });

      await expect(
        deps.useCase.execute(t, 'account-1', {
          worker_id: 'worker-1',
          name: 'Provider change',
          worker_type: targetType,
        })
      ).resolves.toMatchObject({
        code: 202,
        queued: true,
        worker_type_id: targetType,
      });

      expect(deps.workerService.viewWorkerBalancer).not.toHaveBeenCalled();
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_type_id: targetType,
          session_storage: EWorkerSessionStorage.postgres,
          number: null,
          connection_date: null,
          worker_status_id: EWorkerStatus.recreating,
        }),
        expect.not.objectContaining({
          whatsapp_provider_handoff: expect.anything(),
        })
      );
      expect(
        deps.workerLifecycleQueueService.publish.mock.calls.map(
          ([payload]) => payload.action
        )
      ).toEqual(['cleanup_previous_runtime', 'recreate']);
      expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_type_id: targetType,
          session_storage: EWorkerSessionStorage.postgres,
          previous_session_storage: EWorkerSessionStorage.legacy_volume,
          remove_session: true,
          remove_volume: true,
        })
      );
      expect(deps.workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
    }
  );

  it('rejects type changes outside Baileys, WWebJS and WhatsMeow even with PostgreSQL storage', async () => {
    const deps = buildUseCase({
      currentWorkerType: EWorkerType.telegram,
      sessionStorage: EWorkerSessionStorage.postgres,
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Unsupported conversion',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow('worker_type_change_unofficial_only');

    expect(deps.workerService.viewWorkerBalancer).not.toHaveBeenCalled();
    expect(deps.workerService.viewWorkerLifecycleServer).not.toHaveBeenCalled();
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('durably enqueues a PostgreSQL handoff when the previous server is offline', async () => {
    const deps = buildUseCase({
      currentServerStatusId: EServerStatus.offline,
      sessionStorage: EWorkerSessionStorage.postgres,
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
      worker_status_id: EWorkerStatus.recreating,
    });

    expect(deps.workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        server_id: deps.currentServerId,
        worker_type_id: EWorkerType.wwebjs,
        remove_session: false,
        remove_volume: false,
      })
    );
    expect(
      deps.workerLifecycleQueueService.publish.mock.calls.map(
        ([payload]) => payload.action
      )
    ).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_type_id: EWorkerType.baileys,
        cleanup_previous_runtime_required: true,
        remove_session: false,
        remove_volume: false,
      })
    );
  });

  it.each(unofficialProviderHandoffMatrix)(
    'preserves PostgreSQL state and requests provider handoff %s -> %s',
    async (sourceType, targetType) => {
      const deps = buildUseCase({
        currentWorkerType: sourceType,
        sessionStorage: EWorkerSessionStorage.postgres,
        warmPool: {
          warm_pool_id: 'warm-1',
          container_id: 'container-warm',
          container_name: 'warm-container',
          session_volume_name: null,
        },
      });

      await expect(
        deps.useCase.execute(t, 'account-1', {
          worker_id: 'worker-1',
          name: 'Provider change',
          worker_type: targetType,
        })
      ).resolves.toMatchObject({
        code: 202,
        queued: true,
        reason: 'recreate_queued',
      });

      expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(2);
      expect(deps.workerService.viewWorkerLifecycleServer).toHaveBeenCalledWith(
        'account-1',
        'worker-1'
      );
      expect(deps.workerService.viewWorkerBalancer).not.toHaveBeenCalled();
      expect(
        deps.workerLifecycleQueueService.publish.mock.calls.map(
          ([payload]) => payload.action
        )
      ).toEqual(['cleanup_previous_runtime', 'recreate']);
      const [cleanupMessage, recreateMessage] =
        deps.workerLifecycleQueueService.publish.mock.calls.map(
          ([payload]) => payload
        );
      // Both records are durable before either is published. In every
      // PostgreSQL provider direction cleanup tears down only the old runtime;
      // it must never reset the shared session before the target can hydrate.
      expect(cleanupMessage).toMatchObject({
        action: 'cleanup_previous_runtime',
        server_id: deps.currentServerId,
        worker_type_id: sourceType,
        previous_worker_type_id: sourceType,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
      });
      expect(recreateMessage).toMatchObject({
        action: 'recreate',
        worker_type_id: targetType,
        previous_worker_type_id: sourceType,
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: false,
        remove_volume: false,
        cleanup_previous_runtime_required: true,
      });
      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.recreating,
        }),
        expect.objectContaining({
          whatsapp_provider_handoff: {
            source_provider: providerForWorkerType(sourceType),
            target_provider: providerForWorkerType(targetType),
            lifecycle_operation_id: 'uuid-v7',
          },
        })
      );
      expect(
        (deps.workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock)
          .mock.calls[0]?.[1]
      ).not.toHaveProperty('worker_type_id');
      expect(
        (deps.workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock)
          .mock.calls[0]?.[1]
      ).not.toHaveProperty('number');
      expect(
        (deps.workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock)
          .mock.calls[0]?.[1]
      ).not.toHaveProperty('connection_date');
      expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'recreate',
          worker_type_id: targetType,
          session_storage: EWorkerSessionStorage.postgres,
          cleanup_previous_runtime_required: true,
          remove_session: false,
          remove_volume: false,
        })
      );
      expect(deps.workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
    }
  );

  it.each(unofficialProviderHandoffMatrix)(
    'removes the PostgreSQL session end to end when a fresh provider edit changes %s -> %s',
    async (sourceType, targetType) => {
      const deps = buildUseCase({
        currentWorkerType: sourceType,
        sessionStorage: EWorkerSessionStorage.postgres,
        warmPool: { warm_pool_id: 'warm-fresh-reset' },
      });

      await expect(
        deps.useCase.execute(t, 'account-1', {
          worker_id: 'worker-1',
          name: 'Fresh provider connection',
          worker_type: targetType,
          connection_strategy: EWorkerConnectionStrategy.fresh,
        })
      ).resolves.toMatchObject({
        code: 202,
        queued: true,
        reason: 'recreate_queued',
      });

      expect(
        deps.workerService.updateWorkerByIdIfLifecycleMatches
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_type_id: targetType,
          worker_status_id: EWorkerStatus.recreating,
          number: null,
          connection_date: null,
        }),
        expect.not.objectContaining({
          whatsapp_provider_handoff: expect.anything(),
        })
      );
      expect(
        deps.workerLifecycleQueueService.publish.mock.calls.map(
          ([payload]) => payload
        )
      ).toEqual([
        expect.objectContaining({
          action: 'cleanup_previous_runtime',
          worker_type_id: sourceType,
          previous_worker_type_id: sourceType,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: false,
          remove_volume: false,
        }),
        expect.objectContaining({
          action: 'recreate',
          worker_type_id: targetType,
          previous_worker_type_id: sourceType,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: true,
          remove_volume: false,
          cleanup_previous_runtime_required: true,
        }),
      ]);
      expect(deps.workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
    }
  );
});
