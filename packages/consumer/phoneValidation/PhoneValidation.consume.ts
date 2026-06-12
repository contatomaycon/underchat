import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { BaileysService } from '@core/services/baileys';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class PhoneValidationConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IPhoneValidationRequest> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(BaileysService)
    private readonly baileysService: BaileysService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

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
      baileysEnvironment.baileysWorkerId
    );
    this.runner = new KafkaConsumerRunner<IPhoneValidationRequest>({
      kafka: this.kafka,
      topic,
      groupId: `group-underchat-baileys-validate-phone-${baileysEnvironment.baileysWorkerId}`,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.request_id,
      handle: async (data) => {
        try {
          await this.processValidation(data);
        } catch (error) {
          console.error('Error processing phone validation:', error);
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
