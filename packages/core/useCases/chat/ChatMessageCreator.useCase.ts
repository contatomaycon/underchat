import { injectable, inject } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { v4 as uuidv4 } from 'uuid';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import Redis from 'ioredis';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IGetChat } from '@core/common/interfaces/IGetChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import { chatAccountCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IGetChat | null> {
    const cacheKey = `chat:${accountId}:${chatId}`;
    const cache = await this.redis.get(cacheKey);

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

    await this.redis.set(cacheKey, JSON.stringify(saveChat), 'EX', 1800);

    return saveChat;
  }

  private centrifugoPublish(dataPublish: IChatMessage): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugoQueue(dataPublish.account.id),
      dataPublish
    );
  }

  private async validate(body: CreateMessageChatsBody) {
    if (body.type === EMessageType.text && !body.message) {
      throw new Error('Message content is required for text messages');
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody
  ): Promise<boolean> {
    this.validate(body);

    const getChat = await this.getChat(accountId, params.chat_id);

    if (!getChat) {
      throw new Error(t('chat_not_found'));
    }

    const inputChatMessage: IChatMessage = {
      message_id: uuidv4(),
      chat_id: params.chat_id,
      message_key: {
        jid: getChat.data.message_key?.jid ?? null,
      },
      type_user: ETypeUserChat.operator,
      account: getChat.data.account,
      worker: getChat.data.worker,
      user: getChat.data.user,
      phone: getChat.data.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      content: {
        type: body.type as EMessageType,
        message: body.message,
      },
      date: new Date().toISOString(),
    };

    const [, , result] = await Promise.all([
      this.centrifugoPublish(inputChatMessage),
      this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerSendMessage(getChat.data.worker.id),
        inputChatMessage
      ),
      this.chatService.saveMessageChat(inputChatMessage),
    ]);

    return result;
  }
}
