import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import Redis from 'ioredis';
import { remoteJid } from '@core/common/functions/remoteJid';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { WAMessageKey } from '@whiskeysockets/baileys';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class MessageUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private cacheChatKey(accountId: string, chatId: string): string {
    return `chat:${accountId}:${chatId}`;
  }

  private parseMessage(value: Buffer | null): IUpdateMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IUpdateMessage;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  private async updateChatIfMissingRemoteJid(
    data: IUpdateMessage
  ): Promise<void> {
    const hasRemote = Boolean(data.data?.message_key?.remote_jid);
    if (hasRemote) {
      return;
    }

    const jid = remoteJid(data.message?.key);
    const messageKey: IChat['message_key'] = {
      remote_jid: jid,
    };

    await this.elasticDatabaseService.update(
      EElasticIndex.chat,
      { message_key: messageKey },
      data.data?.chat_id ?? ''
    );

    const cacheKey = this.cacheChatKey(
      data.data?.account?.id ?? '',
      data.data?.chat_id ?? ''
    );

    await this.redis.del(cacheKey);
  }

  private async updateMessageIfMissingKey(data: IUpdateMessage): Promise<void> {
    const hasId = Boolean(data.data?.message_key?.id);

    const hasRemote = Boolean(data.data?.message_key?.remote_jid);
    if (hasId && hasRemote) return;

    const jid = remoteJid(data.message?.key);
    const key = data.message?.key as WAMessageKey | undefined;
    const messageKeyUpdate: IChatMessage['message_key'] = {
      remote_jid: jid,
      from_me: data.message?.key?.fromMe ?? false,
      id: data.message?.key?.id ?? null,
      participant: data.message?.key?.participant ?? null,
      is_view_once: key?.isViewOnce ?? false,
    };

    await this.elasticDatabaseService.update(
      EElasticIndex.message,
      { message_key: messageKeyUpdate },
      data.data?.message_id ?? ''
    );
  }

  private async handleMessage(data: IUpdateMessage): Promise<void> {
    await this.updateChatIfMissingRemoteJid(data);
    await this.updateMessageIfMissingKey(data);
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessage();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-update'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const offset = message.offset;

      this.processingChain = this.processingChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.handleMessage(data);
        } catch {
          await this.commitNext(topic, message.partition, message.offset);
        } finally {
          stop();
        }

        await this.commitNext(topic, message.partition, offset);
      });
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
    await this.processingChain;

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
