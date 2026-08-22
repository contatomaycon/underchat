import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import { INotificationMessageRequest } from '@core/common/interfaces/INotificationMessageRequest';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

@singleton()
export class NotificationMessageConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<INotificationMessageRequest> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(NotificationMessageService)
    private readonly notificationMessageService: NotificationMessageService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.notificationMessage();
    this.runner = new KafkaConsumerRunner<INotificationMessageRequest>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.notificationMessage,
      parse: (message) => this.parseNotificationMessageRequest(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id}:${data.notification_type_id}`,
      preserveEntityOrder: true,
      maxRetries: 3,
      retryDelaysMs: [250, 1_000, 5_000],
      handle: (data, context) =>
        this.processNotificationMessage(
          {
            ...data,
            operation_id: this.resolveOperationId(
              data,
              context.topic,
              context.partition,
              context.offset
            ),
          },
          context.assertActive
        ),
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
        'account_id' in parsed &&
        (parsed.operation_id === undefined ||
          typeof parsed.operation_id === 'string')
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private resolveOperationId(
    data: INotificationMessageRequest,
    topic: string,
    partition: number,
    offset: number
  ): string {
    return (
      data.operation_id?.trim() ||
      ['notification_message_v1', topic, partition, offset].join(':')
    );
  }

  private async processNotificationMessage(
    data: INotificationMessageRequest,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    await this.notificationMessageService.sendNotificationMessage(
      data.notification_type_id,
      data.account_id,
      assertActive,
      data.operation_id
    );
  }
}
