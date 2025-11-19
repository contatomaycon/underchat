import { singleton, inject } from 'tsyringe';
import { Consumer } from 'kafkajs';
import { Kafka } from 'kafkajs';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import Redis from 'ioredis';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';

@singleton()
export class PhoneValidationResponseConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    @inject('Redis') private readonly redis: Redis,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IPhoneValidationResponse | null {
    if (!value) return null;

    try {
      return JSON.parse(value.toString()) as IPhoneValidationResponse;
    } catch {
      return null;
    }
  }

  private async processResponse(data: IPhoneValidationResponse): Promise<void> {
    const cacheKey = `phone_validation:${data.request_id}`;
    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', 30);
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-phone-validation-response'
    );

    const topic = this.kafkaServiceQueueService.phoneValidationResponse();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.processResponse(data);
        } catch (error) {
          console.error('Error processing phone validation response:', error);
        } finally {
          stop();
          await this.commitNext(topic, partition, message.offset);
        }
      },
    });
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: String(Number(offset) + 1) },
    ]);
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;

    await this.consumer.disconnect();
    this.consumer = null;
  }
}
