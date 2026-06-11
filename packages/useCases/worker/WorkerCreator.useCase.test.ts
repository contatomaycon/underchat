import 'reflect-metadata';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerCreatorUseCase } from './WorkerCreator.useCase';
import { container } from 'tsyringe';
import { WORKER_RECREATE_COOLDOWN_SECONDS } from '@core/common/functions/workerRecreateCooldown';

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
    lifecyclePublishError?: unknown;
    warmPool?: {
      warm_pool_id: string;
      container_id?: string | null;
      container_name?: string | null;
      session_volume_name?: string | null;
    } | null;
    warmupEnabled?: boolean;
  } = {}
) {
  const callOrder: string[] = [];

  const workerService = {
    listWorkerServers: jest.fn(async () => [{ server_id: 'server-1' }]),
    viewWorkerServer: jest.fn(async () => ({ server_id: 'server-1' })),
    createWorker: jest.fn(async () => {
      callOrder.push('create-worker');
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
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const centrifugoService = {
    publishSub: jest.fn(async () => {
      callOrder.push('publish');
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
      return { enabled: true, speed: 50 };
    }),
    ensureSecurityKeyDefault: jest.fn(async () => {
      callOrder.push('security-key-default');
      return {
        enabled: true,
        chatbot: true,
        schedule: true,
        quick_message: true,
      };
    }),
  };

  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => ({
      warmup_enabled: overrides.warmupEnabled ?? false,
      reservation_ttl_seconds: 90,
    })),
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
      fallback_created: false,
    });

    expect(deps.workerService.createWorker).toHaveBeenCalledWith({
      worker_id: 'worker-created-id',
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: EWorkerType.baileys,
      server_id: 'server-1',
      account_id: 'account-1',
      name: 'Canal principal',
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
      'update-worker',
      'typing-default',
      'security-key-default',
      'publish',
      'lifecycle-publish',
    ]);
    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-created-id',
        lifecycle_operation_id: 'worker-created-id',
      }
    );
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
    expect(deps.workerGrpcClientService.createWorker).not.toHaveBeenCalled();
  });

  it('marks and publishes error when lifecycle enqueue fails', async () => {
    const deps = buildUseCase({
      lifecyclePublishError: new Error('kafka failed'),
    });

    await expect(
      deps.useCase.execute(t, 'account-1', {
        name: 'Canal principal',
        server_id: 'server-1',
        worker_type: EWorkerType.baileys,
      })
    ).rejects.toThrow('kafka failed');

    expect(deps.workerService.updateWorkerById).toHaveBeenCalledWith(
      'account-1',
      {
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      }
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenLastCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-created-id',
        worker_status_id: EWorkerStatus.error,
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
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });
});
