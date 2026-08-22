import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { getErrorMessage } from '@core/common/functions/toError';
import type { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import {
  ConfigChannelsRecreateBatchRepository,
  type ClaimedConfigChannelsRecreateTarget,
} from '@core/repositories/config/ConfigChannelsRecreateBatch.repository';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  WorkerRecreateServerSlotService,
  type WorkerRecreateServerSlotLease,
} from '@core/services/workerRecreateServerSlot.service';
import {
  ChannelRecreatorUseCase,
  PermanentChannelRecreateError,
} from '@core/useCases/config/ChannelRecreator.useCase';
import {
  WorkerLifecycleJournalError,
  WorkerLifecycleQueueService,
} from '@core/services/workerLifecycleQueue.service';
import { inject, singleton } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

const EXECUTOR_POLL_INTERVAL_MS = 1_000;
/*
 * One healthy Service replica must be able to saturate the production
 * topology (eleven servers x two slots). The repository admission below
 * still caps durable work per server, so this process-wide ceiling does not
 * increase Docker concurrency on any host.
 */
const EXECUTOR_LOCAL_CONCURRENCY = 32;
const TARGET_LEASE_DURATION_MS = 90_000;
const TARGET_LEASE_HEARTBEAT_MS = 30_000;
const COMPLETION_LEASE_DURATION_MS = 60_000;
const EXECUTOR_CLOSE_DRAIN_MS = 5_000;
const TRANSIENT_LIFECYCLE_JOURNAL_REASONS = new Set([
  'redis_unavailable',
  'transaction_aborted',
  'transaction_not_confirmed',
  'phase_upgrade_locked',
]);

class ConfigChannelsRecreateTargetLeaseLostError extends Error {
  constructor(targetId: string) {
    super(`config_channels_recreate_target_lease_lost:${targetId}`);
    this.name = 'ConfigChannelsRecreateTargetLeaseLostError';
  }
}

class ConfigChannelsRecreateTargetNotRecoveredError extends Error {
  constructor(targetId: string) {
    super(`config_channels_recreate_target_not_recovered:${targetId}`);
    this.name = 'ConfigChannelsRecreateTargetNotRecoveredError';
  }
}

class ConfigChannelsRecreateLifecycleJournalMissingError extends Error {
  constructor(targetId: string) {
    super(`config_channels_recreate_lifecycle_journal_missing:${targetId}`);
    this.name = 'ConfigChannelsRecreateLifecycleJournalMissingError';
  }
}

function isPermanentLifecycleJournalError(error: unknown): boolean {
  if (!(error instanceof WorkerLifecycleJournalError)) {
    return false;
  }

  return !TRANSIENT_LIFECYCLE_JOURNAL_REASONS.has(error.reason);
}

interface TargetLeaseGuard {
  readonly assertActive: () => void;
  readonly stop: () => void;
}

@singleton()
export class ConfigChannelsRecreateAllExecutorService {
  private readonly ownerId = uuidv7();
  private readonly activeTargets = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickRunning = false;
  private started = false;
  private closing = false;

