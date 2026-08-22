import 'reflect-metadata';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class WorkerLifecycleQueueService {},
}));

import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';

const t = ((key: string) => key) as never;

const makeWorkerSnapshot = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  worker_id: 'worker-1',
  name: 'Worker',
  account_id: 'account-1',
  server_id: 'server-1',
  worker_status_id: EWorkerStatus.online,
  worker_type_id: EWorkerType.baileys,
  session_storage: EWorkerSessionStorage.legacy_volume,
  lifecycle_operation_id: null,
  deleted_at: null,
  created_at: null,
  updated_at: null,
  container_id: null,
  last_connection_check_at: null,
  ...overrides,
});

function makeSut() {
  const workerService = {
    viewWorkerBalancer: jest.fn(async () => null),
    viewWorker: jest.fn(async () => ({
      status: { id: EWorkerStatus.online },
      type: { id: EWorkerType.baileys },
      recreate_available_at: '2026-06-11T12:01:00.000Z',
    })),
    viewWorkerForMonitorConsistent: jest.fn<
      Promise<Record<string, unknown> | null>,
      [string]
    >(async () => makeWorkerSnapshot()),
    updateWorkerById: jest.fn(async () => true),
    updateWorkerByIdIfRecreateAvailable: jest.fn(async () => true),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
  };
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
  };
  const workerGrpcClientService = {
    recreateWorker: jest.fn(async () => undefined),
  };
  const workerLifecycleQueueService = {
    prepare: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    redrivePrepared: jest.fn(
      async (): Promise<Record<string, unknown>[]> => []
    ),
  };
  const workerLifecycleLockService = {
    isLocked: jest.fn(async () => false),
    tryClaimRedrive: jest.fn(async () => true),
    releaseRedriveClaim: jest.fn(async () => undefined),
    withLock: jest.fn(async (_workerId, _operation, callback) =>
      callback({
        assertActive: jest.fn(),
        isActive: jest.fn(() => true),
        signal: new AbortController().signal,
      })
    ),
  };

  const sut = new WorkerRecreatorUseCase(
    workerService as never,
    accountService as never,
    centrifugoService as never,
    workerLifecycleQueueService as never,
    { log: jest.fn(async () => undefined) } as never,
    workerLifecycleLockService as never
  );

  return {
    sut,
    workerService,
    centrifugoService,
    workerGrpcClientService,
    workerLifecycleQueueService,
    workerLifecycleLockService,
  };
}

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('WorkerRecreatorUseCase', () => {
  it('returns ack after enqueueing lifecycle and schedules recreating status', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_status_id: EWorkerStatus.recreating,
      operation_id: 'operation-1',
    });

    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      channelsConfigCentrifugo(),
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        operation_id: 'operation-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({
        remove_session: true,
        remove_volume: true,
        previous_session_storage: expect.anything(),
      })
    );
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(centrifugoService.publishSub.mock.invocationCallOrder[0]);
    expect(workerService.viewWorkerBalancer).not.toHaveBeenCalled();
  });

  it('does not wait for a slow recreating status publish before returning ack', async () => {
    const { sut, centrifugoService, workerLifecycleQueueService } = makeSut();
    let resolvePublish!: () => void;
    centrifugoService.publishSub.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolvePublish = () => resolve(undefined);
        })
    );

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalled();
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
      })
    );

    resolvePublish();
    await flushPromises();
  });

  it('publishes logout before recreating when session cleanup is requested', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();

    await sut.execute(t, 'account-1', 'worker-1', {
      remove_session: true,
      remove_volume: true,
    });

    expect(centrifugoService.publishSub).toHaveBeenNthCalledWith(
      1,
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_id: 'worker-1',
        account_id: 'account-1',
        disconnected_user: true,
      })
    );
    expect(centrifugoService.publishSub).toHaveBeenNthCalledWith(
      2,
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        remove_session: true,
        remove_volume: true,
      })
    );
    expect(
      workerService.updateWorkerByIdIfRecreateAvailable
    ).not.toHaveBeenCalled();
  });

  it('resets a Postgres session without requesting removal of a volume', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      makeWorkerSnapshot({
        session_storage: EWorkerSessionStorage.postgres,
      })
    );

    await sut.execute(t, 'account-1', 'worker-1', {
      remove_session: true,
      remove_volume: true,
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
      })
    );
    expect(centrifugoService.publishSub).toHaveBeenNthCalledWith(
      2,
      workerCentrifugoQueue('account-1'),
      expect.objectContaining({
        session_storage: EWorkerSessionStorage.postgres,
        remove_session: true,
        remove_volume: false,
      })
    );
  });

  it('starts a fresh legacy connection on PostgreSQL after a mandatory volume cleanup', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        fresh_connection: true,
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'reset_queued',
      operation_id: 'operation-1',
    });

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        session_storage: EWorkerSessionStorage.postgres,
        number: null,
        connection_date: null,
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        source: 'reset_connection',
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
        cleanup_previous_runtime_required: true,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        source: 'reset_connection',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'recreate',
        source: 'reset_connection',
      })
    );
  });

  it('supersedes an in-flight lifecycle immediately only for an explicit fresh connection', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.creating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);
    workerLifecycleLockService.isLocked.mockResolvedValue(true);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        fresh_connection: true,
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'reset_queued',
      operation_id: 'operation-1',
    });

    expect(workerLifecycleLockService.isLocked).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        session_storage: EWorkerSessionStorage.postgres,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-existing',
        worker_status_id: EWorkerStatus.creating,
      })
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-1',
        source: 'reset_connection',
      })
    );
  });

  it('updates worker with recreate cooldown guard when requested', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-11T12:00:00.000Z'));

    try {
      const { sut, workerService } = makeSut();

      await expect(
        sut.execute(t, 'account-1', 'worker-1', {
          enforce_recreate_cooldown: true,
        })
      ).resolves.toMatchObject({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
      });

      expect(
        workerService.updateWorkerByIdIfRecreateAvailable
      ).toHaveBeenCalledWith(
        'account-1',
        expect.objectContaining({
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.recreating,
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        }),
        '2026-06-11T12:00:00.000Z',
        {
          lifecycle_operation_id: null,
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
        }
      );
      expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('blocks recreate when cooldown guard does not update the worker', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerService.updateWorkerByIdIfRecreateAvailable.mockResolvedValue(false);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      })
    ).rejects.toBeInstanceOf(WorkerRecreateCooldownError);

    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('does not enqueue when the lifecycle marker was not persisted', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();
    workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('rejects an invalid primary snapshot before marking or enqueueing', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();
    workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      makeWorkerSnapshot({ deleted_at: '2026-07-17T00:00:00.000Z' })
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('does not report cooldown or enqueue when a concurrent migration wins the guarded update', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();
    workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(makeWorkerSnapshot())
      .mockResolvedValueOnce(
        makeWorkerSnapshot({
          server_id: 'server-2',
          lifecycle_operation_id: 'migration-operation',
        })
      );
    workerService.updateWorkerByIdIfRecreateAvailable.mockResolvedValueOnce(
      false
    );

    let thrown: unknown;
    try {
      await sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('worker_not_found');
    expect(thrown).not.toBeInstanceOf(WorkerRecreateCooldownError);
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('acknowledges the same operation without redrive while its lifecycle lock is active', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);
    workerLifecycleLockService.isLocked.mockResolvedValue(true);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfRecreateAvailable
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('redrives the same durable operation instead of creating a competing lifecycle', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);
    workerLifecycleQueueService.redrivePrepared.mockResolvedValueOnce([
      {
        worker_id: 'worker-1',
        operation_id: 'operation-existing',
        action: 'recreate',
      },
    ]);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
        debug_trace_id: 'trace-worker-existing-operation',
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_resumed',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.tryClaimRedrive).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing',
      30_000
    );
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing',
      'trace-worker-existing-operation'
    );
    expect(
      workerLifecycleLockService.releaseRedriveClaim
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('keeps a recent journal-less lifecycle fenced', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing',
      undefined
    );
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfRecreateAvailable
    ).not.toHaveBeenCalled();
  });

  it('atomically supersedes a stale unlocked journal-less lifecycle', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const updatedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: updatedAt,
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);

    await expect(
      sut.execute(t, 'account-1', 'worker-1', {
        enforce_recreate_cooldown: true,
      })
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'operation-1',
    });

    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        operation_id: 'operation-1',
        action: 'recreate',
      })
    );
    expect(workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'worker_recreate_supersede',
      expect.any(Function),
      {
        acquireTimeoutMs: 1_000,
        retryDelayMs: 100,
      }
    );
    expect(
      workerService.updateWorkerByIdIfRecreateAvailable
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      }),
      expect.any(String),
      {
        lifecycle_operation_id: 'operation-existing',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        updated_at: updatedAt,
      }
    );
    expect(
      workerLifecycleQueueService.prepare.mock.invocationCallOrder[0]
    ).toBeLessThan(
      workerService.updateWorkerByIdIfRecreateAvailable.mock
        .invocationCallOrder[0]
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-1',
        action: 'recreate',
      })
    );
  });

  it('atomically supersedes an unlocked terminal online lifecycle without redriving it', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const updatedAt = new Date().toISOString();
    const terminalOnline = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-existing',
      updated_at: updatedAt,
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      terminalOnline
    );
    workerLifecycleQueueService.redrivePrepared.mockResolvedValueOnce([
      {
        worker_id: 'worker-1',
        operation_id: 'operation-existing',
        action: 'recreate',
      },
    ]);

    await expect(
      sut.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'operation-1',
    });

    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(
      workerLifecycleLockService.releaseRedriveClaim
    ).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'worker_recreate_supersede',
      expect.any(Function),
      {
        acquireTimeoutMs: 1_000,
        retryDelayMs: 100,
      }
    );
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      }),
      {
        lifecycle_operation_id: 'operation-existing',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        updated_at: updatedAt,
      }
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('does not supersede a terminal online lifecycle while its lock is active', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const terminalOnline = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(
      terminalOnline
    );
    workerLifecycleLockService.isLocked.mockResolvedValueOnce(true);

    await expect(
      sut.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not replace a terminal online lifecycle when its final snapshot fence changes', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const terminalOnline = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-existing',
      updated_at: '2026-07-31T01:24:49.096Z',
    });
    const concurrentLifecycle = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-concurrent',
      updated_at: '2026-08-03T12:00:00.000Z',
    });
    workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(terminalOnline)
      .mockResolvedValueOnce(terminalOnline)
      .mockResolvedValueOnce(concurrentLifecycle);

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(workerLifecycleLockService.withLock).toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not enqueue the replacement when the stale lifecycle CAS loses', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();
    const updatedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const pending = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: updatedAt,
    });
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(pending);
    workerService.updateWorkerByIdIfLifecycleMatches.mockResolvedValueOnce(
      false
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({ lifecycle_operation_id: 'operation-1' }),
      {
        lifecycle_operation_id: 'operation-existing',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        updated_at: updatedAt,
      }
    );
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('releases the redrive claim and performs no side effect when the lifecycle fence changes', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    const existing = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const newer = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-newer',
      updated_at: new Date().toISOString(),
    });
    workerService.viewWorkerForMonitorConsistent
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(newer);

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(workerLifecycleLockService.releaseRedriveClaim).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing',
      undefined
    );
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
  });

  it('does not recover a pre-existing lifecycle outside recreating status', async () => {
    const {
      sut,
      workerService,
      workerLifecycleQueueService,
      workerLifecycleLockService,
    } = makeSut();
    workerService.viewWorkerForMonitorConsistent.mockResolvedValueOnce(
      makeWorkerSnapshot({
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: 'previous-operation',
      })
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.isLocked).not.toHaveBeenCalled();
  });

  it('blocks official WhatsApp worker recreate', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerService.viewWorkerForMonitorConsistent.mockResolvedValue(null);
    workerService.viewWorker.mockResolvedValue({
      status: { id: EWorkerStatus.online },
      type: { id: EWorkerType.whatsapp },
      recreate_available_at: '2026-06-11T12:01:00.000Z',
    });

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_runtime_action_not_supported'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('preserves the recreate fence after lifecycle enqueue failure', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerLifecycleQueueService.publish.mockRejectedValue(
      new Error('kafka unavailable')
    );
    centrifugoService.publishSub.mockRejectedValueOnce(
      new Error('centrifugo unavailable')
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'kafka unavailable'
    );

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('never clears the recreate operation after a prepared publish fails', async () => {
    const {
      sut,
      workerService,
      centrifugoService,
      workerLifecycleQueueService,
    } = makeSut();
    workerLifecycleQueueService.publish.mockRejectedValue(
      new Error('kafka unavailable')
    );
    workerService.updateWorkerByIdIfLifecycleMatches
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'kafka unavailable'
    );

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
    expect(centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('publishes the same lifecycle operation after an ambiguous database claim', async () => {
    const { sut, workerService, workerLifecycleQueueService } = makeSut();
    const claimError = new Error('database response lost');
    workerService.updateWorkerByIdIfLifecycleMatches.mockRejectedValueOnce(
      claimError
    );

    await expect(sut.execute(t, 'account-1', 'worker-1')).rejects.toBe(
      claimError
    );

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        operation_id: 'operation-1',
      })
    );
  });
});
