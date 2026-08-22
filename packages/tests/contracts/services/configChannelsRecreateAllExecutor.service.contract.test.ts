import 'reflect-metadata';

import type { ClaimedConfigChannelsRecreateTarget } from '@core/repositories/config/ConfigChannelsRecreateBatch.repository';
import { ConfigChannelsRecreateAllExecutorService } from '@core/services/configChannelsRecreateAllExecutor.service';
import { PermanentChannelRecreateError } from '@core/useCases/config/ChannelRecreator.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerLifecycleJournalError } from '@core/services/workerLifecycleQueue.service';

jest.mock('@core/common/functions/createI18nInstance', () => ({
  createI18nInstance: jest.fn(async () => (key: string) => key),
}));

const lifecycleMessage = {
  request_id: 'request-1',
  operation_id: 'operation-1',
  action: 'recreate' as const,
  worker_id: 'worker-1',
  account_id: 'worker-account-1',
  server_id: 'server-1',
  worker_type_id: EWorkerType.whatsmeow,
  worker_status_id: EWorkerStatus.recreating,
  source: 'config_recreate' as const,
  requested_at: '2026-07-30T23:00:00.000-03:00',
};

const target = (
  overrides: Partial<ClaimedConfigChannelsRecreateTarget> = {}
): ClaimedConfigChannelsRecreateTarget => ({
  targetId: 'target-1',
  batchId: 'batch-1',
  accountId: 'account-1',
  workerId: 'worker-1',
  workerAccountId: 'worker-account-1',
  serverId: 'server-1',
  workerTypeId: 'worker-type-1',
  lifecycleOperationId: 'operation-1',
  lifecycleJournal: null,
  status: 'processing',
  attemptCount: 1,
  slotKey: null,
  slotToken: null,
  slotIndex: null,
  ...overrides,
});

