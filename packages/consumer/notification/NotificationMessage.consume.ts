import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { Kafka, Consumer } from 'kafkajs';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { INotificationMessageRequest } from '@core/common/interfaces/INotificationMessageRequest';

@singleton()
export class NotificationMessageConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly notificationMessageService: NotificationMessageService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-notification-message'
    );

    const topic = this.kafkaServiceQueueService.notificationMessage();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseNotificationMessageRequest(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.notificationMessageService.sendNotificationMessage(
            data.notification_type_id,
            data.account_id
          );
        } catch {
          stop();
          await this.commitNext(topic, partition, message.offset);
          return;
        } finally {
          stop();
        }

        stop();
        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
  }

  private parseNotificationMessageRequest(
    value: Buffer | null
  ): INotificationMessageRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as INotificationMessageRequest;
      if (
        parsed &&
        'notification_type_id' in parsed &&
        'account_id' in parsed
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    await this.consumerOrThrow.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + BigInt(1)).toString(),
      },
    ]);
  }
}