  constructor(
    @inject(ConfigChannelsRecreateBatchRepository)
    private readonly batchRepository: ConfigChannelsRecreateBatchRepository,
    @inject(ChannelRecreatorUseCase)
    private readonly channelRecreatorUseCase: ChannelRecreatorUseCase,
    @inject(WorkerRecreateServerSlotService)
    private readonly workerRecreateServerSlotService: WorkerRecreateServerSlotService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  start(): void {
    if (this.started || this.closing) {
      return;
    }

    this.started = true;
    this.schedule(0);
  }

  kick(): void {
    if (!this.started || this.closing) {
      return;
    }

    this.schedule(0, true);
  }

  async close(): Promise<void> {
    this.closing = true;
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.activeTargets.size === 0) {
      return;
    }

    await Promise.race([
      Promise.allSettled([...this.activeTargets]).then(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, EXECUTOR_CLOSE_DRAIN_MS);
        timer.unref?.();
      }),
    ]);
  }

  private schedule(delayMs: number, replace = false): void {
    if (!this.started || this.closing) {
      return;
    }
    if (this.timer) {
      if (!replace) {
        return;
      }
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.tick();
      },
      Math.max(0, delayMs)
    );
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.tickRunning || !this.started || this.closing) {
      return;
    }

    this.tickRunning = true;
    let claimedAny = false;
    try {
      await this.publishNextCompletion();
    } catch (error) {
      console.error(
        '[ConfigChannelsRecreateAllExecutorService] completion publication failed',
        { error: getErrorMessage(error) }
      );
    }

    try {
      while (
        !this.closing &&
        this.activeTargets.size < EXECUTOR_LOCAL_CONCURRENCY
      ) {
        const target = await this.batchRepository.claimNextTarget(
          this.ownerId,
          TARGET_LEASE_DURATION_MS,
          this.workerRecreateServerSlotService.getSlotCount()
        );
        if (!target) {
          break;
        }

        claimedAny = true;
        this.launchTarget(target);
      }
    } catch (error) {
      console.error(
        '[ConfigChannelsRecreateAllExecutorService] target claim failed',
        { error: getErrorMessage(error) }
      );
    } finally {
      this.tickRunning = false;
      this.schedule(claimedAny ? 0 : EXECUTOR_POLL_INTERVAL_MS);
    }
  }

  private launchTarget(target: ClaimedConfigChannelsRecreateTarget): void {
    const execution = this.processTarget(target)
      .catch((error: unknown) => {
        console.error(
          '[ConfigChannelsRecreateAllExecutorService] target execution escaped',
          {
            batch_id: target.batchId,
            target_id: target.targetId,
            worker_id: target.workerId,
            server_id: target.serverId,
            lifecycle_operation_id: target.lifecycleOperationId,
            error: getErrorMessage(error),
          }
        );
      })
      .finally(() => {
        this.activeTargets.delete(execution);
        this.schedule(0, true);
      });

    this.activeTargets.add(execution);
  }

  private async processTarget(
    target: ClaimedConfigChannelsRecreateTarget
  ): Promise<void> {
    const leaseGuard = this.startTargetLeaseGuard(target.targetId);
    let slot = this.restoreSlot(target);
    let slotTransferredToLifecycle = target.status === 'enqueued';

    try {
      if (target.status === 'enqueued') {
        if (await this.tryCompleteTarget(target, leaseGuard.assertActive)) {
          return;
        }
        const redriven = await this.redriveTarget(target);
        if (
          !redriven &&
          (await this.tryCompleteTarget(target, leaseGuard.assertActive))
        ) {
          return;
        }
        if (!redriven) {
          throw new ConfigChannelsRecreateLifecycleJournalMissingError(
            target.targetId
          );
        }
        leaseGuard.assertActive();
        await this.observeSlotRelease(target, slot, leaseGuard.assertActive);
        await this.assertTargetCompleted(target, leaseGuard.assertActive);
        return;
      }

      leaseGuard.assertActive();
      if (!slot) {
        const token = this.workerRecreateServerSlotService.buildToken(
          target.workerId,
          target.lifecycleOperationId
        );
        slot = await this.workerRecreateServerSlotService.acquire(
          target.serverId,
          token,
          {
            assertActive: leaseGuard.assertActive,
            reservation: true,
            ttlMs: this.workerRecreateServerSlotService.getReservationTtlMs(),
          }
        );
        leaseGuard.assertActive();
        const stored = await this.batchRepository.storeTargetSlot(
          target.targetId,
          this.ownerId,
          {
            key: slot.key,
            token: slot.token,
            index: slot.slot,
          }
        );
        if (!stored) {
          throw new ConfigChannelsRecreateTargetLeaseLostError(target.targetId);
        }
      }

      const t = await createI18nInstance('pt');
      leaseGuard.assertActive();
      await this.channelRecreatorUseCase.execute(
        t,
        target.workerId,
        target.lifecycleOperationId,
        {
          lifecycle_operation_id: target.lifecycleOperationId,
          recreate_server_slot_key: slot.key,
          recreate_server_slot_token: slot.token,
          expected_worker_identity: {
            account_id: target.workerAccountId,
            server_id: target.serverId,
            worker_type_id: target.workerTypeId,
          },
          onLifecycleClaimed: async (operationId, lifecycleJournal) => {
            const marked = await this.batchRepository.markTargetEnqueued(
              target.targetId,
              this.ownerId,
              operationId,
              lifecycleJournal
            );
            if (!marked) {
              throw new ConfigChannelsRecreateTargetLeaseLostError(
                target.targetId
              );
            }
          },
          onLifecycleEnqueued: () => {
            slotTransferredToLifecycle = true;
          },
        }
      );
      leaseGuard.assertActive();

      if (!slotTransferredToLifecycle) {
        await this.workerRecreateServerSlotService.release(slot);
      }
      await this.observeSlotRelease(target, slot, leaseGuard.assertActive);
      await this.assertTargetCompleted(target, leaseGuard.assertActive);
    } catch (error) {
      // The lifecycle may have completed between the failing journal/slot
      // operation and this handler. Re-observe the fenced database state
      // before turning an already recovered channel into a false batch
      // failure.
      try {
        if (await this.tryCompleteTarget(target, leaseGuard.assertActive)) {
          return;
        }
      } catch (settlementError) {
        console.warn(
          '[ConfigChannelsRecreateAllExecutorService] target could not be re-observed after execution failure',
          {
            batch_id: target.batchId,
            target_id: target.targetId,
            worker_id: target.workerId,
            lifecycle_operation_id: target.lifecycleOperationId,
            execution_error: getErrorMessage(error),
            settlement_error: getErrorMessage(settlementError),
          }
        );
      }

      if (slot && !slotTransferredToLifecycle) {
        await this.workerRecreateServerSlotService
          .release(slot)
          .catch(() => undefined);
        await this.batchRepository
          .markTargetSlotReleased(target.targetId, this.ownerId, slot)
          .catch(() => undefined);
      }

      const retryDelayMs = Math.min(
        60_000,
        5_000 * 2 ** Math.min(10, Math.max(0, target.attemptCount - 1))
      );
      const disposition = await this.batchRepository.failOrRetryTarget(
        target.targetId,
        this.ownerId,
        getErrorMessage(error),
        error instanceof PermanentChannelRecreateError ||
          isPermanentLifecycleJournalError(error),
        retryDelayMs
      );

      console.error(
        '[ConfigChannelsRecreateAllExecutorService] target recreation failed',
        {
          batch_id: target.batchId,
          target_id: target.targetId,
          worker_id: target.workerId,
          server_id: target.serverId,
          lifecycle_operation_id: target.lifecycleOperationId,
          attempt: target.attemptCount,
          disposition,
          error: getErrorMessage(error),
        }
      );
    } finally {
      leaseGuard.stop();
    }
  }

  private restoreSlot(
    target: ClaimedConfigChannelsRecreateTarget
  ): WorkerRecreateServerSlotLease | null {
    if (!target.slotKey || !target.slotToken) {
      return null;
    }

    return {
      key: target.slotKey,
      token: target.slotToken,
      serverId: target.serverId,
      slot: target.slotIndex ?? 0,
      reserved: true,
    };
  }

  private async observeSlotRelease(
    target: ClaimedConfigChannelsRecreateTarget,
    slot: WorkerRecreateServerSlotLease | null,
    assertActive: () => void
  ): Promise<void> {
    if (!slot) {
      return;
    }

    await this.workerRecreateServerSlotService.waitForRelease(slot, {
      assertActive,
    });
    assertActive();
    const marked = await this.batchRepository.markTargetSlotReleased(
      target.targetId,
      this.ownerId,
      slot
    );
    if (!marked) {
      throw new ConfigChannelsRecreateTargetLeaseLostError(target.targetId);
    }
  }

  private async assertTargetCompleted(
    target: ClaimedConfigChannelsRecreateTarget,
    assertActive: () => void
  ): Promise<void> {
    if (!(await this.tryCompleteTarget(target, assertActive))) {
      throw new ConfigChannelsRecreateTargetNotRecoveredError(target.targetId);
    }
  }

  private async tryCompleteTarget(
    target: ClaimedConfigChannelsRecreateTarget,
    assertActive: () => void
  ): Promise<boolean> {
    assertActive();
    const settlement = await this.batchRepository.completeTarget(
      target.targetId,
      this.ownerId
    );
    if (settlement === 'lease_lost') {
      throw new ConfigChannelsRecreateTargetLeaseLostError(target.targetId);
    }
    return (
      settlement === 'succeeded' ||
      settlement === 'failed' ||
      settlement === 'retry_scheduled'
    );
  }

  private async redriveTarget(
    target: ClaimedConfigChannelsRecreateTarget
  ): Promise<boolean> {
    const prepared = await this.workerLifecycleQueueService.loadPrepared(
      target.workerId,
      target.lifecycleOperationId
    );
    if (prepared.length > 0) {
      /*
       * The lifecycle monitor owns cooldown-aware publication of an existing
       * journal. Republishing it on every one-minute batch retry bypassed that
       * backoff, flooded Kafka with duplicates and let one stuck target make
       * the whole batch appear stalled. The batch executor only reconstructs
       * a journal that is genuinely missing.
       */
      return true;
    }

    const journal = target.lifecycleJournal ?? [];
    if (
      journal.length === 0 ||
      journal.some(
        (message) =>
          message.worker_id !== target.workerId ||
          message.account_id !== target.workerAccountId ||
          message.operation_id !== target.lifecycleOperationId
      )
    ) {
      return false;
    }

    for (const message of journal) {
      await this.workerLifecycleQueueService.prepare(message);
    }
    const redriven = await this.workerLifecycleQueueService.redrivePrepared(
      target.workerId,
      target.lifecycleOperationId,
      target.lifecycleOperationId
    );
    return redriven.length > 0;
  }

  private startTargetLeaseGuard(targetId: string): TargetLeaseGuard {
    let stopped = false;
    let renewing = false;
    let confirmedUntil = Date.now() + TARGET_LEASE_DURATION_MS;
    let lostError: ConfigChannelsRecreateTargetLeaseLostError | null = null;

    const loseLease = () => {
      lostError ??= new ConfigChannelsRecreateTargetLeaseLostError(targetId);
    };
    const assertActive = () => {
      if (this.closing || Date.now() >= confirmedUntil) {
        loseLease();
      }
      if (lostError) {
        throw lostError;
      }
    };
    const heartbeat = setInterval(() => {
      if (stopped || renewing) {
        return;
      }
      renewing = true;
      void this.batchRepository
        .renewTargetLease(targetId, this.ownerId, TARGET_LEASE_DURATION_MS)
        .then((renewed) => {
          if (!stopped && renewed) {
            confirmedUntil = Date.now() + TARGET_LEASE_DURATION_MS;
            return;
          }
          if (!stopped) {
            loseLease();
          }
        })
        .catch(() => {
          if (!stopped && Date.now() >= confirmedUntil) {
            loseLease();
          }
        })
        .finally(() => {
          renewing = false;
        });
    }, TARGET_LEASE_HEARTBEAT_MS);
    heartbeat.unref?.();

    return {
      assertActive,
      stop: () => {
        stopped = true;
        clearInterval(heartbeat);
      },
    };
  }

  private async publishNextCompletion(): Promise<void> {
    const completion = await this.batchRepository.claimCompletedBatch(
      this.ownerId,
      COMPLETION_LEASE_DURATION_MS
    );
    if (!completion) {
      return;
    }

    const payload: IConfigChannelsRecreateAllCompleted = {
      type: 'recreate_all_completed',
      account_id: completion.accountId,
      success: completion.success,
      errors: completion.errors,
    };

    try {
      await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);
      const marked = await this.batchRepository.markCompletionPublished(
        completion.batchId,
        this.ownerId
      );
      if (!marked) {
        throw new Error(
          'config_channels_recreate_completion_lease_lost_after_publish'
        );
      }
    } catch (error) {
      await this.batchRepository
        .releaseCompletionClaim(completion.batchId, this.ownerId)
        .catch(() => undefined);
      throw error;
    }
  }
}
