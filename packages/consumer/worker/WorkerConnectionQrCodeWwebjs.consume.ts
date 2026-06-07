import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer, MessageHeader } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { commitOffset } from '@core/common/functions/commitOffset';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { WorkerConnectionQrCodeReadinessService } from '@core/services/workerConnectionQrCodeReadiness.service';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import { runWithKafkaTraceContext } from '@core/plugins/telemetry/messageLifecycleDebug';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { getManagedKafkaConsumerHealthSnapshot } from '@core/common/functions/kafkaConsumerHealth';
import Redis from 'ioredis';

interface ActiveQrAttemptEnvelope {
  ack?: {
    connection_attempt_id?: string;
  };
}

interface QrCodeQueueMessageContext {
  topic: string;
  groupId: string;
  partition: number;
  offset: number;
}

@singleton()
export class WorkerConnectionQrCodeWwebjsConsume {
  private static readonly ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS = 1_000;
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private stopReadinessHeartbeat: (() => void) | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(WorkerConnectionStatusWwebjsConsume)
    private readonly workerConnectionStatusWwebjsConsume: WorkerConnectionStatusWwebjsConsume,
    @inject(WorkerConnectionQrCodeReadinessService)
    private readonly readinessService: WorkerConnectionQrCodeReadinessService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(
    value: Buffer | null
  ): IWorkerConnectionQrCodeQueueMessage | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString()
      ) as IWorkerConnectionQrCodeQueueMessage;
      if (
        !parsed?.worker_id ||
        !parsed?.account_id ||
        !parsed?.connection_attempt_id ||
        !parsed?.connection_lifecycle_id
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const topic =
      this.kafkaBaileysQueueService.workerConnectionQrCode(workerId);
    const groupId = `group-underchat-wwebjs-connection-qrcode-${workerId}`;

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(this.kafka, groupId);

    this.consumer.on('data', async (message) => {
      await this.handleMessage(topic, groupId, message);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
      this.stopReadinessHeartbeat = this.readinessService.startHeartbeat(
        {
          worker_id: workerId,
          account_id: wwebjsEnvironment.wwebjsAccountId,
          worker_type_id: EWorkerType.wwebjs,
          topic,
          group_id: groupId,
        },
        {
          isHealthy: () => this.isConsumerReadyForTopic(topic),
        }
      );
    });
  }

  private isConsumerReadyForTopic(topic: string): boolean {
    const health = getManagedKafkaConsumerHealthSnapshot(this.consumer);

    const assignedTopics = health?.assigned_topics;
    const hasAssignment =
      !Array.isArray(assignedTopics) || assignedTopics.includes(topic);

    return Boolean(
      health?.connected &&
      health.consuming &&
      health.topics.includes(topic) &&
      hasAssignment
    );
  }

  private async handleMessage(
    topic: string,
    groupId: string,
    message: {
      value: Buffer | null;
      partition: number;
      offset: number;
      headers?: MessageHeader[];
    }
  ): Promise<void> {
    const data = this.parseMessage(message.value);
    if (!data) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.invalid_payload',
        decision: 'parse_connection_qrcode_request',
        outcome: 'ignored',
        reason: message.value ? 'invalid_payload' : 'empty_payload',
        level: 'warn',
        topic,
        group_id: groupId,
        partition: message.partition,
        offset: message.offset,
      });
      await this.commitNext(topic, message.partition, message.offset);
      return;
    }

    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: data.connection_lifecycle_id,
      account_id: data.account_id,
      worker_id: data.worker_id,
      channel_id: data.worker_id,
      worker_type: EWorkerType.wwebjs,
      source_provider: 'wwebjs',
      connection_type: EBaileysConnectionType.qrcode,
      connection_action: 'consume_qrcode_request',
    });

    await runWithKafkaTraceContext(message.headers, () =>
      runWithConnectionLifecycleContext(contextData, () =>
        this.processMessage(
          topic,
          groupId,
          data,
          message.partition,
          message.offset
        )
      )
    );
  }

  private async processMessage(
    topic: string,
    groupId: string,
    data: IWorkerConnectionQrCodeQueueMessage,
    partition: number,
    offset: number
  ): Promise<void> {
    const queueLatencyMs = this.getQueueLatencyMs(data);

    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_queue.received',
      decision: 'consume_connection_qrcode_request',
      outcome: 'received',
      topic,
      group_id: groupId,
      partition,
      offset,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      source: data.source,
      requested_at: data.requested_at,
      queue_latency_ms: queueLatencyMs,
    });

    if (!this.isMessageForThisWorker(data)) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.ignored_foreign',
        decision: 'validate_connection_qrcode_request_scope',
        outcome: 'ignored',
        reason: 'worker_or_account_mismatch',
        level: 'warn',
        topic,
        group_id: groupId,
        partition,
        offset,
        request_worker_id: data.worker_id,
        request_account_id: data.account_id,
        request_worker_type_id: data.worker_type_id,
        worker_id: wwebjsEnvironment.wwebjsWorkerId,
        account_id: wwebjsEnvironment.wwebjsAccountId,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
      });
      await this.commitNext(topic, partition, offset);
      return;
    }

    const active = await this.isActiveAttempt(data, {
      topic,
      groupId,
      partition,
      offset,
    });
    if (!active) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.ignored_stale',
        decision: 'validate_active_connection_attempt',
        outcome: 'ignored',
        reason: 'stale_or_duplicate_connection_attempt',
        level: 'warn',
        topic,
        group_id: groupId,
        partition,
        offset,
        connection_attempt_id: data.connection_attempt_id,
      });
      await this.commitNext(topic, partition, offset);
      return;
    }

    const heartbeat = async () => {
      this.consumer?.commit();
    };
    const stop = startHeartbeat(heartbeat);

    try {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.local_request_start',
        decision: 'request_local_connection_qrcode',
        outcome: 'started',
        topic,
        group_id: groupId,
        partition,
        offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        requested_at: data.requested_at,
        queue_latency_ms: queueLatencyMs,
      });
      const state =
        await this.workerConnectionStatusWwebjsConsume.requestConnection({
          worker_id: data.worker_id,
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: data.connection_attempt_id,
          connection_lifecycle_id: data.connection_lifecycle_id,
          qr_pending: true,
        });
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.local_request_success',
        decision: 'request_local_connection_qrcode',
        outcome: 'success',
        topic,
        group_id: groupId,
        partition,
        offset,
        status: state.status,
        code: state.code,
        worker_status_id: state.worker_status_id,
        connection_attempt_id:
          state.connection_attempt_id ?? data.connection_attempt_id,
        connection_lifecycle_id:
          state.connection_lifecycle_id ?? data.connection_lifecycle_id,
        requested_at: data.requested_at,
        queue_latency_ms: queueLatencyMs,
        has_qr: Boolean(state.qrcode),
        has_pairing_code: Boolean(state.pairing_code),
        qr_pending: state.qr_pending === true,
        reason: state.reason,
        time_to_first_qr_ms: state.time_to_first_qr_ms,
      });

      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.processed',
        decision: 'request_local_connection_qrcode',
        outcome: 'processed',
        topic,
        group_id: groupId,
        partition,
        offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        requested_at: data.requested_at,
        queue_latency_ms: queueLatencyMs,
      });

      await this.markProcessed(data, {
        topic,
        groupId,
        partition,
        offset,
      });
      await this.commitNext(topic, partition, offset);
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.commit_success',
        decision: 'commit_connection_qrcode_request',
        outcome: 'success',
        topic,
        group_id: groupId,
        partition,
        offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.process_error',
        decision: 'request_local_connection_qrcode',
        outcome: 'error',
        reason: 'local_connection_request_failed',
        level: 'error',
        topic,
        group_id: groupId,
        partition,
        offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      stop();
    }
  }

  private isMessageForThisWorker(
    data: IWorkerConnectionQrCodeQueueMessage
  ): boolean {
    return (
      data.worker_id === wwebjsEnvironment.wwebjsWorkerId &&
      data.account_id === wwebjsEnvironment.wwebjsAccountId &&
      data.worker_type_id === EWorkerType.wwebjs
    );
  }

  private getQueueLatencyMs(
    data: IWorkerConnectionQrCodeQueueMessage
  ): number | undefined {
    const requestedAtMs = Date.parse(data.requested_at);
    if (!Number.isFinite(requestedAtMs)) {
      return undefined;
    }

    return Math.max(0, Date.now() - requestedAtMs);
  }

  private activeAttemptKey(workerId: string): string {
    return `connection:qrcode:${workerId}:active_attempt`;
  }

  private processedAttemptKey(
    data: IWorkerConnectionQrCodeQueueMessage
  ): string {
    return `connection:qrcode:${data.worker_id}:processed:${data.connection_attempt_id}`;
  }

  private async isActiveAttempt(
    data: IWorkerConnectionQrCodeQueueMessage,
    context: QrCodeQueueMessageContext
  ): Promise<boolean> {
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_queue.active_attempt_check_start',
      decision: 'validate_active_connection_attempt',
      outcome: 'started',
      topic: context.topic,
      group_id: context.groupId,
      partition: context.partition,
      offset: context.offset,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
    });

    if (!this.isRedisReady()) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.active_attempt_check_error',
        decision: 'validate_active_connection_attempt',
        outcome: 'error',
        reason: 'redis_not_ready',
        level: 'warn',
        topic: context.topic,
        group_id: context.groupId,
        partition: context.partition,
        offset: context.offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
        redis_status: (this.redis as unknown as { status?: string }).status,
      });
      return true;
    }

    try {
      const processed = await this.redisGetWithTimeout(
        this.processedAttemptKey(data),
        'processed_attempt'
      );
      if (processed) {
        this.logActiveAttemptCheckResult(data, context, {
          active: false,
          reason: 'already_processed_attempt',
        });
        return false;
      }

      const raw = await this.redisGetWithTimeout(
        this.activeAttemptKey(data.worker_id),
        'active_attempt'
      );
      if (!raw) {
        this.logActiveAttemptCheckResult(data, context, {
          active: false,
          reason: 'active_attempt_missing',
        });
        return false;
      }

      try {
        const parsed = JSON.parse(raw) as ActiveQrAttemptEnvelope;
        const active =
          parsed.ack?.connection_attempt_id === data.connection_attempt_id;
        this.logActiveAttemptCheckResult(data, context, {
          active,
          reason: active ? 'active_attempt_matches' : 'active_attempt_mismatch',
          active_connection_attempt_id: parsed.ack?.connection_attempt_id,
        });
        return active;
      } catch (error) {
        this.logActiveAttemptCheckResult(data, context, {
          active: false,
          reason: 'active_attempt_parse_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.active_attempt_check_error',
        decision: 'validate_active_connection_attempt',
        outcome: 'error',
        reason: 'active_attempt_validation_unavailable',
        level: 'warn',
        topic: context.topic,
        group_id: context.groupId,
        partition: context.partition,
        offset: context.offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  private logActiveAttemptCheckResult(
    data: IWorkerConnectionQrCodeQueueMessage,
    context: QrCodeQueueMessageContext,
    result: {
      active: boolean;
      reason: string;
      active_connection_attempt_id?: string;
      error?: string;
    }
  ): void {
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_queue.active_attempt_check_result',
      decision: 'validate_active_connection_attempt',
      outcome: result.active ? 'active' : 'ignored',
      reason: result.reason,
      level: result.active ? 'info' : 'warn',
      topic: context.topic,
      group_id: context.groupId,
      partition: context.partition,
      offset: context.offset,
      connection_attempt_id: data.connection_attempt_id,
      active_connection_attempt_id: result.active_connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
      error: result.error,
    });
  }

  private async redisGetWithTimeout(
    key: string,
    operation: string
  ): Promise<string | null> {
    return this.runRedisWithTimeout(`GET ${operation}`, () =>
      this.redis.get(key)
    );
  }

  private async markProcessed(
    data: IWorkerConnectionQrCodeQueueMessage,
    context: QrCodeQueueMessageContext
  ): Promise<void> {
    try {
      await this.runRedisWithTimeout('SET processed_attempt', () =>
        this.redis.set(this.processedAttemptKey(data), '1', 'EX', 300)
      );
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.mark_processed_success',
        decision: 'mark_qrcode_attempt_processed',
        outcome: 'success',
        topic: context.topic,
        group_id: context.groupId,
        partition: context.partition,
        offset: context.offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_queue.mark_processed_error',
        decision: 'mark_qrcode_attempt_processed',
        outcome: 'error',
        reason: 'redis_unavailable',
        level: 'warn',
        topic: context.topic,
        group_id: context.groupId,
        partition: context.partition,
        offset: context.offset,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private isRedisReady(): boolean {
    return (this.redis as unknown as { status?: string }).status === 'ready';
  }

  private runRedisWithTimeout<T>(
    operation: string,
    action: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          new Error(
            `Redis ${operation} timeout after ${WorkerConnectionQrCodeWwebjsConsume.ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS}ms`
          )
        );
      }, WorkerConnectionQrCodeWwebjsConsume.ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS);

      const finish = (): boolean => {
        if (settled) {
          return false;
        }
        settled = true;
        clearTimeout(timeout);
        return true;
      };

      const succeed = (value: T): void => {
        if (finish()) {
          resolve(value);
        }
      };

      const fail = (error: unknown): void => {
        if (finish()) {
          reject(error);
        }
      };

      try {
        action().then(succeed, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  public async close(): Promise<void> {
    this.stopReadinessHeartbeat?.();
    this.stopReadinessHeartbeat = null;

    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
  }
}
