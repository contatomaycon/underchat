import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { INotificationMessageRequest } from '@core/common/interfaces/INotificationMessageRequest';

@singleton()
export class NotificationMessageConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly notificationMessageService: NotificationMessageService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-notification-message'
    );

    const topic = this.kafkaServiceQueueService.notificationMessage();

    await ensureKafkaTopic(this.kafka, topic);

    this.consumer.on('data', async (message) => {
      const data = this.parseNotificationMessageRequest(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.notificationMessageService.sendNotificationMessage(
          data.notification_type_id,
          data.account_id
        );
      } catch {
        stop();
        await this.commitNext(topic, message.partition, message.offset);
        return;
      } finally {
        stop();
      }

      stop();
      await this.commitNext(topic, message.partition, message.offset);
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

  public async close(): Promise<void> {
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
    }
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
}
