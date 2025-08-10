import { singleton, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import Redis from 'ioredis';
import { IGetChat } from '@core/common/interfaces/IGetChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IGetChatMessage } from '@core/common/interfaces/IGetChatMessage';

@singleton()
export class MessageUpdateConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    @inject('Redis') private readonly redis: Redis,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private cacheChatKey(accountId: string, chatId: string): string {
    return `chat:${accountId}:${chatId}`;
  }

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IGetChat | null> {
    const cacheChatKey = this.cacheChatKey(accountId, chatId);
    const cache = await this.redis.get(cacheChatKey);

    if (cache) {
      return JSON.parse(cache) as IGetChat;
    }

    const queryElastic = {
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const data = result?.hits.hits[0]?._source as IChat | null;
    const _id = result?.hits.hits[0]?._id as string | null;

    if (!data || !_id) {
      return null;
    }

    const saveChat: IGetChat = {
      _id,
      data,
    };

    await this.redis.set(cacheChatKey, JSON.stringify(saveChat), 'EX', 1800);

    return saveChat;
  }

  private async getMessageChat(
    accountId: string,
    chatId: string,
    messageId: string
  ): Promise<IGetChatMessage | null> {
    const queryElastic = {
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
            {
              term: {
                message_id: messageId,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    const data = result?.hits.hits[0]?._source as IChatMessage | null;
    const _id = result?.hits.hits[0]?._id as string | null;

    if (!data || !_id) {
      return null;
    }

    const resultChatMessage: IGetChatMessage = {
      _id,
      data,
    };

    return resultChatMessage;
  }

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaServiceQueueService.updateMessage()
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    let chain: Promise<void> = Promise.resolve();

    stream.forEach(async (msg) => {
      chain = chain.then(async () => {
        const data = msg.value as IUpdateMessage;

        if (!data) {
          throw new Error('Received message without value');
        }

        const [getChat, getMessageChat] = await Promise.all([
          this.getChat(data.data.account.id, data.data.chat_id),
          this.getMessageChat(
            data.data.account.id,
            data.data.chat_id,
            data.data.message_id
          ),
        ]);

        if (getChat?._id && !getChat?.data?.message_key?.jid) {
          const messageKey: IChat['message_key'] = {
            jid: data.message?.key.remoteJid ?? null,
          };

          await this.elasticDatabaseService.update(
            EElasticIndex.chat,
            { message_key: messageKey },
            getChat._id
          );

          const cacheChatKey = this.cacheChatKey(
            data.data.account.id,
            data.data.chat_id
          );
          await this.redis.del(cacheChatKey);
        }

        if (
          getMessageChat?._id &&
          (!getMessageChat?.data?.message_key?.id ||
            !getMessageChat?.data?.message_key?.jid)
        ) {
          const messageKey: IChatMessage['message_key'] = {
            id: data.message?.key.id ?? null,
            jid: data.message?.key.remoteJid ?? null,
          };

          await this.elasticDatabaseService.update(
            EElasticIndex.message,
            { message_key: messageKey },
            getMessageChat._id
          );
        }
      });
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
