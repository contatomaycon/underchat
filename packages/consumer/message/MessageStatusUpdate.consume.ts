import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import Redis from 'ioredis';
import { logger } from '@core/plugins/telemetry/logger';
import {
  incrementCounter,
  recordHistogram,
} from '@core/plugins/telemetry/observability';

interface BufferedUpdate {
  data: IMessageStatusUpdate;
  partition: number;
  offset: number;
  topic: string;
}

@singleton()
export class MessageStatusUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();
  private failedPartitions = new Set<number>();
  private partitionFailureCounts = new Map<number, number>();
  private readonly idempotencyTtlSeconds = 86400;
  private readonly idempotencyPrefix = 'status-update:';
  private readonly batchWindowMs = 50;
  private readonly batchMaxSize = 20;
  private readonly maxConsecutiveFailures = 10;
  private readonly partitionRecoveryIntervalMs = 60_000;
  private readonly missingStatusRetryIntervalMs = 1_000;
  private partitionRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  private missingStatusRetryTimer: ReturnType<typeof setInterval> | null = null;
  private currentTopic: string | null = null;

  private messagePatchBuffer = new Map<string, BufferedUpdate[]>();
  private batchTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IMessageStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageStatusUpdate;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessageStatus();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.currentTopic = topic;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-status-update'
    );

    this.startPartitionRecovery();
    this.startMissingStatusRetryWorker();

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;
      if (this.failedPartitions.has(partition)) {
        return;
      }

      const previousChain = (
        this.partitionChains.get(partition) ?? Promise.resolve()
      ).catch(() => undefined);

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.addToBatch(data, topic, partition, offset);
        } catch (error) {
          this.markPartitionAsFailed(topic, partition, error, {
            account_id: data.account_id,
            message_id: data.message_id,
          });
          throw error;
        } finally {
          stop();
        }
      });

      this.partitionChains.set(partition, currentChain);
      void currentChain.catch(() => undefined);
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
    });
  }

  public async close(): Promise<void> {
    if (this.partitionRecoveryTimer) {
      clearInterval(this.partitionRecoveryTimer);
      this.partitionRecoveryTimer = null;
    }

    if (this.missingStatusRetryTimer) {
      clearInterval(this.missingStatusRetryTimer);
      this.missingStatusRetryTimer = null;
    }

    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();

    await this.flushAllBatches();

    await Promise.all(this.partitionChains.values());

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
      this.partitionChains.clear();
      this.failedPartitions.clear();
      this.partitionFailureCounts.clear();
      this.currentTopic = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    try {
      await commitOffset(this.consumerOrThrow, topic, partition, offset);
    } catch (error: unknown) {
      if (
        MessageStatusUpdateConsume.isLibrdKafkaError(error) &&
        MessageStatusUpdateConsume.isNonFatalCommitError(error.code)
      ) {
        return;
      }

      throw error;
    }
  }

  private static isLibrdKafkaError(error: unknown): error is LibrdKafkaError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'number'
    );
  }

  private static isNonFatalCommitError(code: number): boolean {
    return code === 22 || code === 25 || code === 27;
  }

  private markPartitionAsFailed(
    topic: string,
    partition: number,
    error: unknown,
    details?: { account_id?: string; message_id?: string }
  ): void {
    const currentCount = (this.partitionFailureCounts.get(partition) ?? 0) + 1;
    this.partitionFailureCounts.set(partition, currentCount);

    if (currentCount < this.maxConsecutiveFailures) {
      logger.warn(
        {
          err: error,
          topic,
          partition,
          consecutive_failures: currentCount,
          max_failures: this.maxConsecutiveFailures,
          account_id: details?.account_id,
          message_id: details?.message_id,
          type: 'message_status_update_partition_transient_failure',
        },
        `Transient failure on partition ${partition} (${currentCount}/${this.maxConsecutiveFailures}), will retry`
      );
      return;
    }

    if (this.failedPartitions.has(partition)) {
      return;
    }

    this.failedPartitions.add(partition);

    logger.error(
      {
        err: error,
        topic,
        partition,
        consecutive_failures: currentCount,
        account_id: details?.account_id,
        message_id: details?.message_id,
        type: 'message_status_update_partition_paused',
      },
      `Partition ${partition} paused after ${currentCount} consecutive failures (will auto-recover in ${this.partitionRecoveryIntervalMs / 1000}s)`
    );

    incrementCounter('message_status_update_partition_paused', 1, {
      partition: partition.toString(),
    });

    try {
      this.consumerOrThrow.pause([{ topic, partition }]);
    } catch (pauseError) {
      logger.error(
        {
          err: pauseError,
          topic,
          partition,
          type: 'message_status_update_partition_pause_error',
        },
        'Falha ao pausar partição após erro crítico'
      );
    }
  }

  private resetPartitionFailureCount(partition: number): void {
    if (this.partitionFailureCounts.has(partition)) {
      this.partitionFailureCounts.set(partition, 0);
    }
  }

  private startPartitionRecovery(): void {
    if (this.partitionRecoveryTimer) {
      clearInterval(this.partitionRecoveryTimer);
    }

    this.partitionRecoveryTimer = setInterval(() => {
      this.attemptPartitionRecovery();
    }, this.partitionRecoveryIntervalMs);
  }

  private attemptPartitionRecovery(): void {
    if (
      this.failedPartitions.size === 0 ||
      !this.consumer ||
      !this.currentTopic
    ) {
      return;
    }

    const partitionsToResume = Array.from(this.failedPartitions);

    for (const partition of partitionsToResume) {
      try {
        this.consumerOrThrow.resume([{ topic: this.currentTopic, partition }]);
        this.failedPartitions.delete(partition);
        this.partitionFailureCounts.set(partition, 0);

        logger.info(
          {
            topic: this.currentTopic,
            partition,
            remaining_paused: this.failedPartitions.size,
            type: 'message_status_update_partition_resumed',
          },
          `Partition ${partition} resumed after recovery interval`
        );

        incrementCounter('message_status_update_partition_resumed', 1, {
          partition: partition.toString(),
        });
      } catch (resumeError) {
        logger.error(
          {
            err: resumeError,
            topic: this.currentTopic,
            partition,
            type: 'message_status_update_partition_resume_error',
          },
          `Failed to resume partition ${partition}`
        );
      }
    }
  }

  private startMissingStatusRetryWorker(): void {
    if (this.missingStatusRetryTimer) {
      clearInterval(this.missingStatusRetryTimer);
    }

    this.missingStatusRetryTimer = setInterval(() => {
      void this.messageStatusPendingService
        .publishDuePendingStatuses()
        .catch((error) => {
          logger.error(
            {
              err: error,
              type: 'message_status_pending_retry_worker_error',
            },
            'Error while processing deferred message status updates'
          );
        });
    }, this.missingStatusRetryIntervalMs);

    this.missingStatusRetryTimer.unref?.();
  }

  private getIdempotencyKey(data: IMessageStatusUpdate): string {
    const patchHash = MessageStatusService.hashPatch(data.patch);
    return `${this.idempotencyPrefix}${data.account_id}:${data.message_id}:${patchHash}`;
  }

  private async isAlreadyProcessed(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const key = this.getIdempotencyKey(data);
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  private async markAsProcessed(data: IMessageStatusUpdate): Promise<void> {
    const key = this.getIdempotencyKey(data);
    try {
      await this.redis.setex(key, this.idempotencyTtlSeconds, '1');
    } catch {}
  }

  private getMessageKey(accountId: string, messageId: string): string {
    return `${accountId}:${messageId}`;
  }

  private async addToBatch(
    data: IMessageStatusUpdate,
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    const messageKey = this.getMessageKey(data.account_id, data.message_id);
    const buffered = this.messagePatchBuffer.get(messageKey) ?? [];
    buffered.push({ data, partition, offset, topic });
    this.messagePatchBuffer.set(messageKey, buffered);

    const existingTimer = this.batchTimers.get(messageKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (buffered.length >= this.batchMaxSize) {
      await this.flushBatch(messageKey);
      return;
    }

    const timer = setTimeout(() => {
      this.batchTimers.delete(messageKey);
      void this.flushBatch(messageKey).catch(() => {});
    }, this.batchWindowMs);

    this.batchTimers.set(messageKey, timer);
  }

  private async flushBatch(messageKey: string): Promise<void> {
    const buffered = this.messagePatchBuffer.get(messageKey);
    if (!buffered || buffered.length === 0) {
      return;
    }

    this.messagePatchBuffer.delete(messageKey);
    const timer = this.batchTimers.get(messageKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(messageKey);
    }

    const firstUpdate = buffered[0].data;
    const mergedPatch = this.messageStatusPendingService.mergePatches(
      buffered.map((b) => b.data.patch)
    );

    const startTime = Date.now();

    try {
      const isAlreadyProcessed = await this.isAlreadyProcessed({
        ...firstUpdate,
        patch: mergedPatch,
      });

      if (isAlreadyProcessed) {
        incrementCounter('message_status_update_duplicate', buffered.length, {
          account_id: firstUpdate.account_id,
        });

        await Promise.all(
          buffered.map((item) =>
            this.commitNext(item.topic, item.partition, item.offset)
          )
        );

        return;
      }

      const updatedMessage =
        await this.messageStatusService.updateSummaryByWhatsAppId(
          firstUpdate.account_id,
          firstUpdate.message_id,
          mergedPatch,
          firstUpdate.key
        );

      if (!updatedMessage) {
        const duration = Date.now() - startTime;

        await this.messageStatusPendingService.deferMissingStatusUpdate(
          firstUpdate,
          mergedPatch,
          {
            batchSize: buffered.length,
            duration,
          }
        );

        recordHistogram('message_status_update_deferred_duration', duration, {
          account_id: firstUpdate.account_id,
          batch_size: buffered.length.toString(),
        });

        await Promise.all(
          buffered.map((item) =>
            this.commitNext(item.topic, item.partition, item.offset)
          )
        );

        return;
      }

      for (const item of buffered) {
        this.resetPartitionFailureCount(item.partition);
      }

      await this.markAsProcessed({
        ...firstUpdate,
        patch: mergedPatch,
      });

      const duration = Date.now() - startTime;
      incrementCounter('message_status_update_success', buffered.length, {
        account_id: firstUpdate.account_id,
        batched: 'true',
      });
      recordHistogram('message_status_update_duration', duration, {
        account_id: firstUpdate.account_id,
        batch_size: buffered.length.toString(),
      });

      await Promise.all(
        buffered.map((item) =>
          this.commitNext(item.topic, item.partition, item.offset)
        )
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          err: error,
          account_id: firstUpdate.account_id,
          message_id: firstUpdate.message_id,
          patch: mergedPatch,
          batch_size: buffered.length,
          duration,
          type: 'message_status_update_error',
        },
        'Erro ao processar atualização de status da mensagem em batch'
      );

      incrementCounter('message_status_update_error', buffered.length, {
        account_id: firstUpdate.account_id,
        batched: 'true',
      });
      recordHistogram('message_status_update_error_duration', duration);

      const firstBuffered = buffered[0];
      this.markPartitionAsFailed(
        firstBuffered.topic,
        firstBuffered.partition,
        error,
        {
          account_id: firstUpdate.account_id,
          message_id: firstUpdate.message_id,
        }
      );
      throw error;
    }
  }

  private async flushAllBatches(): Promise<void> {
    const messageKeys = Array.from(this.messagePatchBuffer.keys());
    await Promise.all(messageKeys.map((key) => this.flushBatch(key)));
  }
}
