import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class MessageStatusUpdateConsume {
  private consumer: Consumer | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly messageStatusService: MessageStatusService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IMessageStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageStatusUpdate;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-status-update'
    );

    const topic = this.kafkaServiceQueueService.updateMessageStatus();

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

        const offset = message.offset;

        this.processingChain = this.processingChain.then(async () => {
          const stop = startHeartbeat(heartbeat);

          try {
            await this.messageStatusService.updateSummaryByWhatsAppId(
              data.account_id,
              data.message_id,
              data.patch
            );
          } catch {
            await this.commitNext(topic, partition, message.offset);
          } finally {
            stop();
          }

          await this.commitNext(topic, partition, offset);
        });
      },
    });
  }

  public async close(): Promise<void> {
    await this.processingChain;

    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    const next = (BigInt(offset) + 1n).toString();

    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: next },
    ]);
  }
}
