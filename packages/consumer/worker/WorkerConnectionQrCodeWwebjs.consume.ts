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

@singleton()
export class WorkerConnectionQrCodeWwebjsConsume {
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

    return Boolean(
      health?.connected && health.consuming && health.topics.includes(topic)
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
        worker_id: wwebjsEnvironment.wwebjsWorkerId,
        account_id: wwebjsEnvironment.wwebjsAccountId,
      });
      await this.commitNext(topic, partition, offset);
      return;
    }

    const active = await this.isActiveAttempt(data);
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
      await this.workerConnectionStatusWwebjsConsume.requestConnection({
        worker_id: data.worker_id,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        qr_pending: true,
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

      await this.markProcessed(data);
      await this.commitNext(topic, partition, offset);
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
      data.account_id === wwebjsEnvironment.wwebjsAccountId
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
    data: IWorkerConnectionQrCodeQueueMessage
  ): Promise<boolean> {
    const processed = await this.redis.get(this.processedAttemptKey(data));
    if (processed) {
      return false;
    }

    const raw = await this.redis.get(this.activeAttemptKey(data.worker_id));
    if (!raw) {
      return false;
    }

    try {
      const parsed = JSON.parse(raw) as ActiveQrAttemptEnvelope;
      return parsed.ack?.connection_attempt_id === data.connection_attempt_id;
    } catch {
      return false;
    }
  }

  private async markProcessed(
    data: IWorkerConnectionQrCodeQueueMessage
  ): Promise<void> {
    await this.redis.set(this.processedAttemptKey(data), '1', 'EX', 300);
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
