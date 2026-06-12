import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IContactValidationUpdate } from '@core/common/interfaces/IContactValidationUpdate';
import { ContactService } from '@core/services/contact.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ContactValidationUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IContactValidationUpdate> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ContactService)
    private readonly contactService: ContactService
  ) {}

  private parseMessage(value: Buffer | null): IContactValidationUpdate | null {
    if (!value) return null;

    try {
      return JSON.parse(value.toString()) as IContactValidationUpdate;
    } catch {
      return null;
    }
  }

  private async processValidationUpdate(
    data: IContactValidationUpdate
  ): Promise<void> {
    if (!data.is_validated) {
      await this.contactService.updateContactIsValided(data.contact_id, false);
    }

    if (typeof data.phone !== 'string' || data.phone.trim() === '') {
      return;
    }

    await this.contactService.updateContactValidation(
      data.contact_id,
      data.phone,
      data.is_validated
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    this.runner = new KafkaConsumerRunner<IContactValidationUpdate>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-contact-validation-update',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.contact_id,
      handle: async (data) => {
        try {
          await this.processValidationUpdate(data);
        } catch (error) {
          console.error('Error processing contact validation update:', error);
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
