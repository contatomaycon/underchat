import { randomUUID } from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import {
  WORKER_COMMAND_DEADLINE_POLICY,
  WorkerCommandDeadlineRegistryService,
  type WorkerCommandDeadlineClaim,
} from '@core/services/workerCommandDeadlineRegistry.service';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';
import {
  WorkerCommandFailurePublisherService,
  type WorkerCommandFailureCode,
} from '@core/services/workerCommandFailurePublisher.service';
import {
  ScheduleStatusCoordinationService,
  type ScheduleMessageOperationalState,
} from '@core/services/scheduleStatusCoordination.service';
import {
  isWorkerCommandOperationalBarrierPausedError,
  WorkerCommandOperationalBarrierService,
} from '@core/services/workerCommandOperationalBarrier.service';

export interface WorkerCommandDeadlineReconcilerStatus {
  running: boolean;
  in_flight: boolean;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error_at: string | null;
  claimed_total: number;
  completed_total: number;
  failure_published_total: number;
  rescheduled_total: number;
  failed_total: number;
  barrier_paused: boolean;
  barrier_skipped_total: number;
}

/**
 * Resolves every admitted command from the payload-free Redis deadline index.
 * A failure record is removed only after the deterministic failure PubAck.
 */
@singleton()
export class WorkerCommandDeadlineReconcilerService {
  private readonly owner = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private loop: Promise<void> | null = null;
  private status: WorkerCommandDeadlineReconcilerStatus = {
    running: false,
    in_flight: false,
    last_started_at: null,
    last_finished_at: null,
    last_error_at: null,
    claimed_total: 0,
    completed_total: 0,
    failure_published_total: 0,
    rescheduled_total: 0,
    failed_total: 0,
    barrier_paused: false,
    barrier_skipped_total: 0,
  };

  constructor(
    @inject(WorkerCommandDeadlineRegistryService)
    private readonly registry: WorkerCommandDeadlineRegistryService,
    @inject(WorkerCommandLaneService)
    private readonly lanes: WorkerCommandLaneService,
    @inject(WorkerCommandFailurePublisherService)
    private readonly failures: WorkerCommandFailurePublisherService,
    @inject(ScheduleStatusCoordinationService)
    private readonly schedules: ScheduleStatusCoordinationService,
    @inject(WorkerCommandOperationalBarrierService)
    private readonly barrier: WorkerCommandOperationalBarrierService
  ) {}

  public start(options?: {
    onError?: (error: unknown) => void;
    onSuccess?: () => void;
  }): void {
    if (this.status.running) return;
    this.status.running = true;
    const run = (): void => {
      void this.runOnce()
        .then(() => options?.onSuccess?.())
        .catch((error: unknown) => options?.onError?.(error));
    };
    run();
    this.timer = setInterval(run, WORKER_COMMAND_DEADLINE_POLICY.intervalMs);
    this.timer.unref?.();
  }

  public async close(): Promise<void> {
    this.status.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.loop?.catch(() => undefined);
    // The publisher is a process singleton and may be shared by other
    // reconcilers. Its connection is drained only by process shutdown.
  }

  public getStatus(): WorkerCommandDeadlineReconcilerStatus {
    return { ...this.status };
  }

  public async runOnce(now = new Date()): Promise<void> {
    if (this.loop) return this.loop;
    this.status.in_flight = true;
    this.status.last_started_at = now.toISOString();
    this.loop = this.barrier
      .runWithPermit('deadline_reconciler', async () => {
        this.status.barrier_paused = false;
        await this.reconcile(now);
      })
      .catch((error: unknown) => {
        if (isWorkerCommandOperationalBarrierPausedError(error)) {
          this.status.barrier_paused = true;
          this.status.barrier_skipped_total += 1;
          return;
        }
        this.status.last_error_at = new Date().toISOString();
        throw error;
      })
      .finally(() => {
        this.status.in_flight = false;
        this.status.last_finished_at = new Date().toISOString();
        this.loop = null;
      });
    return this.loop;
  }

  private async reconcile(now: Date): Promise<void> {
    const claims = await this.registry.claimDue(
      now,
      this.owner,
      WORKER_COMMAND_DEADLINE_POLICY.batchSize
    );
    this.status.claimed_total += claims.length;
    for (
      let offset = 0;
      offset < claims.length;
      offset += WORKER_COMMAND_DEADLINE_POLICY.concurrency
    ) {
      await Promise.all(
        claims
          .slice(offset, offset + WORKER_COMMAND_DEADLINE_POLICY.concurrency)
          .map((claim) => this.reconcileClaim(claim, now))
      );
    }
  }

