import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { baileysEnvironment } from '@core/config/environments';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';

@singleton()
export class MessageMarkReadConsume {
  private consumer: Consumer | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    private readonly messageStatusService: MessageStatusService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IMessageMarkRead | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageMarkRead;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-mark-read-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaServiceQueueService.markMessageRead();

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

        if (data.worker_id !== baileysEnvironment.baileysWorkerId) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const offset = message.offset;

        this.processingChain = this.processingChain.then(async () => {
          const stop = startHeartbeat(heartbeat);

          try {
            await this.baileysIncomingMessageService.markRead(data.keys);

            await Promise.all(
              data.keys.map(async (key) => {
                if (!key.id) return;

                const statusUpdate: IMessageStatusUpdate = {
                  account_id: data.account_id,
                  message_id: key.id,
                  patch: { is_seen: true },
                  key,
                };

                await this.streamProducerService.send(
                  this.kafkaServiceQueueService.updateMessageStatus(),
                  statusUpdate
                );
              })
            );
          } catch (error) {
            console.error('Error marking message as read', {
              accountId: data.account_id,
              workerId: data.worker_id,
              keysCount: data.keys.length,
              error,
            });
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
