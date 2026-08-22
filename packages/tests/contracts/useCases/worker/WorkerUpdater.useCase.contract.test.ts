import 'reflect-metadata';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/useCases/worker/WorkerRecreator.useCase', () => ({
  WorkerRecreatorUseCase: class WorkerRecreatorUseCase {},
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

const t = ((key: string) => key) as never;

const makeWorkerSnapshot = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  worker_id: 'worker-1',
  name: 'Worker 1',
  account_id: 'account-1',
  server_id: 'server-1',
  worker_status_id: EWorkerStatus.disponible,
  worker_type_id: EWorkerType.baileys,
  lifecycle_operation_id: null,
  deleted_at: null,
  created_at: null,
  updated_at: null,
  container_id: null,
  last_connection_check_at: null,
  ...overrides,
});

function makeServerMoveSut(options: {
  claim: () => Promise<boolean>;
  publish: (message: unknown) => Promise<void>;
}) {
  const workerService = {
    viewWorkerForMonitorConsistent: jest.fn(async () =>
      makeWorkerSnapshot({
        server_id: 'server-old',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
      })
    ),
    viewWorkerLifecycleServer: jest.fn(async () => ({
      server_id: 'server-old',
      account_id: 'account-1',
      server_status_id: EServerStatus.online,
    })),
    listWorkerServers: jest.fn(async () => [{ server_id: 'server-new' }]),
    updateWorkerByIdIfLifecycleMatches: jest.fn(options.claim),
  };
  const workerLifecycleQueueService = {
    prepare: jest.fn(async () => undefined),
    publish: jest.fn(options.publish),
  };
  const useCase = new WorkerUpdaterUseCase(
    workerService as never,
    { existsAccountById: jest.fn(async () => true) } as never,
    { refreshTypingSimulationCache: jest.fn(async () => undefined) } as never,
    {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
        warmup_enabled: false,
      })),
    } as never,
    {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => null),
    } as never,
    workerLifecycleQueueService as never,
    { publishReplenish: jest.fn(async () => undefined) } as never,
    {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    } as never
  );

  return { useCase, workerService, workerLifecycleQueueService };
}

