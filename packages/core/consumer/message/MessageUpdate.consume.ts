import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import Redis from 'ioredis';
import { remoteJid } from '@core/common/functions/remoteJid';

@singleton()
export class MessageUpdateConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private cacheChatKey(accountId: string, chatId: string): string {
    const key = `chat:${accountId}:${chatId}`;

    return key;
  }

  private createConsumer(): Consumer {
    const consumer = this.kafka.consumer({
      groupId: 'group-underchat-message-update',
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
    });

    return consumer;
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
      sender_lid: data.message?.key?.senderLid ?? null,
      sender_pn: data.message?.key?.senderPn ?? null,
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

    return;
  }

  private async updateMessageIfMissingKey(data: IUpdateMessage): Promise<void> {
    const hasId = Boolean(data.data?.message_key?.id);
    const hasRemote = Boolean(data.data?.message_key?.remote_jid);

    if (hasId && hasRemote) {
      return;
    }

    const jid = remoteJid(data.message?.key);
    const messageKey: IChatMessage['message_key'] = {
      remote_jid: jid,
      from_me: data.message?.key?.fromMe ?? false,
      id: data.message?.key?.id ?? null,
      sender_lid: data.message?.key?.senderLid ?? null,
      sender_pn: data.message?.key?.senderPn ?? null,
      participant: data.message?.key?.participant ?? null,
      participant_pn: data.message?.key?.participantPn ?? null,
      participant_lid: data.message?.key?.participantLid ?? null,
    };

    await this.elasticDatabaseService.update(
      EElasticIndex.message,
      { message_key: messageKey },
      data.data?.message_id ?? ''
    );

    return;
  }

  private async handleMessage(data: IUpdateMessage): Promise<void> {
    await this.updateChatIfMissingRemoteJid(data);
    await this.updateMessageIfMissingKey(data);

    return;
  }

  public async execute(): Promise<void> {
    if (this.consumer) {
      return;
    }

    const topic = this.kafkaServiceQueueService.updateMessage();
    this.consumer = this.createConsumer();

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    let chain: Promise<void> = Promise.resolve();

    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          return;
        }

        chain = chain.then(async () => {
          await this.handleMessage(data);

          return;
        });

        return;
      },
    });

    return;
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    return;
  }
}
