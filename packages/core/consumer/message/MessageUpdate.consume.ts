import { singleton, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import Redis from 'ioredis';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IGetChat } from '@core/common/interfaces/IGetChat';

@singleton()
export class MessageUpdateConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    @inject('Redis') private readonly redis: Redis,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private cacheKey(accountId: string, chatId: string): string {
    return `chat:${accountId}:${chatId}`;
  }

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IGetChat | null> {
    const cacheKey = this.cacheKey(accountId, chatId);
    const cacheAuth = await this.redis.get(cacheKey);

    if (cacheAuth) {
      return JSON.parse(cacheAuth) as IGetChat;
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

    await this.redis.set(cacheKey, JSON.stringify(saveChat), 'EX', 1800);

    return saveChat;
  }

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaServiceQueueService.updateMessage()
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as IUpdateMessage;

      if (!data) {
        throw new Error('Received message without value');
      }

      const getChat = await this.getChat(
        data.data.account.id,
        data.data.chat_id
      );

      if (
        getChat?._id &&
        (!getChat?.data?.message_key?.id || !getChat?.data?.message_key?.jid)
      ) {
        const messageKey: IChatMessage['message_key'] = {
          id: data.message?.key.id ?? null,
          jid: data.message?.key.remoteJid ?? null,
        };

        await this.elasticDatabaseService.update(
          EElasticIndex.chat,
          { message_key: messageKey },
          getChat._id
        );

        const cacheKey = this.cacheKey(data.data.account.id, data.data.chat_id);
        await this.redis.del(cacheKey);
      }
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
