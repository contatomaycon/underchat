import { singleton, inject } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandJsonObject,
  WorkerCommandPublishReceiptV1,
  WorkerCommandType,
} from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS,
} from '@core/common/constants/workerCommandTransport';
import {
  buildWorkerCommandEnvelopeV1,
  computeWorkerCommandPayloadDigest,
  WorkerCommandContractError,
} from '@core/common/functions/workerCommandEnvelope';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';
import { WorkerCommandEpochService } from '@core/services/workerCommandEpoch.service';
import {
  WorkerCommandDeadlineRegistryService,
  type WorkerCommandScheduleProjectionIdentity,
} from '@core/services/workerCommandDeadlineRegistry.service';
import { createWorkerCommandBus } from '@core/services/workerCommandBus.factory';
import type { WorkerCommandBus } from '@core/common/interfaces/IWorkerCommandBus';
import { recordWorkerCommandAcceptance } from '@core/common/functions/workerCommandAcceptanceContext';
import {
  WorkerCommandOperationalBarrierError,
  WorkerCommandOperationalBarrierService,
} from '@core/services/workerCommandOperationalBarrier.service';

export interface WorkerCommandAdmissionInput {
  accountId: string;
  workerId: string;
  commandType: WorkerCommandType;
  entityKey: string;
  operationId: string;
  retryOf?: string | null;
  payload: WorkerCommandJsonObject;
  payloadVersion?: number;
  traceparent?: string | null;
  source: string;
  /** Immutable server timestamp used by bounded queued-message recovery. */
  issuedAt?: Date | string;
  /** Payload-free identity used to converge schedule operational state. */
  scheduleProjection?: WorkerCommandScheduleProjectionIdentity;
  /** True only for a retry of a command whose first PubAck was unknown. */
  retry?: boolean;
}

export interface WorkerCommandAdmissionResult {
  envelope: WorkerCommandEnvelopeV1;
  receipt: WorkerCommandPublishReceiptV1;
}

/**
 * The single admission boundary for channel commands. It deliberately has no
 * Kafka dependency or fallback: without a JetStream PubAck the caller receives
 * a retryable/unknown error and no alternate transport can execute the effect.
 */
@singleton()
export class WorkerCommandAdmissionService {
  private bus: WorkerCommandBus | null = null;

  constructor(
    @inject(WorkerCommandLaneService)
    private readonly lane: WorkerCommandLaneService,
    @inject(WorkerCommandEpochService)
    private readonly epochs: WorkerCommandEpochService,
    @inject(WorkerCommandDeadlineRegistryService)
    private readonly deadlines: WorkerCommandDeadlineRegistryService,
    @inject(WorkerCommandOperationalBarrierService)
    private readonly barrier: WorkerCommandOperationalBarrierService
  ) {}

