import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { MessageStatusService } from '@core/services/messageStatus.service';

@singleton()
export class MessageMarkReadWwebjsConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
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
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.markMessageRead();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-mark-read-wwebjs-${wwebjsEnvironment.wwebjsWorkerId}`
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      if (data.worker_id !== wwebjsEnvironment.wwebjsWorkerId) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.wwebjsIncomingMessageService.markRead(
            data.keys as Array<{
              remoteJid?: string | null;
              remote_jid?: string | null;
              id?: string;
            }>
          );

          await Promise.all(
            data.keys.map(async (key) => {
              if (!key.id) return;

              const statusUpdate: IMessageStatusUpdate = {
                account_id: data.account_id,
                message_id: key.id,
                patch: { is_seen: true },
                key,
              };

              const kafkaKey = `${data.account_id}:${key.id}:${MessageStatusService.hashPatch(statusUpdate.patch)}`;

              await this.streamProducerService.send(
                this.kafkaServiceQueueService.updateMessageStatus(),
                statusUpdate,
                kafkaKey
              );
            })
          );
        } catch (error) {
          throw error;
        } finally {
          stop();
        }
      });

      currentChain
        .then(() => {
          return this.commitNext(topic, partition, offset);
        })
        .catch(() => {});

      this.partitionChains.set(partition, currentChain);
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

  public async close(): Promise<void> {
    await Promise.all(this.partitionChains.values());

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
      this.partitionChains.clear();
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
