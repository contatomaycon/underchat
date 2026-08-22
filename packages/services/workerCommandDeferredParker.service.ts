import type { JsMsg, JetStreamClient, PubAck } from '@nats-io/jetstream';
import {
  WORKER_COMMAND_MAX_BYTES,
  WORKER_DEFERRED_PARK_DELAY_MS,
  WORKER_DEFERRED_PUBACK_TIMEOUT_MS,
  WORKER_DEFERRED_STREAM,
} from '@core/common/constants/workerCommandTransport';
import { workerCommandDeferredIdentity } from '@core/common/functions/workerCommandDeferred';
import { assertWorkerCommandPublishable } from '@core/common/functions/workerCommandEnvelope';
import type { WorkerCommandEnvelopeV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';

export interface WorkerCommandDeferredParkingReceipt {
  stream: typeof WORKER_DEFERRED_STREAM;
  streamSequence: number;
  duplicate: boolean;
  scheduleSubject: string;
  readySubject: string;
  scheduledAt: string;
  expiresAt: string;
}

export class WorkerCommandDeferredExpiredError extends Error {
  readonly nonRetryable = true;

  constructor() {
    super('worker_command_deferred_deadline_elapsed');
    this.name = 'WorkerCommandDeferredExpiredError';
  }
}

export class WorkerCommandDeferredContractError extends Error {
  readonly nonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'WorkerCommandDeferredContractError';
  }
}

type DeferredSourceMessage = Pick<JsMsg, 'seq' | 'data' | 'ackAck'>;

/**
 * Moves a never-active lane successor out of the commands consumer's
 * MaxAckPending window. The original command is acknowledged only after the
 * one-shot schedule has a valid JetStream PubAck.
 */
export class WorkerCommandDeferredParkerService {
  constructor(private readonly now: () => number = Date.now) {}

  public async parkAndAckOriginal(
    client: JetStreamClient,
    message: DeferredSourceMessage,
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandDeferredParkingReceipt> {
    const receipt = await this.park(client, message, envelope);
    if (
      !(await message.ackAck({ timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS }))
    ) {
      throw new Error('worker_command_deferred_original_acksync_not_confirmed');
    }
    return receipt;
  }

  public async park(
    client: JetStreamClient,
    message: Pick<DeferredSourceMessage, 'seq' | 'data'>,
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandDeferredParkingReceipt> {
    const now = this.now();
    assertWorkerCommandPublishable(envelope, now);
    if (message.data.byteLength > WORKER_COMMAND_MAX_BYTES) {
      throw new WorkerCommandDeferredContractError(
        'worker_command_deferred_payload_too_large'
      );
    }

    const deadlineAt = Date.parse(envelope.deadline_at);
    const scheduledAt = now + WORKER_DEFERRED_PARK_DELAY_MS;
    if (!Number.isFinite(deadlineAt) || scheduledAt >= deadlineAt) {
      throw new WorkerCommandDeferredExpiredError();
    }
    const identity = workerCommandDeferredIdentity(
      envelope.worker_id,
      envelope.command_id,
      message.seq
    );
    const ttlMs = deadlineAt - scheduledAt;
    const ack = await client.publish(identity.scheduleSubject, message.data, {
      msgID: identity.scheduleMessageId,
      expect: { streamName: WORKER_DEFERRED_STREAM },
      timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS,
      retries: 0,
      schedule: {
        specification: { at: new Date(scheduledAt) },
        target: identity.readySubject,
        ttl: `${ttlMs}ms`,
      },
    });
    this.assertPubAck(ack);
    return {
      stream: WORKER_DEFERRED_STREAM,
      streamSequence: ack.seq,
      duplicate: ack.duplicate,
      scheduleSubject: identity.scheduleSubject,
      readySubject: identity.readySubject,
      scheduledAt: new Date(scheduledAt).toISOString(),
      expiresAt: envelope.deadline_at,
    };
  }

  private assertPubAck(ack: PubAck): void {
    if (ack.stream !== WORKER_DEFERRED_STREAM) {
      throw new WorkerCommandDeferredContractError(
        'worker_command_deferred_unexpected_stream'
      );
    }
    if (
      !Number.isSafeInteger(ack.seq) ||
      ack.seq < 1 ||
      typeof ack.duplicate !== 'boolean'
    ) {
      throw new WorkerCommandDeferredContractError(
        'worker_command_deferred_invalid_puback'
      );
    }
  }
}
