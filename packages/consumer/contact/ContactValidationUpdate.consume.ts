import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IContactValidationUpdate } from '@core/common/interfaces/IContactValidationUpdate';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { ContactService } from '@core/services/contact.service';

@singleton()
export class ContactValidationUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly contactService: ContactService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

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
    await this.contactService.updateContactValidation(
      data.contact_id,
      data.phone,
      data.is_validated
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-contact-validation-update'
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
        await this.processValidationUpdate(data);
      } catch (error) {
        console.error('Error processing contact validation update:', error);
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
