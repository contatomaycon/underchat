import { inject, singleton } from 'tsyringe';
import {
  MESSAGE_SEND_LEDGER_V4_POLICY,
  MessageSendIdempotencyService,
  type IMessageSendRecoveryClaim,
} from './messageSendIdempotency.service';
import { StreamProducerService } from './streamProducer.service';
import { ScheduleStatusCoordinationService } from './scheduleStatusCoordination.service';
import { WorkerCommandLaneService } from './workerCommandLane.service';
import type { MessageSendRecoveryStepV1 } from '@core/common/functions/messageSendRecoveryPlan';
import {
  isWorkerCommandOperationalBarrierPausedError,
  WorkerCommandOperationalBarrierService,
} from './workerCommandOperationalBarrier.service';

export interface IMessageSendRecoveryDrainResult {
  claimed: number;
  completed: number;
  deferred: number;
  failed: number;
}

export interface IMessageSendRecoveryDrainerStartOptions {
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
}

export interface IMessageSendRecoveryDrainerStatus {
  running: boolean;
  in_flight: boolean;
}

/**
 * Replays only the durable post-provider effects declared in a validated v4
 * recovery plan. It has no dependency on a WhatsApp SDK and therefore cannot
 * accidentally invoke a provider during recovery.
 */
@singleton()
export class MessageSendRecoveryDrainerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private closed = true;
  private onError: (error: unknown) => void = (error) => {
    console.error('[MessageSendRecoveryDrainer] recovery failed:', error);
  };
  private onSuccess: () => void = () => undefined;

  constructor(
    @inject(MessageSendIdempotencyService)
    private readonly idempotency: MessageSendIdempotencyService,
    @inject(StreamProducerService)
    private readonly streamProducer: StreamProducerService,
    @inject(ScheduleStatusCoordinationService)
    private readonly scheduleStatus: ScheduleStatusCoordinationService,
    @inject(WorkerCommandLaneService)
    private readonly lanes: WorkerCommandLaneService,
    @inject(WorkerCommandOperationalBarrierService)
    private readonly barrier: WorkerCommandOperationalBarrierService
  ) {}

  public start(options: IMessageSendRecoveryDrainerStartOptions = {}): void {
    if (!this.closed) return;
    this.closed = false;
    this.onError = options.onError ?? this.onError;
    this.onSuccess = options.onSuccess ?? this.onSuccess;
    this.schedule(0);
  }

  public close(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public getStatus(): IMessageSendRecoveryDrainerStatus {
    return {
      running: !this.closed,
      in_flight: this.running,
    };
  }

  public async drainBatch(): Promise<IMessageSendRecoveryDrainResult> {
    try {
      return await this.barrier.runWithPermit('recovery_drainer', () =>
        this.drainBatchWhileOpen()
      );
    } catch (error) {
      if (isWorkerCommandOperationalBarrierPausedError(error)) {
        return { claimed: 0, completed: 0, deferred: 0, failed: 0 };
      }
      throw error;
    }
  }

  private async drainBatchWhileOpen(): Promise<IMessageSendRecoveryDrainResult> {
    for (
      let batch = 0;
      batch <
      MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogMaxBatchesPerPoll;
      batch += 1
    ) {
      const watchdog =
        await this.idempotency.processProviderInvocationWatchdogBatch();
      if (
        !Number.isSafeInteger(watchdog.examined) ||
        watchdog.examined <
          MESSAGE_SEND_LEDGER_V4_POLICY.providerInvocationWatchdogBatchSize
      ) {
        break;
      }
    }
    const claims = await this.idempotency.claimGlobalRecoveryBatch();
    const result: IMessageSendRecoveryDrainResult = {
      claimed: claims.length,
      completed: 0,
      deferred: 0,
      failed: 0,
    };
    let cursor = 0;
    const concurrency = Math.min(
      MESSAGE_SEND_LEDGER_V4_POLICY.recoveryMaxConcurrent,
      Math.max(1, claims.length)
    );
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (cursor < claims.length) {
          const claim = claims[cursor++];
          try {
            const outcome = await this.processClaim(claim);
            result[outcome] += 1;
          } catch (error) {
            result.failed += 1;
            await this.idempotency
              .releaseRecoveryClaim(claim)
              .catch(() => undefined);
            this.onError(error);
          }
        }
      })
    );
    return result;
  }

  private async processClaim(
    claim: IMessageSendRecoveryClaim
  ): Promise<'completed' | 'deferred'> {
    const completed = new Set(claim.completedStepIds);
    for (const step of claim.plan.steps) {
      const stepId = this.stepId(step);
      if (completed.has(stepId)) continue;
      await this.assertExtended(claim);
      await this.applyStep(step);
      const marked = await this.idempotency.markRecoveryStepCompleted(
        claim,
        stepId
      );
      if (marked !== 'transitioned') {
        throw new Error(`message_send_recovery_step_${marked}`);
      }
      completed.add(stepId);
    }

    if (claim.plan.lane) {
      const lane = claim.plan.lane;
      await this.assertExtended(claim);
      await this.lanes.markTerminal(
        lane.account_id,
        lane.worker_id,
        lane.entity_key,
        lane.operation_id,
        lane.command_id,
        claim.state,
        claim.state === 'succeeded' ? '' : claim.state
      );
    }

    if (claim.plan.kind === 'official_handler_recovery_v1') {
      // The official handler owns non-broker effects (window accounting,
      // annotations and durable message status mutations). Its Kafka-facing
      // steps are safe to recover here, but it alone may compact the record.
      const released = await this.idempotency.releaseRecoveryClaim(
        claim,
        5 * 60 * 1000
      );
      if (released !== 'transitioned') {
        throw new Error(`message_send_recovery_official_release_${released}`);
      }
      return 'deferred';
    }

    await this.assertExtended(claim);
    const compacted =
      await this.idempotency.compactRecoveryClaimAfterPubAck(claim);
    if (compacted !== 'transitioned') {
      throw new Error(`message_send_recovery_compaction_${compacted}`);
    }
    return 'completed';
  }

  private async applyStep(step: MessageSendRecoveryStepV1): Promise<void> {
    if (step.kind === 'kafka_publication_v1') {
      // send() resolves only after node-rdkafka's delivery report (PubAck).
      await this.streamProducer.send(step.topic, step.payload, step.key);
      return;
    }

    const state =
      await this.scheduleStatus.setMessageOperationalStateFromLedger(
        {
          scheduleId: step.schedule_id,
          accountId: step.account_id,
          workerId: step.worker_id,
          messageId: step.message_id,
          attemptId: step.attempt_id,
          ledgerOperationId: step.ledger_operation_id,
        },
        step.state
      );
    if (state === 'invalid') {
      throw new Error('message_send_recovery_schedule_state_invalid');
    }
    // `stale` is terminal by design: the stable ledger identity no longer
    // owns that schedule attempt and must never overwrite the new attempt.
  }

  private async assertExtended(
    claim: IMessageSendRecoveryClaim
  ): Promise<void> {
    const extended = await this.idempotency.extendRecoveryClaim(claim);
    if (extended !== 'transitioned') {
      throw new Error(`message_send_recovery_claim_${extended}`);
    }
  }

  private stepId(step: MessageSendRecoveryStepV1): string {
    return step.kind === 'kafka_publication_v1'
      ? step.publication_id
      : step.step_id;
  }

  private schedule(delayMs: number): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.closed || this.running) {
          this.schedule(MESSAGE_SEND_LEDGER_V4_POLICY.recoveryPollIntervalMs);
          return;
        }
        this.running = true;
        void this.drainBatch()
          .then((result) => {
            if (result.failed === 0) this.onSuccess();
          })
          .catch(this.onError)
          .finally(() => {
            this.running = false;
            this.schedule(MESSAGE_SEND_LEDGER_V4_POLICY.recoveryPollIntervalMs);
          });
      },
      Math.max(0, delayMs)
    );
    this.timer.unref?.();
  }
}
