import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerCreatorUseCase } from '@core/useCases/worker/WorkerCreator.useCase';
import { container } from 'tsyringe';
import { WORKER_RECREATE_COOLDOWN_SECONDS } from '@core/common/functions/workerRecreateCooldown';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class PlanAccountService {},
}));

jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'worker-created-id'),
}));

const t = ((key: string) => key) as never;

function buildUseCase(
  overrides: {
    createWorkerError?: unknown;
    lifecyclePublishError?: unknown;
    warmPool?: {
      warm_pool_id: string;
      container_id?: string | null;
      container_name?: string | null;
      session_volume_name?: string | null;
    } | null;
    warmupEnabled?: boolean;
    centrifugoPublishError?: unknown;
    configDefaultsError?: unknown;
    warmSettingsError?: unknown;
    eligibleServers?: Array<{ server_id: string }>;
  } = {}
) {
  const callOrder: string[] = [];

  const workerService = {
    listWorkerServers: jest.fn(
      async () => overrides.eligibleServers ?? [{ server_id: 'server-1' }]
    ),
    viewWorkerServer: jest.fn(async () => ({ server_id: 'server-1' })),
    createWorker: jest.fn(async () => {
      callOrder.push('create-worker');
      if (overrides.createWorkerError) {
        throw overrides.createWorkerError;
      }
      return true;
    }),
    updateWorkerById: jest.fn(
      async (
        _accountId: string,
        input: { worker_status_id?: EWorkerStatus }
      ) => {
        callOrder.push(
          input?.worker_status_id === EWorkerStatus.error
            ? 'mark-error'
            : 'update-worker'
        );
        return true;
      }
    ),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const centrifugoService = {
    publishSub: jest.fn(async () => {
      callOrder.push('publish');
      if (overrides.centrifugoPublishError) {
        throw overrides.centrifugoPublishError;
      }
      return {};
    }),
  };

  const planAccountService = {
    validateCanCreateWorker: jest.fn(async () => undefined),
  };

  const workerGrpcClientService = {
    createWorker: jest.fn(async () => {
      callOrder.push('grpc-create');
      return undefined;
    }),
    activateWarmWorker: jest.fn(async () => {
      return {
        container_id: overrides.warmPool?.container_id ?? 'container-1',
        session_volume_name:
          overrides.warmPool?.session_volume_name ?? 'volume-1',
      };
    }),
    deleteWarmWorker: jest.fn(async () => undefined),
  };

  const workerLifecycleQueueService = {
    prepare: jest.fn(async (_message: unknown) => undefined),
    publish: jest.fn(async () => {
      callOrder.push('lifecycle-publish');
      if (overrides.lifecyclePublishError) {
        throw overrides.lifecyclePublishError;
      }
    }),
  };

  const workerConfigService = {
    ensureTypingSimulationDefault: jest.fn(async () => {
      callOrder.push('typing-default');
      if (overrides.configDefaultsError) {
        throw overrides.configDefaultsError;
      }
      return { enabled: true, speed: 50 };
    }),
    ensureSecurityKeyDefault: jest.fn(async () => {
      callOrder.push('security-key-default');
      if (overrides.configDefaultsError) {
        throw overrides.configDefaultsError;
      }
      return {
        enabled: true,
        chatbot: true,
        schedule: true,
        quick_message: true,
      };
    }),
  };

  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => {
      if (overrides.warmSettingsError) {
        throw overrides.warmSettingsError;
      }
      return {
        warmup_enabled: overrides.warmupEnabled ?? false,
        reservation_ttl_seconds: 90,
      };
    }),
  };
  const workerWarmPoolRepository = {
    releaseExpiredReservations: jest.fn(async () => 0),
    reserveReady: jest.fn(async () => overrides.warmPool ?? null),
  };

  const useCase = new WorkerCreatorUseCase(
    workerService as never,
    accountService as never,
    centrifugoService as never,
    planAccountService as never,
    workerConfigService as never,
    workerWarmPoolSettingsService as never,
    workerLifecycleQueueService as never,
    workerWarmPoolRepository as never
  );

  return {
    accountService,
    callOrder,
    centrifugoService,
    planAccountService,
    useCase,
    workerConfigService,
    workerWarmPoolSettingsService,
    workerWarmPoolRepository,
    workerGrpcClientService,
    workerLifecycleQueueService,
    workerService,
  };
}

