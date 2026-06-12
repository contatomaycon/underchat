import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class PhoneValidationResponseConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IPhoneValidationResponse> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject('Redis') private readonly redis: Redis,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

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
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.phoneValidationResponse();
    this.runner = new KafkaConsumerRunner<IPhoneValidationResponse>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-phone-validation-response',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.request_id,
      handle: async (data) => {
        try {
          await this.processResponse(data);
        } catch (error) {
          console.error('Error processing phone validation response:', error);
        }
      },
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }
}