  public async admit(
    input: WorkerCommandAdmissionInput
  ): Promise<WorkerCommandAdmissionResult> {
    const operationId = input.operationId.trim();
    const retryOf = input.retryOf?.trim() || null;
    if (!operationId || operationId !== input.operationId) {
      throw new Error('worker_command_operation_id_invalid');
    }
    if (
      input.retryOf !== null &&
      input.retryOf !== undefined &&
      retryOf !== input.retryOf
    ) {
      throw new Error('worker_command_retry_of_invalid');
    }
    if (retryOf === operationId) {
      throw new Error('worker_command_retry_of_invalid');
    }
    try {
      return await this.barrier.runWithPermit('admission', async () => {
        const proposedIssuedAt =
          input.issuedAt instanceof Date
            ? new Date(input.issuedAt.getTime())
            : input.issuedAt
              ? new Date(input.issuedAt)
              : new Date();
        if (!Number.isFinite(proposedIssuedAt.getTime())) {
          throw new Error('worker_command_issued_at_invalid');
        }
        const proposedCommandId = uuidv7({ msecs: proposedIssuedAt.getTime() });
        const payloadDigest = computeWorkerCommandPayloadDigest(input.payload);
        const currentEpoch = await this.epochs.requireActive(
          input.accountId,
          input.workerId
        );
        const admissionIdentity = await this.deadlines.reserveAdmissionIdentity(
          {
            accountId: input.accountId,
            workerId: input.workerId,
            entityKey: input.entityKey,
            operationId,
            payloadDigest,
            commandType: input.commandType,
            originEpoch: currentEpoch.record.epoch,
            retryOf,
            proposedIssuedAt,
            proposedCommandId,
          }
        );
        if (
          (input.retry || admissionIdentity.existing) &&
          admissionIdentity.observedAtMs >=
            admissionIdentity.issuedAt.getTime() +
              WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS
        ) {
          const error = new WorkerCommandContractError(
            'retry_window_elapsed',
            'Janela publica de retry de 2 minutos encerrada'
          );
          error.operationId = operationId;
          error.commandId = admissionIdentity.commandId;
          error.issuedAt = admissionIdentity.issuedAt.toISOString();
          error.expiresAt = new Date(
            admissionIdentity.issuedAt.getTime() + WORKER_COMMAND_MAX_AGE_MS
          ).toISOString();
          error.retryUntil = new Date(
            admissionIdentity.issuedAt.getTime() +
              WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS
          ).toISOString();
          throw error;
        }
        const allocation = await this.lane.allocate(
          input.accountId,
          input.workerId,
          input.entityKey,
          operationId,
          admissionIdentity.issuedAt,
          admissionIdentity.commandId,
          admissionIdentity.originEpoch,
          payloadDigest,
          input.commandType
        );
        const issuedAt = allocation.issuedAt;
        const deadlineAt = new Date(
          issuedAt.getTime() + WORKER_COMMAND_MAX_AGE_MS
        );
        const envelope = buildWorkerCommandEnvelopeV1({
          command_id: allocation.commandId,
          operation_id: operationId,
          retry_of: retryOf,
          account_id: input.accountId,
          worker_id: input.workerId,
          command_type: input.commandType,
          entity_key: input.entityKey,
          entity_sequence: allocation.entitySequence,
          predecessor_operation_id: allocation.predecessorOperationId,
          origin_epoch: allocation.originEpoch,
          issued_at: issuedAt.toISOString(),
          deadline_at: deadlineAt.toISOString(),
          payload_version: input.payloadVersion ?? 1,
          payload: input.payload,
          traceparent: input.traceparent ?? null,
          source: input.source,
        });
        // Durable deadline evidence must exist before a publish can be accepted.
        // The registry stores this bounded identity only, never envelope payload.
        await this.deadlines.register(envelope, input.scheduleProjection);
        // Revalidate immediately before publish so a lifecycle transition cannot
        // admit a command into a draining/closed epoch.
        await this.epochs.assertActive(
          input.accountId,
          input.workerId,
          envelope.origin_epoch
        );
        const bus = this.commandBus();
        let receipt: WorkerCommandPublishReceiptV1;
        try {
          receipt =
            input.retry || admissionIdentity.existing || allocation.existing
              ? await bus.retry(envelope)
              : await bus.publish(envelope);
        } catch (error) {
          // The bus exposes a confirmed PubAck or an error; transport failures can
          // mean that acceptance happened but its Ack was lost. Keep the compact
          // record so both known rejection and unknown outcome converge through
          // the same never-active deadline proof instead of assuming safety.
          throw error;
        }
        recordWorkerCommandAcceptance(receipt);
        return { envelope, receipt };
      });
    } catch (error) {
      if (error instanceof WorkerCommandOperationalBarrierError) {
        error.operationId ??= operationId;
      }
      throw error;
    }
  }

  public async close(): Promise<void> {
    const bus = this.bus;
    this.bus = null;
    await Promise.all([bus?.close(), this.epochs.close()]);
  }

  private commandBus(): WorkerCommandBus {
    this.bus ??= createWorkerCommandBus();
    return this.bus;
  }
}
