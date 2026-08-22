import { createHash } from 'node:crypto';
import {
  AckPolicy,
  DeliverPolicy,
  PubHeaders,
  ReplayPolicy,
  jetstream,
  jetstreamManager,
  type Consumer,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
  type PubAck,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import {
  connect,
  type NatsConnection,
  type NodeConnectionOptions,
} from '@nats-io/transport-node';
import {
  WORKER_COMMAND_MAX_BYTES,
  WORKER_COMMAND_STREAM,
  WORKER_DEFERRED_PUBACK_TIMEOUT_MS,
  WORKER_DEFERRED_READY_SUBJECT_WILDCARD,
  WORKER_DEFERRED_RELAY_DURABLE,
  WORKER_DEFERRED_STREAM,
} from '@core/common/constants/workerCommandTransport';
import {
  parseWorkerCommandDeferredReadySubject,
  parseWorkerCommandDeferredScheduleSubject,
} from '@core/common/functions/workerCommandDeferred';
import {
  assertWorkerCommandPublishable,
  WorkerCommandContractError,
  workerCommandSubject,
} from '@core/common/functions/workerCommandEnvelope';
import type { WorkerCommandEnvelopeV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';
import { natsNodeConnectionOptions } from '@core/services/natsJetStreamPublisher.service';
import { workerCommandControlPlaneOptionsFromEnvironment } from '@core/services/workerCommandJetStreamControlPlane.service';
import {
  WorkerCommandFailurePublisherService,
  type WorkerCommandFailureCode,
} from '@core/services/workerCommandFailurePublisher.service';
import { WorkerCommandOperationalBarrierService } from '@core/services/workerCommandOperationalBarrier.service';
import { workerCommandTelemetryStore } from '@core/services/workerCommandTelemetryStore';

const ACK_WAIT_MS = 30_000;
const MAX_ACK_PENDING = 512;
const MAX_BATCH = 128;
const MAX_WAITING = 128;
const MAX_DELIVER = -1;
const NAK_DELAY_MS = 1_000;

interface WorkerCommandDeferredRelayDependencies {
  connect(options: NodeConnectionOptions): Promise<NatsConnection>;
  jetstream(connection: NatsConnection): JetStreamClient;
  manager(connection: NatsConnection): Promise<JetStreamManager>;
  now(): number;
}

const DEFAULT_DEPENDENCIES: WorkerCommandDeferredRelayDependencies = {
  connect,
  jetstream: (connection) =>
    jetstream(connection, { timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS }),
  manager: (connection) =>
    jetstreamManager(connection, {
      timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS,
    }),
  now: Date.now,
};

export interface WorkerCommandDeferredRelayHealth {
  connected: boolean;
  running: boolean;
  pending: number;
  last_message_at: number;
  last_commit_at: number;
  last_error: string;
}

/**
 * Singleton control-plane relay for one-shot ready messages. Command bytes
 * remain exclusively in JetStream; Redis is not part of the payload path.
 */
export class WorkerCommandDeferredRelayService {
  private connection: NatsConnection | null = null;
  private client: JetStreamClient | null = null;
  private consumer: Consumer | null = null;
  private messages: ConsumerMessages | null = null;
  private loop: Promise<void> | null = null;
  private readonly inFlight = new Set<Promise<void>>();
  private running = false;
  private lastMessageAt = 0;
  private lastCommitAt = 0;
  private lastError = '';

  constructor(
    private readonly dependencies: WorkerCommandDeferredRelayDependencies = DEFAULT_DEPENDENCIES,
    private readonly failures = new WorkerCommandFailurePublisherService(),
    private readonly barrier?: WorkerCommandOperationalBarrierService
  ) {}

  public async execute(): Promise<void> {
    await this.operationalBarrier().runWithPermit('deferred_relay_start', () =>
      this.executeWhileOpen()
    );
  }

  private async executeWhileOpen(): Promise<void> {
    if (this.running) return;
    if (this.connection) await this.close();
    const options = workerCommandControlPlaneOptionsFromEnvironment();
    const connection = await this.dependencies.connect(
      natsNodeConnectionOptions({
        ...options,
        connectionName: 'underchat-worker-command-deferred-relay',
      })
    );
    try {
      const client = this.dependencies.jetstream(connection);
      const manager = await this.dependencies.manager(connection);
      let info;
      try {
        info = await manager.consumers.info(
          WORKER_DEFERRED_STREAM,
          WORKER_DEFERRED_RELAY_DURABLE
        );
      } catch (error) {
        if (!this.isMissingConsumer(error)) throw error;
        info = await manager.consumers.add(WORKER_DEFERRED_STREAM, {
          durable_name: WORKER_DEFERRED_RELAY_DURABLE,
          name: WORKER_DEFERRED_RELAY_DURABLE,
          description: 'Underchat deferred worker-command relay v1',
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
          replay_policy: ReplayPolicy.Instant,
          ack_wait: nanos(ACK_WAIT_MS),
          max_deliver: MAX_DELIVER,
          max_ack_pending: MAX_ACK_PENDING,
          max_batch: MAX_BATCH,
          max_waiting: MAX_WAITING,
          filter_subject: WORKER_DEFERRED_READY_SUBJECT_WILDCARD,
          num_replicas: 3,
        });
      }
      this.assertConsumerContract(info.config);
      const consumer = await client.consumers.get(
        WORKER_DEFERRED_STREAM,
        WORKER_DEFERRED_RELAY_DURABLE
      );
      await consumer.info();
      const messages = await consumer.consume({
        max_messages: MAX_BATCH,
        threshold_messages: MAX_BATCH / 2,
        abort_on_missing_resource: true,
      });

      this.connection = connection;
      this.client = client;
      this.consumer = consumer;
      this.messages = messages;
      this.running = true;
      this.lastError = '';
      this.loop = this.consume(messages, client);
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.running = false;
    const messages = this.messages;
    this.messages = null;
    if (messages) await messages.close().catch(() => undefined);
    await this.loop?.catch(() => undefined);
    this.loop = null;
    await Promise.allSettled([...this.inFlight]);
    const connection = this.connection;
    this.connection = null;
    this.client = null;
    this.consumer = null;
    if (connection && !connection.isClosed()) await connection.drain();
    await this.failures.close();
  }

  public health(): WorkerCommandDeferredRelayHealth {
    return {
      connected: Boolean(this.connection && !this.connection.isClosed()),
      running: this.running,
      pending: this.inFlight.size,
      last_message_at: this.lastMessageAt,
      last_commit_at: this.lastCommitAt,
      last_error: this.lastError,
    };
  }

  /** Exposed for contract tests; production calls it from the durable loop. */
  public async relayReadyMessage(
    message: JsMsg,
    client: JetStreamClient
  ): Promise<void> {
    await this.operationalBarrier().runWithPermit('deferred_relay', () =>
      this.relayReadyMessageWhileOpen(message, client)
    );
  }

  private async relayReadyMessageWhileOpen(
    message: JsMsg,
    client: JetStreamClient
  ): Promise<void> {
    workerCommandTelemetryStore.recordDeferred('received');
    const workerId = parseWorkerCommandDeferredReadySubject(message.subject);
    if (!workerId) {
      return this.failAndAck(
        message,
        'unknown',
        null,
        'invalid_subject',
        new Error('worker_command_deferred_ready_subject_invalid')
      );
    }

    let envelope: WorkerCommandEnvelopeV1 | null = null;
    try {
      if (message.data.byteLength > WORKER_COMMAND_MAX_BYTES) {
        throw new Error('worker_command_deferred_ready_payload_too_large');
      }
      envelope = JSON.parse(message.string()) as WorkerCommandEnvelopeV1;
      assertWorkerCommandPublishable(envelope, this.dependencies.now());
    } catch (error) {
      const expired =
        error instanceof WorkerCommandContractError &&
        error.code === 'expired_command';
      return this.failAndAck(
        message,
        workerId,
        envelope,
        expired ? 'expired' : 'invalid_envelope',
        error
      );
    }

    if (envelope.worker_id !== workerId) {
      return this.failAndAck(
        message,
        workerId,
        envelope,
        'invalid_target',
        new Error('worker_command_deferred_ready_target_mismatch')
      );
    }
    const schedulerSubject = message.headers?.get(PubHeaders.Scheduler) ?? '';
    const identity = parseWorkerCommandDeferredScheduleSubject(
      schedulerSubject,
      workerId
    );
    if (!identity) {
      return this.failAndAck(
        message,
        workerId,
        envelope,
        'invalid_envelope',
        new Error('worker_command_deferred_scheduler_identity_invalid')
      );
    }

    const ack = await client.publish(
      workerCommandSubject(workerId),
      message.data,
      {
        msgID: identity.relayMessageId,
        expect: { streamName: WORKER_COMMAND_STREAM },
        timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS,
        retries: 0,
      }
    );
    this.assertCommandPubAck(ack);
    await this.ackSync(message);
    workerCommandTelemetryStore.recordDeferred('relayed');
  }

  private async consume(
    messages: ConsumerMessages,
    client: JetStreamClient
  ): Promise<void> {
    try {
      for await (const message of messages) {
        if (!this.running) break;
        this.lastMessageAt = this.dependencies.now();
        const task = this.relayReadyMessage(message, client)
          .then(() => {
            this.lastCommitAt = this.dependencies.now();
            this.lastError = '';
          })
          .catch((error: unknown) => {
            this.lastError = error instanceof Error ? error.name : 'unknown';
            workerCommandTelemetryStore.recordDeferred('technical_retry');
            message.nak(NAK_DELAY_MS);
          })
          .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
      }
    } catch (error) {
      if (this.running) {
        this.lastError = error instanceof Error ? error.name : 'unknown';
        this.running = false;
      }
    }
  }

  private async failAndAck(
    message: JsMsg,
    workerId: string,
    envelope: WorkerCommandEnvelopeV1 | null,
    code: WorkerCommandFailureCode,
    error: unknown
  ): Promise<void> {
    await this.failures.publish({
      workerId,
      code,
      envelope,
      deliveryIdentity: `${WORKER_DEFERRED_STREAM}:${message.seq}:${message.subject}`,
      rawPayloadDigest: createHash('sha256').update(message.data).digest('hex'),
      error,
    });
    await this.ackSync(message);
    workerCommandTelemetryStore.recordDeferred('terminal_failure');
  }

  private async ackSync(message: JsMsg): Promise<void> {
    if (
      !(await message.ackAck({ timeout: WORKER_DEFERRED_PUBACK_TIMEOUT_MS }))
    ) {
      throw new Error('worker_command_deferred_ready_acksync_not_confirmed');
    }
  }

  private assertCommandPubAck(ack: PubAck): void {
    if (
      ack.stream !== WORKER_COMMAND_STREAM ||
      !Number.isSafeInteger(ack.seq) ||
      ack.seq < 1 ||
      typeof ack.duplicate !== 'boolean'
    ) {
      throw new Error('worker_command_deferred_command_puback_invalid');
    }
  }

  private assertConsumerContract(config: Record<string, unknown>): void {
    if (
      config.durable_name !== WORKER_DEFERRED_RELAY_DURABLE ||
      config.name !== WORKER_DEFERRED_RELAY_DURABLE ||
      config.filter_subject !== WORKER_DEFERRED_READY_SUBJECT_WILDCARD ||
      config.ack_policy !== AckPolicy.Explicit ||
      config.deliver_policy !== DeliverPolicy.All ||
      config.replay_policy !== ReplayPolicy.Instant ||
      config.ack_wait !== nanos(ACK_WAIT_MS) ||
      config.max_deliver !== MAX_DELIVER ||
      config.max_ack_pending !== MAX_ACK_PENDING ||
      config.max_batch !== MAX_BATCH ||
      config.max_waiting !== MAX_WAITING ||
      config.num_replicas !== 3 ||
      (Array.isArray(config.backoff) && config.backoff.length > 0)
    ) {
      throw new Error('worker_command_deferred_relay_consumer_contract_drift');
    }
  }

  private isMissingConsumer(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'ConsumerNotFoundError' ||
        (error as Error & { code?: number }).code === 10014)
    );
  }

  private operationalBarrier(): WorkerCommandOperationalBarrierService {
    if (!this.barrier) {
      throw new Error('worker_command_operational_barrier_required');
    }
    return this.barrier;
  }
}
