import { singleton, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { v4 as uuidv4 } from 'uuid';
import { AccountService } from '@core/services/account.service';
import { WorkerService } from '@core/services/worker.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatService } from '@core/services/chat.service';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { remoteJid } from '@core/common/functions/remoteJid';
import { StorageService } from '@core/services/storage.service';
import { LinkPreview } from '@core/schema/chat/listMessageChats/response.schema';

@singleton()
export class MessageUpsertConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly accountService: AccountService,
    private readonly workerService: WorkerService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly storageService: StorageService
  ) {}

  private centrifugoChatPublish(
    dataPublish: IChatMessage
  ): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  private centrifugoChatQueuePublish(
    dataPublish: IChat
  ): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      chatQueueAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  private async getChat(
    accountId: string,
    workerId: string,
    phone: string,
    jid?: string | null
  ): Promise<IChat | null> {
    const candidates = buildCandidates(phone);

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
            {
              nested: {
                path: 'worker',
                query: {
                  term: {
                    'worker.id': workerId,
                  },
                },
              },
            },
            {
              terms: {
                status: [
                  EChatStatus.in_chat,
                  EChatStatus.queue,
                  EChatStatus.ura,
                ],
              },
            },
            {
              bool: {
                should: [
                  { terms: { phone: candidates } },
                  {
                    nested: {
                      path: 'message_key',
                      query: {
                        term: {
                          'message_key.remote_jid': jid,
                        },
                      },
                    },
                  },
                ],
                minimum_should_match: 1,
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

    if (!data) {
      return null;
    }

    return data;
  }

  private async createChatMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean> {
    let content;
    if (EMessageType.text === data.type) {
      const extended = data.message.message?.extendedTextMessage;

      const linkPreview = extended
        ? ({
            'canonical-url': extended?.matchedText ?? '',
            'matched-text': extended?.matchedText ?? '',
            title: extended?.title ?? '',
            description: extended?.description ?? '',
            jpegThumbnail: extended?.jpegThumbnail,
          } as LinkPreview)
        : undefined;

      content = {
        type: data.type,
        message:
          data.message.message?.extendedTextMessage?.text ??
          data.message.message?.conversation,
        link_preview: linkPreview,
      };
    }

    const jid = remoteJid(data.message?.key);

    const inputChatMessage: IChatMessage = {
      message_id: uuidv4(),
      chat_id: getChat.chat_id,
      message_key: {
        remote_jid: jid,
        from_me: data.message.key?.fromMe,
        id: data.message.key?.id,
        participant: data.message.key?.participant,
      },
      type_user: data.message?.key?.fromMe
        ? ETypeUserChat.operator
        : ETypeUserChat.client,
      account: getChat.account,
      worker: getChat.worker,
      user: getChat.user,
      phone: getChat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      content,
      date: new Date().toISOString(),
    };

    const [, result] = await Promise.all([
      this.centrifugoChatPublish(inputChatMessage),
      this.chatService.saveMessageChat(inputChatMessage),
    ]);

    return result;
  }

  private async createChat(data: IUpsertMessage): Promise<IChat> {
    const [viewAccountName, viewWorkerNameAndId] = await Promise.all([
      this.accountService.viewAccountName(data.account_id),
      this.workerService.viewWorkerNameAndId(data.account_id, data.worker_id),
    ]);

    if (!viewAccountName || !viewWorkerNameAndId) {
      throw new Error('Account or Worker not found');
    }

    const jid = remoteJid(data.message?.key);
    if (!jid) {
      throw new Error('Received message without remoteJid');
    }

    const phone = onlyDigits(jid);
    const chatId = uuidv4();

    const inputChatMessage: IChat = {
      chat_id: chatId,
      message_key: {
        remote_jid: jid,
      },
      account: viewAccountName,
      worker: viewWorkerNameAndId,
      name: data.message.pushName ?? null,
      phone,
      status: EChatStatus.queue,
      date: new Date().toISOString(),
    };

    if (data.photo) {
      const photoResult = await this.storageService.uploadFromUrl(
        data.photo,
        data.account_id,
        chatId
      );

      inputChatMessage.photo = photoResult?.url;
    }

    const result = await this.chatService.saveChat(inputChatMessage);

    if (!result) {
      throw new Error('Failed to create chat');
    }

    return inputChatMessage;
  }

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaServiceQueueService.upsertMessage()
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    let chain: Promise<void> = Promise.resolve();

    stream.forEach(async (msg) => {
      chain = chain.then(async () => {
        const data = msg.value as IUpsertMessage;

        if (!data) {
          throw new Error('Received message without value');
        }

        const jid = remoteJid(data.message?.key);
        if (!jid) {
          throw new Error('Received message without remoteJid');
        }

        const phone = onlyDigits(jid);

        const getChat = await this.getChat(
          data.account_id,
          data.worker_id,
          phone,
          jid
        );

        if (!getChat) {
          const createChat = await this.createChat(data);

          if (!createChat) {
            throw new Error('Failed to create chat');
          }

          await this.createChatMessage(createChat, data);
          await this.centrifugoChatQueuePublish(createChat);

          return;
        }

        await this.createChatMessage(getChat, data);
      });
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