describe('WorkerCreatorUseCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects the first eligible server when server_id is omitted', async () => {
    const deps = buildUseCase({
      eligibleServers: [
        { server_id: 'server-least-loaded' },
        { server_id: 'server-next' },
      ],
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal automático',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      server_id: 'server-least-loaded',
    });

    expect(deps.workerService.listWorkerServers).toHaveBeenCalledTimes(1);
    expect(deps.workerService.viewWorkerServer).not.toHaveBeenCalled();
    expect(deps.workerService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ server_id: 'server-least-loaded' })
    );
  });

  it('treats a whitespace-only server_id as omitted', async () => {
    const deps = buildUseCase({
      eligibleServers: [{ server_id: 'server-auto' }],
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal automático',
        server_id: '  \t\n  ',
        worker_type: EWorkerType.wwebjs,
      })
    ).resolves.toMatchObject({
      server_id: 'server-auto',
    });

    expect(deps.workerService.listWorkerServers).toHaveBeenCalledTimes(1);
    expect(deps.workerService.viewWorkerServer).not.toHaveBeenCalled();
    expect(deps.workerService.createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ server_id: 'server-auto' })
    );
  });

  it('rejects an explicit server_id that is not eligible', async () => {
    const deps = buildUseCase({
      eligibleServers: [{ server_id: 'server-eligible' }],
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal inválido',
        server_id: 'server-unavailable',
        worker_type: EWorkerType.whatsmeow,
      })
    ).rejects.toThrow('worker_server_not_disponible');

    expect(deps.workerService.listWorkerServers).toHaveBeenCalledTimes(1);
    expect(deps.workerService.createWorker).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
  });

  it('rejects automatic allocation when there are no eligible servers', async () => {
    const deps = buildUseCase({ eligibleServers: [] });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal sem servidor',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow('worker_server_not_disponible');

    expect(deps.workerService.listWorkerServers).toHaveBeenCalledTimes(1);
    expect(deps.workerService.viewWorkerServer).not.toHaveBeenCalled();
    expect(deps.workerService.createWorker).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
  });

  it('creates active security and typing defaults before dispatching channel creation', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      worker_id: 'worker-created-id',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      queued: true,
      code: 202,
      status: 'queued',
      session_storage: EWorkerSessionStorage.postgres,
      fallback_created: false,
    });

    expect(deps.workerService.createWorker).toHaveBeenCalledWith({
      worker_id: 'worker-created-id',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      server_id: 'server-1',
      account_id: 'account-1',
      name: 'Canal principal',
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: 'worker-created-id',
      recreate_available_at: expect.any(String),
    });
    expect(
      deps.workerConfigService.ensureTypingSimulationDefault
    ).toHaveBeenCalledWith('worker-created-id');
    expect(
      deps.workerConfigService.ensureSecurityKeyDefault
    ).toHaveBeenCalledWith('worker-created-id');
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-created-id',
        account_id: 'account-1',
        worker_status_id: EWorkerStatus.creating,
        operation_id: 'worker-created-id',
      })
    );
    expect(deps.callOrder).toEqual([
      'create-worker',
      'typing-default',
      'security-key-default',
      'lifecycle-publish',
      'publish',
    ]);
    expect(deps.workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('sets the initial recreate cooldown to two minutes after creation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-11T12:00:00.000Z'));

    try {
      const deps = buildUseCase();

      await expect(
        deps.useCase.execute(t, 'account-1', {
          name: 'Canal principal',
          server_id: 'server-1',
          worker_type: EWorkerType.baileys,
        })
      ).resolves.toMatchObject({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
      });

      expect(deps.workerService.createWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        })
      );
      expect(WORKER_RECREATE_COOLDOWN_SECONDS).toBe(120);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns after publishing creating status and enqueueing lifecycle', async () => {
    const deps = buildUseCase();

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      worker_id: 'worker-created-id',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      queued: true,
      fallback_created: false,
    });

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.creating,
      })
    );
    expect(deps.callOrder).toContain('lifecycle-publish');
    expect(
      deps.workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.centrifugoService.publishSub.mock.invocationCallOrder[0]
    );
    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
  });

  it('publishes the same create operation after an ambiguous database insert', async () => {
    const claimError = new Error('database response lost');
    const deps = buildUseCase({ createWorkerError: claimError });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toBe(claimError);

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        worker_id: 'worker-created-id',
        operation_id: 'worker-created-id',
      })
    );
  });

  it('returns queued when status notification fails after Kafka publish', async () => {
    const deps = buildUseCase({
      centrifugoPublishError: new Error('centrifugo unavailable'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      queued: true,
      operation_id: 'worker-created-id',
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledTimes(1);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('preserves the creating claim when lifecycle enqueue fails', async () => {
    const deps = buildUseCase({
      lifecyclePublishError: new Error('kafka failed'),
      centrifugoPublishError: new Error('centrifugo unavailable'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow('kafka failed');

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        operation_id: 'worker-created-id',
      })
    );
  });

  it('keeps config-default failure recoverable when Kafka is also unavailable', async () => {
    const deps = buildUseCase({
      lifecyclePublishError: new Error('kafka failed'),
      configDefaultsError: new Error('config unavailable'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow(
      'Worker create preparation failure could not be durably resolved'
    );

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('publishes the prepared create recovery when config defaults fail', async () => {
    const deps = buildUseCase({
      configDefaultsError: new Error('config unavailable'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow('config unavailable');

    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        worker_status_id: EWorkerStatus.creating,
        operation_id: 'worker-created-id',
      })
    );
  });

  it('falls back to cold lifecycle when warm-pool settings are unavailable', async () => {
    const deps = buildUseCase({
      warmSettingsError: new Error('warm settings unavailable'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      queued: true,
      warm_pool_claimed: false,
      fallback_created: false,
    });

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        warm_pool_id: undefined,
      })
    );
    expect(
      deps.workerLifecycleQueueService.prepare.mock.calls.at(-1)?.[0]
    ).toEqual(
      expect.objectContaining({
        action: 'create',
        warm_pool_id: undefined,
        operation_id: 'worker-created-id',
      })
    );
  });

  it('reserves warm worker and enqueues activation without calling gRPC', async () => {
    const resolveSpy = jest.spyOn(container, 'resolve');
    const deps = buildUseCase({
      warmPool: {
        warm_pool_id: 'warm-1',
        container_id: 'container-1',
        container_name: 'warm-container-1',
        session_volume_name: 'volume-1',
      },
      warmupEnabled: false,
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).resolves.toMatchObject({
      worker_id: 'worker-created-id',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      queued: true,
      warm_pool_claimed: true,
      warm_pool_id: 'warm-1',
    });

    expect(deps.workerWarmPoolRepository.reserveReady).toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.activateWarmWorker
    ).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.deleteWarmWorker
    ).not.toHaveBeenCalled();
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
      })
    );
    expect(
      deps.workerLifecycleQueueService.prepare.mock.calls.at(-1)?.[0]
    ).toEqual(
      expect.objectContaining({
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
        operation_id: 'worker-created-id',
      })
    );
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });
});
