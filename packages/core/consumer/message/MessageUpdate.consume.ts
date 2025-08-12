import { singleton, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
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
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private cacheChatKey(accountId: string, chatId: string): string {
    return `chat:${accountId}:${chatId}`;
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

        if (!data?.data?.message_key?.jid) {
          const jid = remoteJid(data.message?.key);

          const messageKey: IChat['message_key'] = {
            jid,
          };

          await this.elasticDatabaseService.update(
            EElasticIndex.chat,
            { message_key: messageKey },
            data.data.chat_id
          );

          const cacheChatKey = this.cacheChatKey(
            data.data.account.id,
            data.data.chat_id
          );
          await this.redis.del(cacheChatKey);
        }

        if (!data?.data?.message_key?.id || !data?.data?.message_key?.jid) {
          const jid = remoteJid(data.message?.key);

          const messageKey: IChatMessage['message_key'] = {
            id: data.message?.key.id ?? null,
            jid,
          };

          await this.elasticDatabaseService.update(
            EElasticIndex.message,
            {
              message_key: messageKey,
            },
            data.data.message_id
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
