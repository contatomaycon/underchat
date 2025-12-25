import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { BaileysService } from '@core/services/baileys';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';

@singleton()
export class PhoneValidationConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysService: BaileysService,
    private readonly streamProducerService: StreamProducerService,
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

      const result = await this.baileysService.validatePhone(
        data.phone_ddi,
        data.phone
      );

      const response: IPhoneValidationResponse = {
        request_id: data.request_id,
        account_id: data.account_id,
        worker_id: data.worker_id,
        valid: result.valid,
        jid: result.jid || null,
        phone: result.phone || null,
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

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-validate-phone-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaBaileysQueueService.workerValidatePhone(
      baileysEnvironment.baileysWorkerId
    );

    await ensureKafkaTopic(this.kafka, topic);

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
      console.error('Consumer error:', err);
    });

    this.consumer.subscribe([topic]);

    await new Promise<void>((resolve, reject) => {
      const consumer = this.consumer;
      if (!consumer) {
        reject(new Error('Consumer not initialized'));
        return;
      }
      consumer.connect({}, (err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        consumer.consume();
        this.isRunning = true;
        resolve();
      });
    });
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
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
