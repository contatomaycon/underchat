import { createHash } from 'node:crypto';
import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  jetstream,
  jetstreamManager,
  type Consumer,
  type ConsumerMessages,
  type JsMsg,
  type JetStreamClient,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_STREAM,
} from '@core/common/constants/workerCommandTransport';
import {
  assertWorkerCommandPublishable,
  workerCommandSubject,
} from '@core/common/functions/workerCommandEnvelope';
import { FairKeyedScheduler } from '@core/common/functions/fairKeyedScheduler';
import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandType,
} from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  natsJetStreamPublisherOptionsFromEnvironment,
  natsNodeConnectionOptions,
} from '@core/services/natsJetStreamPublisher.service';
import {
  WorkerCommandEpochError,
  WorkerCommandEpochService,
  type WorkerCommandEpochGuard,
} from '@core/services/workerCommandEpoch.service';
import {
  WorkerCommandLaneService,
  WorkerCommandPredecessorPendingError,
  type WorkerCommandLaneClaimDisposition,
  type WorkerCommandLaneTerminalState,
} from '@core/services/workerCommandLane.service';
import {
  WorkerCommandFailurePublisherService,
  type WorkerCommandFailureCode,
} from '@core/services/workerCommandFailurePublisher.service';
import { isWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { runWithWorkerCommandExecutionOutcome } from '@core/common/functions/workerCommandExecutionOutcome';
import {
  WorkerCommandDeferredExpiredError,
  WorkerCommandDeferredParkerService,
} from '@core/services/workerCommandDeferredParker.service';

const ACK_WAIT_MS = 5 * 60 * 1000;
const MAX_ACK_PENDING = 128;
const MAX_BATCH = 64;
const PROGRESS_INTERVAL_MS = 15_000;
const LANE_RECHECK_DELAY_MS = 1_000;
const LANE_WAIT_POLL_MS = 100;
const DELIVERY_BACKOFF_MS = [
  1_000, 3_000, 10_000, 30_000, 60_000, 120_000,
] as const;
const MAX_TECHNICAL_RETRIES = DELIVERY_BACKOFF_MS.length;
const UNLIMITED_BROKER_DELIVERIES = -1;

export interface WorkerCommandIngressHandlerInput {
  commandId: string;
  operationId: string;
  entityKey: string;
  entitySequence: number;
  payload: unknown;
  assertActive: () => void;
}

export type WorkerCommandIngressHandler = (
  input: WorkerCommandIngressHandlerInput
) => Promise<void>;

export interface WorkerCommandIngressHealthSnapshot {
  group_id: string;
  topics: string[];
  connected: boolean;
  consuming: boolean;
  assignments_ready: boolean;
  dispatch_authorized: boolean;
  unhealthy: boolean;
  stall_reason?: string;
  pending_count: number;
  restart_count: number;
  last_message_at: number;
  last_commit_at: number;
  last_progress_at: number;
  last_restart_at: number;
  last_error: string;
}

export interface WorkerCommandJetStreamIngressOptions {
  accountId: string;
  workerId: string;
  /** Session/runtime identity only; never persisted into command envelopes. */
  runtimeWriterEpoch: string;
  runtimeGeneration: number;
  handlers: Partial<Record<WorkerCommandType, WorkerCommandIngressHandler>>;
}

/**
 * A single, provider-neutral durable ingress for one worker. It multiplexes
 * all command types through one fair scheduler, preserving the lane order
 * across direct/schedule/notification/mark-read without coupling chats.
 */
export class WorkerCommandJetStreamIngressService {
  public readonly consumer: {
    __health: () => WorkerCommandIngressHealthSnapshot;
  };

  private connection: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private commandConsumer: Consumer | null = null;
  private messages: ConsumerMessages | null = null;
  private epochGuard: WorkerCommandEpochGuard | null = null;
  private scheduler: FairKeyedScheduler | null = null;
  private running = false;
  private generation = 0;
  private loop: Promise<void> | null = null;
  private restartCount = 0;
  private lastMessageAt = 0;
  private lastCommitAt = 0;
  private lastProgressAt = 0;
  private lastRestartAt = 0;
  private lastError = '';
  private pending = 0;

  constructor(
    private readonly options: WorkerCommandJetStreamIngressOptions,
    private readonly epochs: WorkerCommandEpochService,
    private readonly lanes: WorkerCommandLaneService,
    private readonly failures = new WorkerCommandFailurePublisherService(),
    private readonly deferredParker = new WorkerCommandDeferredParkerService()
  ) {
    this.consumer = { __health: () => this.health() };
  }

  public async execute(): Promise<void> {
    if (this.running) return;
    this.scheduler = new FairKeyedScheduler({ maxActiveLanes: 32 });
    const accountId = this.required(this.options.accountId, 'account_id');
    const workerId = this.required(this.options.workerId, 'worker_id');
    const runtimeWriterEpoch = this.required(
      this.options.runtimeWriterEpoch,
      'runtime_writer_epoch'
    );
    const subject = workerCommandSubject(workerId);

    const connectionOptions = natsJetStreamPublisherOptionsFromEnvironment();
    const connection = await connect(
      natsNodeConnectionOptions({
        ...connectionOptions,
        connectionName: `underchat-worker-command-ingress-${workerId}`,
      })
    );
    const js = jetstream(connection, { timeout: 5_000 });
    this.connection = connection;
    this.js = js;
    const manager = await jetstreamManager(connection, { timeout: 5_000 });
    const durable = workerCommandDurableName(workerId);
    let info;
    try {
      info = await manager.consumers.info(WORKER_COMMAND_STREAM, durable);
    } catch (error) {
      if (!this.isMissingConsumer(error)) throw error;
      info = await manager.consumers.add(WORKER_COMMAND_STREAM, {
        durable_name: durable,
        name: durable,
        description: 'Underchat worker command ingress v1',
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        replay_policy: ReplayPolicy.Instant,
        ack_wait: nanos(ACK_WAIT_MS),
        // BackOff is intentionally not configured: NATS uses its first value
        // as AckWait, which would turn our 1s retry delay into a 1s processing
        // lease. Long handlers use AckWait=5m + InProgress; explicit NAKs use
        // the six short retry delays below.
        // Lane/predecessor waits must not consume the six-failure budget.
        // MaxAge is the hard bound; technical retries are counted in Redis.
        max_deliver: UNLIMITED_BROKER_DELIVERIES,
        max_ack_pending: MAX_ACK_PENDING,
        max_batch: MAX_BATCH,
        max_waiting: 128,
        filter_subject: subject,
        num_replicas: 3,
      });
    }
    this.assertConsumerContract(info.config, durable, subject);
    const commandConsumer = await js.consumers.get(
      WORKER_COMMAND_STREAM,
      durable
    );
    await commandConsumer.info();

    // Bind and validate the durable before publishing the new runtime fence.
    // Ordinary recreate preserves the logical command epoch; draining/closed
    // values are terminal and are never reopened implicitly.
    const activeEpoch = await this.epochs.activateRuntime({
      accountId,
      workerId,
      runtimeWriterEpoch,
      runtimeGeneration: this.options.runtimeGeneration,
    });
    const originEpoch = activeEpoch.record.epoch;
    this.epochGuard = await this.epochs.watchActive(
      accountId,
      workerId,
      originEpoch,
      this.options.runtimeGeneration,
      runtimeWriterEpoch
    );
    const messages = await commandConsumer.consume({
      max_messages: MAX_BATCH,
      threshold_messages: 32,
      abort_on_missing_resource: true,
    });

    this.commandConsumer = commandConsumer;
    this.messages = messages;
    this.running = true;
    const generation = ++this.generation;
    this.loop = this.consume(messages, generation);
  }

  public async close(): Promise<void> {
    this.running = false;
    this.generation += 1;
    const messages = this.messages;
    this.messages = null;
    if (messages) await messages.close().catch(() => undefined);
    await this.loop?.catch(() => undefined);
    this.loop = null;
    const scheduler = this.scheduler;
    this.scheduler = null;
    await scheduler?.closeAndDrain();
    await this.epochGuard?.close().catch(() => undefined);
    this.epochGuard = null;
    const connection = this.connection;
    this.connection = null;
    this.js = null;
    this.commandConsumer = null;
    if (connection && !connection.isClosed()) await connection.drain();
    await this.failures.close();
  }

  public async restart(): Promise<void> {
    await this.close();
    this.restartCount += 1;
    this.lastRestartAt = Date.now();
    await this.execute();
  }

  private async consume(
    messages: ConsumerMessages,
    generation: number
  ): Promise<void> {
    try {
      for await (const message of messages) {
        if (!this.running || this.generation !== generation) break;
        this.pending += 1;
        this.lastMessageAt = Date.now();
        void this.process(message, generation)
          .catch((error: unknown) => {
            // A failure while publishing the operational failure event or
            // confirming AckSync must never become an unhandled rejection.
            // Request a bounded redelivery instead of waiting for AckWait
            // (five minutes, the same as MaxAge). If AckSync already won the
            // race this NAK is harmless; otherwise it preserves the remaining
            // realtime window and lets the failure publication recover.
            this.lastError = this.safeErrorCode(error);
            message.nak(LANE_RECHECK_DELAY_MS);
          })
          .finally(() => {
            this.pending = Math.max(0, this.pending - 1);
          });
      }
    } catch (error) {
      if (this.running && this.generation === generation) {
        this.lastError = this.safeErrorCode(error);
        this.running = false;
      }
    }
  }

  private async process(message: JsMsg, generation: number): Promise<void> {
    let envelope: WorkerCommandEnvelopeV1 | null = null;
    let progress: ReturnType<typeof setInterval> | null = null;
    let laneAcquired = false;
    let laneLeaseError: unknown = null;
    try {
      progress = setInterval(() => {
        if (!this.running || this.generation !== generation) {
          return;
        }
        message.working();
        this.lastProgressAt = Date.now();
        if (laneAcquired && envelope) {
          void this.lanes
            .renewActive(
              envelope.account_id,
              envelope.worker_id,
              envelope.entity_key,
              envelope.operation_id,
              envelope.command_id
            )
            .catch((error: unknown) => {
              laneLeaseError = error;
              this.lastError = this.safeErrorCode(error);
            });
        }
      }, PROGRESS_INTERVAL_MS);
      progress.unref?.();
      message.working();

      envelope = JSON.parse(message.string()) as WorkerCommandEnvelopeV1;
      assertWorkerCommandPublishable(envelope, Date.now());
      if (message.subject !== workerCommandSubject(this.options.workerId)) {
        return await this.failAndAck(
          message,
          envelope,
          'invalid_subject',
          new Error('invalid_subject')
        );
      }
      if (
        envelope.worker_id !== this.options.workerId ||
        envelope.account_id !== this.options.accountId
      ) {
        return await this.failAndAck(
          message,
          envelope,
          'invalid_target',
          new Error('invalid_target')
        );
      }
      await this.epochs.assertActive(
        envelope.account_id,
        envelope.worker_id,
        envelope.origin_epoch
      );
      await this.waitUntilDispatchAuthorized(message, generation, envelope);

      if (!(await this.waitForPredecessor(message, generation, envelope))) {
        return;
      }

      const laneDisposition = await this.waitForLaneOwnership(
        generation,
        envelope
      );
      if (laneDisposition.startsWith('duplicate')) {
        await this.recoverDuplicateFailure(message, envelope, laneDisposition);
        if (!(await message.ackAck({ timeout: 5_000 }))) {
          throw new Error('worker_command_duplicate_acksync_not_confirmed');
        }
        this.lastCommitAt = Date.now();
        return;
      }
      laneAcquired = true;

      const scheduler = this.scheduler;
      if (!scheduler) throw new Error('worker_command_scheduler_unavailable');
      const command = envelope;
      const executionOutcome = await scheduler.enqueue(
        command.entity_key,
        async () => {
          await this.waitUntilDispatchAuthorized(message, generation, command);
          if (laneLeaseError) throw laneLeaseError;
          this.assertRuntimeActive(generation, command);
          const handler = this.options.handlers[command.command_type];
          if (!handler)
            throw new WorkerCommandTerminalError('unsupported_command');
          const execution = await runWithWorkerCommandExecutionOutcome(
            () =>
              handler({
                commandId: command.command_id,
                operationId: command.operation_id,
                entityKey: command.entity_key,
                entitySequence: command.entity_sequence,
                payload: command.payload,
                assertActive: () => {
                  if (laneLeaseError) throw laneLeaseError;
                  this.assertRuntimeActive(generation, command);
                },
              }),
            {
              accountId: command.account_id,
              workerId: command.worker_id,
              entityKey: command.entity_key,
              operationId: command.operation_id,
              commandId: command.command_id,
            }
          );
          return execution.outcome ?? 'succeeded';
        }
      );
      if (executionOutcome !== 'succeeded') {
        const failureCode: WorkerCommandFailureCode =
          executionOutcome === 'ambiguous'
            ? 'ambiguous'
            : executionOutcome === 'expired'
              ? 'expired'
              : 'failed';
        return await this.failAndAck(
          message,
          envelope,
          failureCode,
          new Error(`worker_command_terminal_outcome:${executionOutcome}`),
          executionOutcome
        );
      }
      await this.finish(message, envelope, 'succeeded');
    } catch (error) {
      if (this.isExpired(error, envelope)) {
        if (envelope) {
          return await this.failAndAck(
            message,
            envelope,
            'expired',
            error,
            'expired'
          );
        }
        return await this.failAndAck(message, null, 'invalid_envelope', error);
      }
      if (
        error instanceof WorkerCommandEpochError &&
        error.code !== 'unavailable'
      ) {
        return await this.failAndAck(
          message,
          envelope,
          'epoch_rejected',
          error,
          'failed'
        );
      }
      if (this.isTerminal(error)) {
        return await this.failAndAck(
          message,
          envelope,
          'failed',
          error,
          'failed'
        );
      }
      if (laneAcquired && envelope) {
        await this.lanes.releaseActive(
          envelope.account_id,
          envelope.worker_id,
          envelope.entity_key,
          envelope.operation_id,
          envelope.command_id
        );
        laneAcquired = false;
      }
      if (!envelope) {
        return await this.failAndAck(message, null, 'invalid_envelope', error);
      }
      let technicalRetry: number;
      try {
        technicalRetry = await this.lanes.recordTechnicalRetry(
          envelope.account_id,
          envelope.worker_id,
          envelope.entity_key,
          envelope.operation_id,
          envelope.command_id
        );
      } catch (retryLedgerError) {
        // Redis is the fail-closed execution fence. If it is unavailable we
        // neither call the provider nor burn the operation's retry budget.
        this.lastError = this.safeErrorCode(retryLedgerError);
        message.nak(LANE_RECHECK_DELAY_MS);
        return;
      }
      if (technicalRetry > MAX_TECHNICAL_RETRIES) {
        return await this.failAndAck(
          message,
          envelope,
          'dead_letter',
          error,
          'failed'
        );
      }
      message.nak(this.retryDelay(technicalRetry));
    } finally {
      if (progress) clearInterval(progress);
    }
  }

  private async finish(
    message: JsMsg,
    envelope: WorkerCommandEnvelopeV1,
    state: WorkerCommandLaneTerminalState
  ): Promise<void> {
    await this.lanes.markTerminal(
      envelope.account_id,
      envelope.worker_id,
      envelope.entity_key,
      envelope.operation_id,
      envelope.command_id,
      state
    );
    if (!(await message.ackAck({ timeout: 5_000 }))) {
      throw new Error('worker_command_acksync_not_confirmed');
    }
    await this.lanes.clearTerminalTail(
      envelope.account_id,
      envelope.worker_id,
      envelope.entity_key,
      envelope.operation_id
    );
    this.lastCommitAt = Date.now();
    this.lastProgressAt = this.lastCommitAt;
  }

  private async failAndAck(
    message: JsMsg,
    envelope: WorkerCommandEnvelopeV1 | null,
    code: WorkerCommandFailureCode,
    error: unknown,
    terminalState?: WorkerCommandLaneTerminalState
  ): Promise<void> {
    if (envelope && terminalState) {
      await this.lanes.markTerminal(
        envelope.account_id,
        envelope.worker_id,
        envelope.entity_key,
        envelope.operation_id,
        envelope.command_id,
        terminalState,
        code
      );
    }
    await this.publishFailure(message, envelope, code, error);
    if (!(await message.ackAck({ timeout: 5_000 }))) {
      throw new Error('worker_command_acksync_not_confirmed');
    }
    if (envelope && terminalState) {
      await this.lanes.clearTerminalTail(
        envelope.account_id,
        envelope.worker_id,
        envelope.entity_key,
        envelope.operation_id
      );
    }
    this.lastCommitAt = Date.now();
  }

  private async recoverDuplicateFailure(
    message: JsMsg,
    envelope: WorkerCommandEnvelopeV1,
    disposition: WorkerCommandLaneClaimDisposition
  ): Promise<void> {
    const [, terminalState, storedCode] = disposition.split(':');
    if (
      (terminalState === 'failed' ||
        terminalState === 'expired' ||
        terminalState === 'ambiguous') &&
      this.isFailureCode(storedCode)
    ) {
      await this.publishFailure(
        message,
        envelope,
        storedCode,
        new Error(`worker_command_recovered_terminal:${storedCode}`)
      );
    }
  }

  private async publishFailure(
    message: JsMsg,
    envelope: WorkerCommandEnvelopeV1 | null,
    code: WorkerCommandFailureCode,
    error: unknown
  ): Promise<void> {
    await this.failures.publish({
      workerId: envelope?.worker_id ?? this.options.workerId,
      code,
      envelope,
      deliveryIdentity: `${WORKER_COMMAND_STREAM}:${message.seq}:${message.subject}`,
      rawPayloadDigest: createHash('sha256').update(message.data).digest('hex'),
      error,
    });
  }

  private assertRuntimeActive(
    generation: number,
    envelope: WorkerCommandEnvelopeV1
  ): void {
    this.assertIngressActive(generation, envelope);
    if (!isWorkerKafkaDispatchAuthorized()) {
      throw new Error('worker_command_dispatch_not_authorized');
    }
  }

  private assertIngressActive(
    generation: number,
    envelope: WorkerCommandEnvelopeV1
  ): void {
    if (!this.running || generation !== this.generation) {
      throw new Error('worker_command_ingress_revoked');
    }
    if (Date.now() >= Date.parse(envelope.deadline_at)) {
      throw new WorkerCommandExpiredError();
    }
    this.epochGuard?.assertActive();
  }

  private async waitUntilDispatchAuthorized(
    message: JsMsg,
    generation: number,
    envelope: WorkerCommandEnvelopeV1
  ): Promise<void> {
    while (!isWorkerKafkaDispatchAuthorized()) {
      this.assertIngressActive(generation, envelope);
      message.working();
      this.lastProgressAt = Date.now();
      await this.sleepLaneWait(envelope.deadline_at);
    }
    this.assertRuntimeActive(generation, envelope);
  }

  private async waitForPredecessor(
    message: JsMsg,
    generation: number,
    envelope: WorkerCommandEnvelopeV1
  ): Promise<boolean> {
    for (;;) {
      try {
        await this.lanes.assertPredecessorTerminal(
          envelope.account_id,
          envelope.worker_id,
          envelope.entity_key,
          envelope.operation_id,
          envelope.predecessor_operation_id
        );
        return true;
      } catch (error) {
        if (!(error instanceof WorkerCommandPredecessorPendingError)) {
          throw error;
        }
        if (workerCommandPredecessorWaitAction(error) === 'park') {
          const js = this.js;
          if (!js) {
            throw new Error('worker_command_deferred_client_unavailable');
          }
          await this.deferredParker.parkAndAckOriginal(js, message, envelope);
          this.lastCommitAt = Date.now();
          this.lastProgressAt = this.lastCommitAt;
          return false;
        }
        // Exactly one immediate successor of an ever-active predecessor stays
        // pending. It sends progress and polls Redis outside the fair scheduler
        // and provider semaphore. This neither consumes MaxDeliver nor adds the
        // previous one-second NAK/redelivery gap; deeper successors are parked.
        this.assertIngressActive(generation, envelope);
        await this.sleepLaneWait(envelope.deadline_at, LANE_WAIT_POLL_MS);
      }
    }
  }

  private async waitForLaneOwnership(
    generation: number,
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandLaneClaimDisposition> {
    for (;;) {
      const disposition = await this.lanes.markActive(
        envelope.account_id,
        envelope.worker_id,
        envelope.entity_key,
        envelope.operation_id,
        envelope.command_id
      );
      if (disposition !== 'busy') return disposition;
      this.assertIngressActive(generation, envelope);
      await this.sleepLaneWait(envelope.deadline_at, LANE_WAIT_POLL_MS);
    }
  }

  private assertConsumerContract(
    config: Record<string, unknown>,
    durable: string,
    subject: string
  ): void {
    if (
      config.durable_name !== durable ||
      config.name !== durable ||
      config.filter_subject !== subject ||
      config.ack_policy !== AckPolicy.Explicit ||
      config.deliver_policy !== DeliverPolicy.All ||
      config.replay_policy !== ReplayPolicy.Instant ||
      config.ack_wait !== nanos(ACK_WAIT_MS) ||
      config.max_deliver !== UNLIMITED_BROKER_DELIVERIES ||
      config.max_ack_pending !== MAX_ACK_PENDING ||
      config.max_batch !== MAX_BATCH ||
      config.max_waiting !== 128 ||
      config.num_replicas !== 3 ||
      (Array.isArray(config.backoff) && config.backoff.length > 0)
    ) {
      throw new Error(`worker_command_consumer_contract_drift:${durable}`);
    }
  }

  private retryDelay(technicalRetry: number): number {
    return DELIVERY_BACKOFF_MS[
      Math.min(technicalRetry - 1, DELIVERY_BACKOFF_MS.length - 1)
    ];
  }

  private async sleepLaneWait(
    deadlineAt: string,
    maximumDelayMs = LANE_RECHECK_DELAY_MS
  ): Promise<void> {
    const remaining = Date.parse(deadlineAt) - Date.now();
    if (remaining <= 0) throw new WorkerCommandExpiredError();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(maximumDelayMs, remaining));
      timer.unref?.();
    });
  }

  private isMissingConsumer(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'ConsumerNotFoundError' ||
        (error as Error & { code?: number }).code === 10014)
    );
  }

  private isExpired(
    error: unknown,
    envelope: WorkerCommandEnvelopeV1 | null
  ): boolean {
    return (
      error instanceof WorkerCommandExpiredError ||
      error instanceof WorkerCommandDeferredExpiredError ||
      (error instanceof Error &&
        error.name === 'WorkerCommandContractError' &&
        (error as Error & { code?: string }).code === 'expired_command') ||
      Boolean(envelope && Date.now() >= Date.parse(envelope.deadline_at))
    );
  }

  private isTerminal(error: unknown): boolean {
    return (
      error instanceof WorkerCommandTerminalError ||
      (error instanceof Error &&
        (error as Error & { nonRetryable?: boolean }).nonRetryable === true)
    );
  }

  private isFailureCode(value: string): value is WorkerCommandFailureCode {
    return [
      'invalid_envelope',
      'invalid_subject',
      'invalid_target',
      'expired',
      'epoch_rejected',
      'dead_letter',
      'ambiguous',
      'failed',
    ].includes(value as WorkerCommandFailureCode);
  }

  private health(): WorkerCommandIngressHealthSnapshot {
    const connected = Boolean(this.connection && !this.connection.isClosed());
    const assignmentsReady =
      this.running &&
      connected &&
      Boolean(this.epochGuard) &&
      Boolean(this.commandConsumer) &&
      Boolean(this.messages);
    const authorized = assignmentsReady && isWorkerKafkaDispatchAuthorized();
    return {
      group_id: workerCommandDurableName(this.options.workerId),
      topics: [workerCommandSubject(this.options.workerId)],
      connected,
      consuming: this.running,
      assignments_ready: assignmentsReady,
      dispatch_authorized: authorized,
      unhealthy: !assignmentsReady,
      ...(assignmentsReady
        ? authorized
          ? {}
          : { stall_reason: 'awaiting_dispatch_authorization' }
        : { stall_reason: this.lastError || 'command_ingress_not_ready' }),
      pending_count: this.pending,
      restart_count: this.restartCount,
      last_message_at: this.lastMessageAt,
      last_commit_at: this.lastCommitAt,
      last_progress_at: this.lastProgressAt,
      last_restart_at: this.lastRestartAt,
      last_error: this.lastError,
    };
  }

  private required(value: string, name: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`worker_command_${name}_required`);
    return normalized;
  }

  private safeErrorCode(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown_error';
  }
}