async function waitUntil(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

function makeExecutor(input?: {
  claimedTargets?: ClaimedConfigChannelsRecreateTarget[];
  execute?: jest.Mock;
  completedBatch?: {
    batchId: string;
    accountId: string;
    success: number;
    errors: number;
  } | null;
  completeTargetResults?: Array<
    'succeeded' | 'failed' | 'in_progress' | 'retry_scheduled' | 'lease_lost'
  >;
  preparedResults?: unknown[][];
  redriveResults?: unknown[][];
  publish?: jest.Mock;
}) {
  const claimedTargets = [...(input?.claimedTargets ?? [])];
  const batchRepository = {
    claimNextTarget: jest.fn(async () => claimedTargets.shift() ?? null),
    renewTargetLease: jest.fn(async () => true),
    storeTargetSlot: jest.fn(async () => true),
    markTargetSlotReleased: jest.fn(async () => true),
    markTargetEnqueued: jest.fn(async () => true),
    completeTarget: jest.fn(
      async () =>
        input?.completeTargetResults?.shift() ??
        (input?.completeTargetResults ? 'in_progress' : 'succeeded')
    ),
    failOrRetryTarget: jest.fn(async () => 'retry_scheduled'),
    claimCompletedBatch: jest
      .fn()
      .mockResolvedValueOnce(input?.completedBatch ?? null)
      .mockResolvedValue(null),
    markCompletionPublished: jest.fn(async () => true),
    releaseCompletionClaim: jest.fn(async () => undefined),
  };
  const channelRecreatorUseCase = {
    execute:
      input?.execute ??
      jest.fn(async (_t, _workerId, _trace, options) => {
        await options.onLifecycleClaimed('operation-1', [lifecycleMessage]);
        options.onLifecycleEnqueued();
        return { queued: true, operation_id: 'operation-1' };
      }),
  };
  const lease = {
    key: 'worker:recreate:server:server-1:slot:0',
    token: 'worker-1:operation-1',
    serverId: 'server-1',
    slot: 0,
    reserved: false,
  };
  const slotService = {
    getSlotCount: jest.fn(() => 2),
    getReservationTtlMs: jest.fn(() => 120_000),
    buildToken: jest.fn(() => lease.token),
    acquire: jest.fn(async () => lease),
    waitForRelease: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };
  const lifecycleQueueService = {
    loadPrepared: jest.fn(
      async () => input?.preparedResults?.shift() ?? [lifecycleMessage]
    ),
    redrivePrepared: jest.fn(
      async () =>
        input?.redriveResults?.shift() ?? [{ operation_id: 'operation-1' }]
    ),
    prepare: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publish: input?.publish ?? jest.fn(async () => undefined),
  };
  const executor = new ConfigChannelsRecreateAllExecutorService(
    batchRepository as never,
    channelRecreatorUseCase as never,
    slotService as never,
    lifecycleQueueService as never,
    centrifugoService as never
  );

  return {
    executor,
    batchRepository,
    channelRecreatorUseCase,
    slotService,
    lifecycleQueueService,
    centrifugoService,
  };
}

describe('ConfigChannelsRecreateAllExecutorService', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('journals the lifecycle claim before waiting for the transferred server slot', async () => {
    const deps = makeExecutor({ claimedTargets: [target()] });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.storeTargetSlot).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      {
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:operation-1',
        index: 0,
      }
    );
    expect(deps.batchRepository.markTargetEnqueued).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'operation-1',
      [lifecycleMessage]
    );
    expect(deps.slotService.release).not.toHaveBeenCalled();
    expect(deps.slotService.waitForRelease).toHaveBeenCalledTimes(1);
    expect(deps.batchRepository.markTargetSlotReleased).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      expect.objectContaining({
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:operation-1',
      })
    );
    expect(
      deps.batchRepository.markTargetSlotReleased.mock.invocationCallOrder[0]
    ).toBeLessThan(
      deps.batchRepository.completeTarget.mock.invocationCallOrder[0]
    );
    expect(deps.batchRepository.claimNextTarget).toHaveBeenCalledWith(
      expect.any(String),
      90_000,
      2
    );
  });

  it('can saturate two recreate slots across eleven servers from one healthy executor', async () => {
    let releaseExecutions: (() => void) | undefined;
    const executionBarrier = new Promise<void>((resolve) => {
      releaseExecutions = resolve;
    });
    const execute = jest.fn(async (_t, _workerId, _trace, options) => {
      await executionBarrier;
      await options.onLifecycleClaimed('operation-1', [lifecycleMessage]);
      options.onLifecycleEnqueued();
      return { queued: true, operation_id: 'operation-1' };
    });
    const claimedTargets = Array.from({ length: 22 }, (_, index) =>
      target({
        targetId: `target-${index + 1}`,
        workerId: `worker-${index + 1}`,
        serverId: `server-${Math.floor(index / 2) + 1}`,
        lifecycleOperationId: `operation-${index + 1}`,
      })
    );
    const deps = makeExecutor({ claimedTargets, execute });
    deps.executor.start();

    await waitUntil(() => {
      expect(execute).toHaveBeenCalledTimes(22);
    });
    releaseExecutions?.();
    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(22);
    });
    await deps.executor.close();

    expect(deps.batchRepository.claimNextTarget).toHaveBeenCalledWith(
      expect.any(String),
      90_000,
      2
    );
  });

  it('recovers an enqueued target without issuing another destructive recreate', async () => {
    const deps = makeExecutor({
      claimedTargets: [
        target({
          status: 'enqueued',
          slotKey: 'worker:recreate:server:server-1:slot:0',
          slotToken: 'worker-1:operation-1',
          slotIndex: 0,
        }),
      ],
      completeTargetResults: ['in_progress', 'succeeded'],
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(2);
    });
    await deps.executor.close();

    expect(deps.channelRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(deps.slotService.acquire).not.toHaveBeenCalled();
    expect(deps.lifecycleQueueService.loadPrepared).toHaveBeenCalledWith(
      'worker-1',
      'operation-1'
    );
    expect(deps.lifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(deps.slotService.waitForRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:operation-1',
      }),
      expect.objectContaining({ assertActive: expect.any(Function) })
    );
    expect(deps.batchRepository.markTargetSlotReleased).toHaveBeenCalledTimes(
      1
    );
  });

  it('preserves an enqueued journal when publication fails after the worker CAS', async () => {
    const execute = jest.fn(async (_t, _workerId, _trace, options) => {
      await options.onLifecycleClaimed('operation-1');
      throw new Error('kafka unavailable after lifecycle claim');
    });
    const deps = makeExecutor({
      claimedTargets: [target()],
      execute,
      completeTargetResults: ['in_progress'],
    });
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce(
      'enqueued_retry_scheduled'
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.markTargetEnqueued).toHaveBeenCalledTimes(1);
    expect(deps.slotService.release).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'kafka unavailable after lifecycle claim',
      false,
      5_000
    );
  });

  it('does not accept Redis slot release as proof that the runtime recovered', async () => {
    const deps = makeExecutor({
      claimedTargets: [target()],
      completeTargetResults: ['in_progress'],
    });
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce(
      'enqueued_retry_scheduled'
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.slotService.waitForRelease).toHaveBeenCalledTimes(1);
    expect(deps.batchRepository.markTargetSlotReleased).toHaveBeenCalledTimes(
      1
    );
    expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(2);
    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'config_channels_recreate_target_not_recovered:target-1',
      false,
      5_000
    );
  });

  it('keeps transient failures retryable without an attempt ceiling', async () => {
    const transient = new Error('temporary balancer outage');
    const deps = makeExecutor({
      claimedTargets: [target({ attemptCount: 999 })],
      execute: jest.fn(async () => {
        throw transient;
      }),
      completeTargetResults: ['in_progress'],
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'temporary balancer outage',
      false,
      60_000
    );
  });

  it('restores a missing Redis journal from the durable target before redrive', async () => {
    const deps = makeExecutor({
      claimedTargets: [
        target({
          status: 'enqueued',
          lifecycleJournal: [lifecycleMessage],
        }),
      ],
      completeTargetResults: ['in_progress', 'succeeded'],
      preparedResults: [[]],
      redriveResults: [[{ operation_id: 'operation-1' }]],
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(2);
    });
    await deps.executor.close();

    expect(deps.lifecycleQueueService.prepare).toHaveBeenCalledWith(
      lifecycleMessage
    );
    expect(deps.lifecycleQueueService.loadPrepared).toHaveBeenCalledTimes(1);
    expect(deps.lifecycleQueueService.redrivePrepared).toHaveBeenCalledTimes(1);
    expect(deps.slotService.waitForRelease).not.toHaveBeenCalled();
    expect(deps.batchRepository.markTargetSlotReleased).not.toHaveBeenCalled();
    expect(deps.batchRepository.failOrRetryTarget).not.toHaveBeenCalled();
  });

  it('keeps the target retryable when the released slot cannot be fenced by its exact lease', async () => {
    const deps = makeExecutor({
      claimedTargets: [target()],
      completeTargetResults: ['in_progress'],
    });
    deps.batchRepository.markTargetSlotReleased.mockResolvedValueOnce(false);
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce(
      'enqueued_retry_scheduled'
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'config_channels_recreate_target_lease_lost:target-1',
      false,
      5_000
    );
  });

  it('keeps an adopted operation without a journal retryable while that operation is still in progress', async () => {
    const deps = makeExecutor({
      claimedTargets: [target({ status: 'enqueued' })],
      completeTargetResults: ['in_progress', 'in_progress'],
      preparedResults: [[]],
    });
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce(
      'enqueued_retry_scheduled'
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'config_channels_recreate_lifecycle_journal_missing:target-1',
      false,
      5_000
    );
  });

  it('fails a durable target when its lifecycle journal is deterministically invalid', async () => {
    const deps = makeExecutor({
      claimedTargets: [
        target({
          status: 'enqueued',
          lifecycleJournal: [lifecycleMessage],
        }),
      ],
      completeTargetResults: ['in_progress'],
      preparedResults: [[]],
    });
    deps.lifecycleQueueService.prepare.mockRejectedValueOnce(
      new WorkerLifecycleJournalError('payload_semantics_invalid')
    );
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce('failed');
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'worker_lifecycle_journal_invalid:payload_semantics_invalid',
      true,
      5_000
    );
  });

  it('settles a recovered target before recording a permanent journal failure', async () => {
    const deps = makeExecutor({
      claimedTargets: [
        target({
          status: 'enqueued',
          lifecycleJournal: [lifecycleMessage],
        }),
      ],
      completeTargetResults: ['in_progress', 'succeeded'],
      preparedResults: [[]],
    });
    deps.lifecycleQueueService.prepare.mockRejectedValueOnce(
      new WorkerLifecycleJournalError('transaction_command_failed')
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(2);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).not.toHaveBeenCalled();
  });

  it('keeps a generic Redis outage during journal restore transient', async () => {
    const deps = makeExecutor({
      claimedTargets: [
        target({
          status: 'enqueued',
          lifecycleJournal: [lifecycleMessage],
        }),
      ],
      completeTargetResults: ['in_progress'],
      preparedResults: [[]],
    });
    deps.lifecycleQueueService.prepare.mockRejectedValueOnce(
      new Error('redis connection unavailable')
    );
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'redis connection unavailable',
      false,
      5_000
    );
  });

  it('does not redrive a target already settled as terminal failed', async () => {
    const deps = makeExecutor({
      claimedTargets: [target({ status: 'enqueued' })],
      completeTargetResults: ['failed'],
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.lifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(deps.batchRepository.failOrRetryTarget).not.toHaveBeenCalled();
  });

  it('reschedules an online rollback with the same operation instead of redriving or failing it', async () => {
    const deps = makeExecutor({
      claimedTargets: [target({ status: 'enqueued' })],
      completeTargetResults: ['retry_scheduled'],
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.lifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(deps.channelRecreatorUseCase.execute).not.toHaveBeenCalled();
    expect(deps.batchRepository.failOrRetryTarget).not.toHaveBeenCalled();
  });

  it('marks only explicit permanent validation errors as terminal', async () => {
    const permanent = new PermanentChannelRecreateError(
      'worker_not_found',
      'worker_not_found'
    );
    const deps = makeExecutor({
      claimedTargets: [target()],
      execute: jest.fn(async () => {
        throw permanent;
      }),
      completeTargetResults: ['in_progress'],
    });
    deps.batchRepository.failOrRetryTarget.mockResolvedValueOnce('failed');
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledTimes(1);
    });
    await deps.executor.close();

    expect(deps.batchRepository.failOrRetryTarget).toHaveBeenCalledWith(
      'target-1',
      expect.any(String),
      'worker_not_found',
      true,
      5_000
    );
  });

  it('publishes the original completed feedback from the durable batch', async () => {
    const deps = makeExecutor({
      completedBatch: {
        batchId: 'batch-completed',
        accountId: 'account-1',
        success: 30,
        errors: 1,
      },
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.markCompletionPublished).toHaveBeenCalled();
    });
    await deps.executor.close();

    expect(deps.centrifugoService.publish).toHaveBeenCalledWith(
      expect.any(String),
      {
        type: 'recreate_all_completed',
        account_id: 'account-1',
        success: 30,
        errors: 1,
      }
    );
    expect(deps.batchRepository.markCompletionPublished).toHaveBeenCalledWith(
      'batch-completed',
      expect.any(String)
    );
  });

  it('keeps claiming targets when completion publication fails and releases that completion into durable backoff', async () => {
    const deps = makeExecutor({
      claimedTargets: [target()],
      completedBatch: {
        batchId: 'batch-completed',
        accountId: 'account-1',
        success: 30,
        errors: 1,
      },
      publish: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
    });
    deps.executor.start();

    await waitUntil(() => {
      expect(deps.batchRepository.completeTarget).toHaveBeenCalledTimes(1);
      expect(deps.batchRepository.releaseCompletionClaim).toHaveBeenCalledTimes(
        1
      );
    });
    await deps.executor.close();

    expect(deps.batchRepository.claimNextTarget).toHaveBeenCalled();
    expect(deps.channelRecreatorUseCase.execute).toHaveBeenCalledTimes(1);
    expect(deps.batchRepository.releaseCompletionClaim).toHaveBeenCalledWith(
      'batch-completed',
      expect.any(String)
    );
    expect(consoleError).toHaveBeenCalledWith(
      '[ConfigChannelsRecreateAllExecutorService] completion publication failed',
      { error: 'centrifugo unavailable' }
    );
  });
});
