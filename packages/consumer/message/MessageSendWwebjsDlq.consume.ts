import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
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

@singleton()
export class MessageSendWwebjsDlqConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly partitionChains: Map<number, Promise<void>> = new Map();
  private readonly MAX_REDRIVE_ATTEMPTS = 5;
  private readonly MAX_GLOBAL_REDRIVE_COUNT = 5;
  private readonly RETRY_BASE_MS = 500;
  private readonly RETRY_MAX_MS = 8000;
  private readonly REDRIVE_COUNT_FIELD = '__wwebjs_redrive_count';

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
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
      `group-underchat-wwebjs-send-dlq-${workerId}`
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
        const nextRedriveCount = this.resolveNextRedriveCount(data);

        if (nextRedriveCount > this.MAX_GLOBAL_REDRIVE_COUNT) {
          console.error(
            '[MessageSendWwebjsDlq] Message discarded after global redrive limit',
            {
              worker_id: data.worker_id,
              queue_key: data.queue_key,
              chat_id: data.chat_id,
              partition: data.partition,
              offset: data.offset,
              attempts: data.attempts,
              redrive_count: data.redrive_count ?? 0,
              max_global_redrive_count: this.MAX_GLOBAL_REDRIVE_COUNT,
            }
          );

          await this.commitNext(topic, partition, offset);
          return;
        }

        try {
          await this.redriveWithRetry(data, redriveTopic, nextRedriveCount);
          console.info('[MessageSendWwebjsDlq] Message requeued', {
            worker_id: data.worker_id,
            queue_key: data.queue_key,
            chat_id: data.chat_id,
            partition: data.partition,
            offset: data.offset,
            attempts: data.attempts,
            redrive_count: nextRedriveCount,
          });
        } catch (error) {
          console.error('[MessageSendWwebjsDlq] Failed to requeue message', {
            worker_id: data.worker_id,
            queue_key: data.queue_key,
            chat_id: data.chat_id,
            partition: data.partition,
            offset: data.offset,
            attempts: data.attempts,
            redrive_count: nextRedriveCount,
            error: this.errorMessage(error),
          });
        } finally {
          await this.commitNext(topic, partition, offset);
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

    for (let attempt = 1; attempt <= this.MAX_REDRIVE_ATTEMPTS; attempt++) {
      try {
        await this.streamProducerService.send(redriveTopic, payload, key);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.MAX_REDRIVE_ATTEMPTS) {
          await this.delay(this.calculateRetryDelayMs(attempt));
        }
      }
    }

    throw lastError ?? new Error('Failed to requeue DLQ message');
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