describe('WorkerUpdaterUseCase lifecycle fencing', () => {
  it('enqueues type-change lifecycle before best-effort status notification', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({
          session_storage: EWorkerSessionStorage.postgres,
        })
      ),
      viewWorkerLifecycleServer: jest.fn(async () => ({
        server_id: 'server-1',
        account_id: 'account-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.disponible },
      })),
      listWorkerServers: jest.fn(async () => []),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerGrpcClientService = {
      cleanupWorker: jest.fn(async () => undefined),
      changeConnectionStatus: jest.fn(async () => undefined),
    };
    const workerRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => {
        throw new Error('warm settings unavailable');
      }),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => null),
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => null),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn<Promise<void>, [IWorkerLifecycleQueueMessage]>(
        async () => undefined
      ),
    };
    const workerWarmPoolQueueService = {
      publishReplenish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
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

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
        whatsapp_provider_handoff: {
          source_provider: 'baileys',
          target_provider: 'wwebjs',
          lifecycle_operation_id: 'operation-1',
        },
      }
    );
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('worker_type_id');
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('number');
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('connection_date');
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(2);
    expect(
      workerLifecycleQueueService.publish.mock.calls.map(
        ([payload]) => payload.action
      )
    ).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        remove_session: false,
        remove_volume: false,
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.disponible,
      })
    );
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(centrifugoService.publishSub.mock.invocationCallOrder[0]);
    expect(workerWarmPoolSettingsService.view).not.toHaveBeenCalled();
    expect(workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
  });

  it('uses one lifecycle operation id for old-server cleanup and new-server recreate', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({
          server_id: 'server-old',
          worker_status_id: EWorkerStatus.online,
          worker_type_id: EWorkerType.wwebjs,
          session_storage: EWorkerSessionStorage.postgres,
        })
      ),
      viewWorkerLifecycleServer: jest.fn(async () => ({
        server_id: 'server-old',
        account_id: 'account-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      listWorkerServers: jest.fn(async () => [{ server_id: 'server-new' }]),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerGrpcClientService = {
      cleanupWorker: jest.fn(async () => undefined),
      changeConnectionStatus: jest.fn(async () => undefined),
    };
    const workerRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
      })),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => null),
    };
    const workerRuntimeRepository = {
      viewByWorkerId: jest.fn(async () => null),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
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

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.whatsmeow,
        server_id: 'server-new',
      } as never)
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        server_id: 'server-new',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-old',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.online,
        whatsapp_provider_handoff: {
          source_provider: 'wwebjs',
          target_provider: 'whatsmeow',
          lifecycle_operation_id: 'operation-1',
        },
      }
    );
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('worker_type_id');
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('number');
    expect(
      (workerService.updateWorkerByIdIfLifecycleMatches as jest.Mock).mock
        .calls[0]?.[1]
    ).not.toHaveProperty('connection_date');
    expect(workerGrpcClientService.cleanupWorker).not.toHaveBeenCalled();
    expect(workerRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_id: 'worker-1',
        server_id: 'server-old',
        account_id: 'account-1',
        operation_id: 'operation-1',
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        server_id: 'server-new',
        account_id: 'account-1',
        remove_session: false,
        remove_volume: false,
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('converts a legacy-volume type change into a destructive PostgreSQL recreate', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      viewWorkerLifecycleServer: jest.fn(async () => ({
        server_id: 'server-1',
        account_id: 'account-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.disponible },
      })),
      listWorkerServers: jest.fn(async () => []),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        reservation_ttl_seconds: 90,
        warmup_enabled: true,
      })),
    };
    const workerWarmPoolRepository = {
      releaseExpiredReservations: jest.fn(async () => 0),
      reserveReady: jest.fn(async () => ({
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        container_id: 'warm-container',
        container_name: 'warm-warm-1',
        session_volume_name: 'warm-warm-1',
      })),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn<Promise<void>, [IWorkerLifecycleQueueMessage]>(
        async () => undefined
      ),
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

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.recreating,
    });

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
        number: null,
        connection_date: null,
        worker_status_id: EWorkerStatus.recreating,
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.disponible,
      }
    );
    expect(
      workerWarmPoolRepository.releaseExpiredReservations
    ).not.toHaveBeenCalled();
    expect(workerWarmPoolRepository.reserveReady).not.toHaveBeenCalled();
    // The two messages are journaled before claiming the worker and prepared
    // again by the idempotent publish boundary after the claim succeeds.
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledTimes(4);
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      })
    );
  });

  it('preserves the durable recreate claim when Kafka remains unavailable', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({
          worker_status_id: EWorkerStatus.online,
          session_storage: EWorkerSessionStorage.postgres,
        })
      ),
      viewWorkerLifecycleServer: jest.fn(async () => ({
        server_id: 'server-1',
        account_id: 'account-1',
        server_status_id: EServerStatus.online,
      })),
      viewWorker: jest.fn(async () => ({
        status: { id: EWorkerStatus.online },
      })),
      listWorkerServers: jest.fn(async () => []),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => {
        throw new Error('kafka unavailable');
      }),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      {
        existsAccountById: jest.fn(async () => true),
      } as never,
      {
        refreshTypingSimulationCache: jest.fn(async () => undefined),
      } as never,
      {
        view: jest.fn(async () => ({
          reservation_ttl_seconds: 90,
          warmup_enabled: false,
        })),
      } as never,
      {
        releaseExpiredReservations: jest.fn(async () => 0),
        reserveReady: jest.fn(async () => null),
      } as never,
      workerLifecycleQueueService as never,
      {
        publishReplenish: jest.fn(async () => undefined),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).rejects.toThrow('kafka unavailable');

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ lifecycle_operation_id: null }),
      expect.any(Object)
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('publishes the same lifecycle operation after an ambiguous database claim', async () => {
    const claimError = new Error('database response lost');
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({
          session_storage: EWorkerSessionStorage.postgres,
        })
      ),
      viewWorkerLifecycleServer: jest.fn(async () => ({
        server_id: 'server-1',
        account_id: 'account-1',
        server_status_id: EServerStatus.online,
      })),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
        throw claimError;
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn<Promise<void>, [IWorkerLifecycleQueueMessage]>(
        async () => undefined
      ),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {} as never,
      {} as never,
      {} as never,
      workerLifecycleQueueService as never,
      {} as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.wwebjs,
      } as never)
    ).rejects.toBe(claimError);

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(2);
    expect(
      workerLifecycleQueueService.publish.mock.calls.map(
        ([payload]) => payload.action
      )
    ).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        operation_id: 'operation-1',
        worker_type_id: EWorkerType.wwebjs,
      })
    );
  });

  it('recovers an ambiguous server-move claim in cleanup-then-recreate order', async () => {
    const claimError = new Error('database response lost');
    const { useCase, workerLifecycleQueueService } = makeServerMoveSut({
      claim: async () => {
        throw claimError;
      },
      publish: async () => undefined,
    });

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.whatsmeow,
        server_id: 'server-new',
      } as never)
    ).rejects.toBe(claimError);

    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        server_id: 'server-old',
        operation_id: 'operation-1',
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        server_id: 'server-new',
        operation_id: 'operation-1',
      })
    );
  });

  it('preserves a server-move claim when cleanup cannot reach Kafka', async () => {
    const { useCase, workerService, workerLifecycleQueueService } =
      makeServerMoveSut({
        claim: async () => true,
        publish: async () => {
          throw new Error('kafka unavailable');
        },
      });

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Worker 1',
        worker_type: EWorkerType.whatsmeow,
        server_id: 'server-new',
      } as never)
    ).rejects.toThrow('kafka unavailable');

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    for (const [message] of workerLifecycleQueueService.publish.mock.calls) {
      expect(message).toEqual(
        expect.objectContaining({
          action: 'cleanup_previous_runtime',
          server_id: 'server-old',
          operation_id: 'operation-1',
        })
      );
    }
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ lifecycle_operation_id: null }),
      expect.any(Object)
    );
  });

  it('does not allow official WhatsApp to change to an unofficial type', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({ worker_type_id: EWorkerType.whatsapp })
      ),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      {} as never,
      {} as never,
      workerLifecycleQueueService as never,
      {} as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Official',
        worker_type: EWorkerType.baileys,
      } as never)
    ).rejects.toThrow('whatsapp_official_type_change_not_allowed');

    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('does not allow unofficial channels to become official through generic update', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      {} as never,
      {} as never,
      workerLifecycleQueueService as never,
      {} as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Unofficial',
        worker_type: EWorkerType.whatsapp,
      } as never)
    ).rejects.toThrow('whatsapp_official_connect_required');

    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('updates official WhatsApp name without lifecycle queue', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () =>
        makeWorkerSnapshot({ worker_type_id: EWorkerType.whatsapp })
      ),
      updateWorkerById: jest.fn(async () => true),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const workerConfigService = {
      refreshTypingSimulationCache: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new WorkerUpdaterUseCase(
      workerService as never,
      accountService as never,
      workerConfigService as never,
      {} as never,
      {} as never,
      workerLifecycleQueueService as never,
      {} as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', {
        worker_id: 'worker-1',
        name: 'Official Renamed',
        worker_type: EWorkerType.whatsapp,
      } as never)
    ).resolves.toBe(true);

    expect(workerService.updateWorkerById).toHaveBeenCalledWith('account-1', {
      worker_id: 'worker-1',
      name: 'Official Renamed',
    });
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });
});