export function workerCommandDurableName(workerId: string): string {
  const digest = createHash('sha256').update(workerId.trim()).digest('hex');
  return `uc_worker_${digest.slice(0, 32)}`;
}

export function workerCommandPredecessorWaitAction(
  error: WorkerCommandPredecessorPendingError
): 'park' | 'wait' {
  return error.predecessorEverActive ? 'wait' : 'park';
}

export class WorkerCommandExpiredError extends Error {
  constructor() {
    super('worker_command_expired');
    this.name = 'WorkerCommandExpiredError';
  }
}

export class WorkerCommandTerminalError extends Error {
  public readonly nonRetryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'WorkerCommandTerminalError';
  }
}

export const WORKER_COMMAND_INGRESS_POLICY = Object.freeze({
  ackWaitMs: ACK_WAIT_MS,
  maxAckPending: MAX_ACK_PENDING,
  maxBatch: MAX_BATCH,
  progressIntervalMs: PROGRESS_INTERVAL_MS,
  maxAgeMs: WORKER_COMMAND_MAX_AGE_MS,
  redeliveryBackoffMs: DELIVERY_BACKOFF_MS,
  maxTechnicalRetries: MAX_TECHNICAL_RETRIES,
  brokerMaxDeliveries: UNLIMITED_BROKER_DELIVERIES,
  laneRecheckDelayMs: LANE_RECHECK_DELAY_MS,
  laneWaitPollMs: LANE_WAIT_POLL_MS,
});
