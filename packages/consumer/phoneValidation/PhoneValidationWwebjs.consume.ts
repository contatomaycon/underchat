import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { WwebjsService } from '@core/services/wwebjs';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class PhoneValidationWwebjsConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(WwebjsService)
    private readonly wwebjsService: WwebjsService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IPhoneValidationRequest | null {
    if (!value) return null;

    try {
      return JSON.parse(value.toString()) as IPhoneValidationRequest;
    } catch {
      return null;
    }
  }

  private async processValidation(
    data: IPhoneValidationRequest
  ): Promise<void> {
    try {
      if (!data.phone_ddi) {
        throw new Error('DDI is required for phone validation');
      }

      const result = await this.wwebjsService.validatePhone(
        data.phone_ddi,
        data.phone
      );

      const response: IPhoneValidationResponse = {
        request_id: data.request_id,
        account_id: data.account_id,
        worker_id: data.worker_id,
        valid: result.valid,
        jid: result.jid ?? null,
        phone: result.phone ?? null,
      };

      const responseTopic =
        this.kafkaServiceQueueService.phoneValidationResponse();
      await this.streamProducerService.send(responseTopic, response);
    } catch (error) {
      const errorResponse: IPhoneValidationResponse = {
        request_id: data.request_id,
        account_id: data.account_id,
        worker_id: data.worker_id,
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      const responseTopic =
        this.kafkaServiceQueueService.phoneValidationResponse();
      await this.streamProducerService.send(responseTopic, errorResponse);
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaBaileysQueueService.workerValidatePhone(
      wwebjsEnvironment.wwebjsWorkerId
    );

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-wwebjs-validate-phone-${wwebjsEnvironment.wwebjsWorkerId}`
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.processValidation(data);
      } catch (error) {
        console.error('Error processing phone validation:', error);
      } finally {
        stop();
        await this.commitNext(topic, message.partition, message.offset);
      }
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;

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
