import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IWorkerSendMessageDlq } from '@core/common/interfaces/IWorkerSendMessageDlq';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { webcrypto } from 'node:crypto';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { logger } from '@core/plugins/telemetry/logger';
import {
  captureException,
  metricsCount,
  metricsDistribution,
} from '@core/plugins/telemetry/sentry';

@singleton()
export class MessageSendDlqConsume {
  private readonly PROVIDER = 'baileys';
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly partitionChains: Map<number, Promise<void>> = new Map();
  private readonly MAX_REDRIVE_ATTEMPTS = 5;
  private readonly MAX_GLOBAL_REDRIVE_COUNT = 3;
  private readonly RETRY_BASE_MS = 500;
  private readonly RETRY_MAX_MS = 8000;
  private readonly REDRIVE_COUNT_FIELD = '__baileys_redrive_count';

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService
  ) {}

  private logPipelineEvent(
    event: string,
    details: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const payload = {
      module: 'worker_baileys',
      component: 'message_send_dlq_consume',
      type: 'message_send_pipeline',
      provider: this.PROVIDER,
      event,
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      ...details,
    };

    if (level === 'error') {
      logger.error(payload, 'Baileys message send DLQ pipeline event');
      return;
    }

    if (level === 'warn') {
      logger.warn(payload, 'Baileys message send DLQ pipeline event');
      return;
    }

    logger.info(payload, 'Baileys message send DLQ pipeline event');
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const workerId = baileysEnvironment.baileysWorkerId;
    const topic = this.kafkaBaileysQueueService.workerSendMessageDlq(workerId);
    const redriveTopic =
      this.kafkaBaileysQueueService.workerSendMessage(workerId);

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-send-dlq-${workerId}`
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      const messageId = this.resolveMessageId(data);
      const redriveCount =
        typeof data?.redrive_count === 'number' ? data.redrive_count : 0;
      this.logPipelineEvent('consume_received', {
        partition: message.partition,
        offset: message.offset,
        message_id: messageId,
        redrive_count: redriveCount,
      });

      if (!data) {
        this.logPipelineEvent('payload_invalid_skipped', {
          partition: message.partition,
          offset: message.offset,
          result: 'payload_invalid_skipped',
        });
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain
        .catch(() => {})
        .then(async () => {
          const resolvedMessageId = this.resolveMessageId(data);
          const nextRedriveCount = this.resolveNextRedriveCount(data);
          const startedAt = Date.now();

          try {
            if (resolvedMessageId) {
              const alreadySent =
                await this.messageStatusService.isMessageAlreadySentByMessageId(
                  resolvedMessageId
                );
              if (alreadySent) {
                this.logPipelineEvent('already_sent_skipped', {
                  chat_id: data.chat_id,
                  queue_key: data.queue_key,
                  partition: data.partition,
                  offset: data.offset,
                  message_id: resolvedMessageId,
                  attempts: data.attempts,
                  redrive_count: data.redrive_count ?? 0,
                  result: 'already_sent_skipped',
                });
                metricsCount('message_send_already_sent_skipped', 1, {
                  provider: this.PROVIDER,
                  result: 'already_sent_skipped',
                  queue_type: data.queue_key?.startsWith('chat:')
                    ? 'chat'
                    : 'system',
                  attempt_bucket: '1',
                  redrive_count: nextRedriveCount,
                });
                return;
              }
            }

            if (nextRedriveCount > this.MAX_GLOBAL_REDRIVE_COUNT) {
              this.logPipelineEvent(
                'redrive_limit_reached',
                {
                  queue_key: data.queue_key,
                  chat_id: data.chat_id,
                  partition: data.partition,
                  offset: data.offset,
                  message_id: resolvedMessageId,
                  attempts: data.attempts,
                  redrive_count: data.redrive_count ?? 0,
                  max_global_redrive_count: this.MAX_GLOBAL_REDRIVE_COUNT,
                  result: 'redrive_limit_reached',
                },
                'warn'
              );

              await this.markMessageAsFailedToSend(
                data,
                'global_redrive_limit'
              );
              metricsCount('message_send_final_failed', 1, {
                provider: this.PROVIDER,
                result: 'redrive_limit_reached',
                queue_type: data.queue_key?.startsWith('chat:')
                  ? 'chat'
                  : 'system',
                attempt_bucket: '1',
                redrive_count: nextRedriveCount,
              });
              return;
            }

            await this.redriveWithRetry(data, redriveTopic, nextRedriveCount);
            const durationMs = Date.now() - startedAt;
            this.logPipelineEvent('redrive_requeued', {
              queue_key: data.queue_key,
              chat_id: data.chat_id,
              partition: data.partition,
              offset: data.offset,
              message_id: resolvedMessageId,
              attempts: data.attempts,
              redrive_count: nextRedriveCount,
              result: 'redrive_requeued',
              duration_ms: durationMs,
            });
            metricsCount('message_send_redrive_requeued', 1, {
              provider: this.PROVIDER,
              result: 'redrive_requeued',
              queue_type: data.queue_key?.startsWith('chat:')
                ? 'chat'
                : 'system',
              attempt_bucket: '1',
              redrive_count: nextRedriveCount,
            });
            metricsDistribution(
              'message_send_redrive_duration_ms',
              durationMs,
              {
                provider: this.PROVIDER,
                result: 'redrive_requeued',
                queue_type: data.queue_key?.startsWith('chat:')
                  ? 'chat'
                  : 'system',
                attempt_bucket: '1',
                redrive_count: nextRedriveCount,
              }
            );
          } catch (error) {
            this.logPipelineEvent(
              'redrive_publish_error',
              {
                queue_key: data.queue_key,
                chat_id: data.chat_id,
                partition: data.partition,
                offset: data.offset,
                message_id: resolvedMessageId,
                attempts: data.attempts,
                redrive_count: nextRedriveCount,
                result: 'redrive_publish_error',
                error: this.errorMessage(error),
              },
              'error'
            );
            metricsCount('message_send_error', 1, {
              provider: this.PROVIDER,
              result: 'redrive_publish_error',
              queue_type: data.queue_key?.startsWith('chat:')
                ? 'chat'
                : 'system',
              attempt_bucket: '1',
              redrive_count: nextRedriveCount,
            });
            captureException(error, {
              messageSendPipeline: {
                provider: this.PROVIDER,
                event: 'redrive_publish_error',
                queue_key: data.queue_key,
                chat_id: data.chat_id,
                message_id: resolvedMessageId,
              },
            });
            await this.markMessageAsFailedToSend(
              data,
              'redrive_publish_failed'
            );
          } finally {
            await this.commitNext(topic, partition, offset);
          }
        })
        .catch((error) => {
          this.logPipelineEvent(
            'partition_chain_error',
            {
              partition,
              offset,
              result: 'partition_chain_error',
              error: this.errorMessage(error),
            },
            'error'
          );
          captureException(error, {
            messageSendPipeline: {
              provider: this.PROVIDER,
              event: 'partition_chain_error',
              partition,
              offset,
            },
          });
        })
        .finally(() => {
          if (this.partitionChains.get(partition) === currentChain) {
            this.partitionChains.delete(partition);
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
    await Promise.allSettled(this.partitionChains.values());

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

  private parseMessage(value: Buffer | null): IWorkerSendMessageDlq | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IWorkerSendMessageDlq | null;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      if (!('payload' in parsed)) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private async redriveWithRetry(
    data: IWorkerSendMessageDlq,
    redriveTopic: string,
    nextRedriveCount: number
  ): Promise<void> {
    const key = this.resolveRedriveKey(data);
    const payload = this.createRedrivePayload(data.payload, nextRedriveCount);
    let lastError: unknown = null;
    const messageId = this.resolveMessageId(data);

    for (let attempt = 1; attempt <= this.MAX_REDRIVE_ATTEMPTS; attempt++) {
      try {
        await this.streamProducerService.send(redriveTopic, payload, key);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.MAX_REDRIVE_ATTEMPTS) {
          this.logPipelineEvent(
            'redrive_publish_retry',
            {
              queue_key: data.queue_key,
              chat_id: data.chat_id,
              partition: data.partition,
              offset: data.offset,
              message_id: messageId,
              redrive_count: nextRedriveCount,
              attempt,
              result: 'redrive_publish_retry',
              error: this.errorMessage(error),
            },
            'warn'
          );
          await this.delay(this.calculateRetryDelayMs(attempt));
        }
      }
    }

    throw lastError ?? new Error('Failed to requeue DLQ message');
  }

  private resolveNextRedriveCount(data: IWorkerSendMessageDlq): number {
    const count =
      typeof data.redrive_count === 'number' &&
      Number.isFinite(data.redrive_count) &&
      data.redrive_count >= 0
        ? Math.floor(data.redrive_count)
        : 0;

    return count + 1;
  }

  private createRedrivePayload(
    payload: unknown,
    redriveCount: number
  ): unknown {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    return {
      ...(payload as Record<string, unknown>),
      [this.REDRIVE_COUNT_FIELD]: redriveCount,
    };
  }

  private resolveRedriveKey(data: IWorkerSendMessageDlq): string | undefined {
    if (typeof data.chat_id === 'string' && data.chat_id.trim().length > 0) {
      return data.chat_id;
    }

    if (
      data.payload &&
      typeof data.payload === 'object' &&
      'chat_id' in data.payload
    ) {
      const payloadChatId = (data.payload as { chat_id?: unknown }).chat_id;
      if (
        typeof payloadChatId === 'string' &&
        payloadChatId.trim().length > 0
      ) {
        return payloadChatId;
      }
    }

    return undefined;
  }

  private calculateRetryDelayMs(attempt: number): number {
    const exponentialDelay = Math.min(
      this.RETRY_MAX_MS,
      this.RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
    );
    const jitter = Math.floor(exponentialDelay * 0.2 * this.randomFraction());
    return exponentialDelay + jitter;
  }

  private randomFraction(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async markMessageAsFailedToSend(
    data: IWorkerSendMessageDlq,
    reason: string
  ): Promise<void> {
    const messageId = this.resolveMessageId(data);
    if (!messageId) {
      this.logPipelineEvent(
        'final_failed_mark_skipped',
        {
          queue_key: data.queue_key,
          chat_id: data.chat_id,
          partition: data.partition,
          offset: data.offset,
          result: 'missing_message_id',
          reason,
        },
        'warn'
      );
      return;
    }

    try {
      await this.messageStatusService.markMessageAsNotSent(
        baileysEnvironment.baileysAccountId,
        messageId
      );
      this.logPipelineEvent('final_failed_marked', {
        queue_key: data.queue_key,
        chat_id: data.chat_id,
        partition: data.partition,
        offset: data.offset,
        message_id: messageId,
        redrive_count: data.redrive_count ?? 0,
        result: 'failed_marked',
        reason,
      });
      metricsCount('message_send_final_failed', 1, {
        provider: this.PROVIDER,
        result: 'failed_marked',
        queue_type: data.queue_key?.startsWith('chat:') ? 'chat' : 'system',
        attempt_bucket: '1',
        redrive_count: data.redrive_count ?? 0,
      });
    } catch (error) {
      this.logPipelineEvent(
        'final_failed_mark_error',
        {
          queue_key: data.queue_key,
          chat_id: data.chat_id,
          partition: data.partition,
          offset: data.offset,
          message_id: messageId,
          result: 'failed_mark_error',
          reason,
          error: this.errorMessage(error),
        },
        'error'
      );
      captureException(error, {
        messageSendPipeline: {
          provider: this.PROVIDER,
          event: 'final_failed_mark_error',
          message_id: messageId,
          reason,
        },
      });
    }
  }

  private extractMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as { message_id?: unknown }).message_id;
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveMessageId(data: IWorkerSendMessageDlq | null): string | null {
    if (!data) {
      return null;
    }

    if (typeof data.message_id === 'string' && data.message_id.trim().length) {
      return data.message_id.trim();
    }

    return this.extractMessageId(data.payload);
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
