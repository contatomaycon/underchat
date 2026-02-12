import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import {
  MessageStatusService,
  MessageSummaryPatch,
} from '@core/services/messageStatus.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import Redis from 'ioredis';
import { logger } from '@core/plugins/telemetry/logger';
import {
  metricsCount,
  metricsDistribution,
} from '@core/plugins/telemetry/sentry';

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
  private readonly idempotencyTtlSeconds = 86400;
  private readonly idempotencyPrefix = 'status-update:';
  private readonly batchWindowMs = 50;
  private readonly batchMaxSize = 20;

  private messagePatchBuffer = new Map<string, BufferedUpdate[]>();
  private batchTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
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

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-status-update'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.addToBatch(data, topic, partition, offset);
        } catch (error) {
          logger.error(
            {
              err: error,
              account_id: data.account_id,
              message_id: data.message_id,
              type: 'message_status_update_batch_error',
            },
            'Erro ao adicionar atualização ao batch'
          );
        } finally {
          stop();
        }
      });

      this.partitionChains.set(partition, currentChain);
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
        error.code === 22
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
      void this.flushBatch(messageKey);
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
    const mergedPatch = this.mergePatches(buffered.map((b) => b.data.patch));

    const startTime = Date.now();

    try {
      const isAlreadyProcessed = await this.isAlreadyProcessed({
        ...firstUpdate,
        patch: mergedPatch,
      });

      if (isAlreadyProcessed) {
        metricsCount('message_status_update_duplicate', buffered.length, {
          account_id: firstUpdate.account_id,
        });

        await Promise.all(
          buffered.map((item) =>
            this.commitNext(item.topic, item.partition, item.offset)
          )
        );

        return;
      }

      await this.messageStatusService.updateSummaryByWhatsAppId(
        firstUpdate.account_id,
        firstUpdate.message_id,
        mergedPatch
      );

      await this.markAsProcessed({
        ...firstUpdate,
        patch: mergedPatch,
      });

      const duration = Date.now() - startTime;
      metricsCount('message_status_update_success', buffered.length, {
        account_id: firstUpdate.account_id,
        batched: 'true',
      });
      metricsDistribution('message_status_update_duration', duration, {
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

      metricsCount('message_status_update_error', buffered.length, {
        account_id: firstUpdate.account_id,
        batched: 'true',
      });
      metricsDistribution('message_status_update_error_duration', duration);

      await Promise.allSettled(
        buffered.map((item) =>
          this.commitNext(item.topic, item.partition, item.offset)
        )
      );

      throw error;
    }
  }

  private async flushAllBatches(): Promise<void> {
    const messageKeys = Array.from(this.messagePatchBuffer.keys());
    await Promise.all(messageKeys.map((key) => this.flushBatch(key)));
  }

  private mergePatches(patches: MessageSummaryPatch[]): MessageSummaryPatch {
    const merged: MessageSummaryPatch = {};

    for (const patch of patches) {
      if (patch.is_sent) {
        merged.is_sent = true;
      }
      if (patch.is_delivered) {
        merged.is_delivered = true;
      }
      if (patch.is_seen) {
        merged.is_seen = true;
      }
    }

    return merged;
  }
}