  private async reconcileClaim(
    claim: WorkerCommandDeadlineClaim,
    now: Date
  ): Promise<void> {
    try {
      const record = claim.record;
      const laneState = await this.lanes.expireNeverActive(
        record.account_id,
        record.worker_id,
        record.entity_key,
        record.operation_id
      );

      if (laneState === 'predecessor_pending') {
        await this.reschedule(claim, this.boundedRetryAt(claim, now));
        return;
      }

      if (laneState === 'ever_active') {
        const capAt = new Date(
          Date.parse(record.issued_at) +
            WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs
        );
        const finalizeAt = new Date(
          capAt.getTime() - WORKER_COMMAND_DEADLINE_POLICY.finalizationMarginMs
        );
        if (now.getTime() < finalizeAt.getTime()) {
          await this.reschedule(
            claim,
            new Date(
              Math.min(
                now.getTime() +
                  WORKER_COMMAND_DEADLINE_POLICY.activeRescheduleMs,
                finalizeAt.getTime()
              )
            )
          );
          return;
        }
        const terminal = await this.lanes.finalizeEverActiveAmbiguous(
          record.account_id,
          record.worker_id,
          record.entity_key,
          record.operation_id,
          record.command_id
        );
        await this.reconcileTerminal(claim, terminal);
        return;
      }

      if (laneState === 'terminal:succeeded') {
        await this.projectSchedule(claim, 'succeeded');
        await this.complete(claim);
        return;
      }

      const code = this.failureCode(laneState);
      await this.projectSchedule(
        claim,
        code === 'ambiguous'
          ? 'ambiguous'
          : code === 'failed'
            ? 'provider_rejected'
            : 'pre_provider_failed'
      );
      await this.publishFailure(claim, code);
      await this.complete(claim);
    } catch {
      this.status.failed_total += 1;
      try {
        await this.reschedule(claim, this.boundedRetryAt(claim, now));
      } catch {
        // The bounded lease makes a failed claim available to the next leader.
      }
    }
  }

  private failureCode(laneState: string): WorkerCommandFailureCode {
    switch (laneState) {
      case 'expired':
      case 'terminal:expired':
        return 'expired';
      case 'terminal:failed':
        return 'failed';
      case 'missing':
      case 'terminal:ambiguous':
        return 'ambiguous';
      default:
        throw new Error('worker_command_deadline_lane_state_invalid');
    }
  }

  private async reconcileTerminal(
    claim: WorkerCommandDeadlineClaim,
    laneState: string
  ): Promise<void> {
    if (laneState === 'terminal:succeeded') {
      await this.projectSchedule(claim, 'succeeded');
      await this.complete(claim);
      return;
    }
    if (laneState === 'never_active') {
      throw new Error('worker_command_deadline_lane_state_changed');
    }
    const code = this.failureCode(laneState);
    await this.projectSchedule(
      claim,
      code === 'ambiguous'
        ? 'ambiguous'
        : code === 'failed'
          ? 'provider_rejected'
          : 'pre_provider_failed'
    );
    await this.publishFailure(claim, code);
    await this.complete(claim);
  }

  private async publishFailure(
    claim: WorkerCommandDeadlineClaim,
    code: WorkerCommandFailureCode
  ): Promise<void> {
    const record = claim.record;
    await this.failures.publish({
      workerId: record.worker_id,
      code,
      command: record,
      error: new Error(`worker_command_deadline_${code}`),
    });
    this.status.failure_published_total += 1;
  }

  private async projectSchedule(
    claim: WorkerCommandDeadlineClaim,
    state: ScheduleMessageOperationalState
  ): Promise<void> {
    const record = claim.record;
    const projection = record.schedule_projection;
    if (!projection) return;
    await this.schedules.setMessageOperationalState(
      {
        scheduleId: projection.schedule_id,
        messageId: projection.message_id,
        attemptId: projection.attempt_id,
        accountId: record.account_id,
        workerId: record.worker_id,
      },
      state
    );
    // setMessageOperationalState schedules the existing bounded ES status
    // reconciliation immediately; no command payload is needed here.
  }

  private boundedRetryAt(claim: WorkerCommandDeadlineClaim, now: Date): Date {
    const hardCapAt =
      Date.parse(claim.record.issued_at) +
      WORKER_COMMAND_DEADLINE_POLICY.operationalCapMs;
    const retryAt =
      now.getTime() + WORKER_COMMAND_DEADLINE_POLICY.activeRescheduleMs;
    // The HASH expires server-side at hardCapAt. Once the cap is reached,
    // schedule one cleanup observation just after expiry instead of a hot loop.
    return new Date(
      now.getTime() >= hardCapAt
        ? now.getTime() + WORKER_COMMAND_DEADLINE_POLICY.intervalMs
        : Math.min(retryAt, hardCapAt)
    );
  }

  private async complete(claim: WorkerCommandDeadlineClaim): Promise<void> {
    if (await this.registry.complete(claim)) {
      this.status.completed_total += 1;
    }
  }

  private async reschedule(
    claim: WorkerCommandDeadlineClaim,
    dueAt: Date
  ): Promise<void> {
    if (await this.registry.reschedule(claim, dueAt)) {
      this.status.rescheduled_total += 1;
    }
  }
}
