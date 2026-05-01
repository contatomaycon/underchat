import { inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { InternalChatCommandDispatcherService } from '@core/services/internalChatCommandDispatcher.service';
import { IInternalChatDispatchMessage } from '@core/common/interfaces/internalChat/IInternalChatDispatchMessage';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

export abstract class InternalChatMessageBaseConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly partitionChains: Map<number, Promise<void>> = new Map();

  protected abstract getTopic(
    kafkaServiceQueueService: KafkaServiceQueueService
  ): string;
  protected abstract getGroupId(): string;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(InternalChatCommandDispatcherService)
    private readonly dispatcher: InternalChatCommandDispatcherService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  private parseMessage(
    value: Buffer | null
  ): IInternalChatDispatchMessage | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as IInternalChatDispatchMessage | null;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.getTopic(this.kafkaServiceQueueService);

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(this.kafka, this.getGroupId());

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      const partition = message.partition;
      const offset = message.offset;

      if (!data) {
        await this.commitNext(topic, partition, offset);
        return;
      }

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };
        const stop = startHeartbeat(heartbeat);

        try {
          await this.dispatcher.dispatchMessage(data);
        } finally {
          stop();
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
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
