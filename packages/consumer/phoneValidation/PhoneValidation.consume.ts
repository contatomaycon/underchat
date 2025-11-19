import { singleton, inject } from 'tsyringe';
import { Consumer } from 'kafkajs';
import { Kafka } from 'kafkajs';
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
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysService: BaileysService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): Consumer {
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
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-validate-phone-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaBaileysQueueService.workerValidatePhone(
      baileysEnvironment.baileysWorkerId
    );

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
          await this.processValidation(data);
        } catch (error) {
          console.error('Error processing phone validation:', error);
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
