import { injectable, inject } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import {
  IChatMessage,
  IQuotedMessage,
  IReaction,
} from '@core/common/interfaces/IChatMessage';
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
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { StorageService } from '@core/services/storage.service';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly storageService: StorageService
  ) {}

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IChat | null> {
    const cacheKey = `chat:${accountId}:${chatId}`;
    const cache = await this.redis.get(cacheKey);

    if (cache) {
      return JSON.parse(cache) as IChat;
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

    if (!data) {
      return null;
    }

    await this.redis.set(cacheKey, JSON.stringify(data), 'EX', 1800);

    return data;
  }

  private async getChatMessage(
    accountId: string,
    chatId: string,
    chatMessageId: string
  ): Promise<IChatMessage | null> {
    const queryElastic = {
      query: {
        bool: {
          filter: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': accountId },
                },
              },
            },
            { term: { chat_id: chatId } },
            { term: { message_id: chatMessageId } },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    const data = result?.hits.hits[0]?._source as IChatMessage | null;

    if (!data) {
      return null;
    }

    return data;
  }

  private centrifugoChatPublish(
    dataPublish: IChatMessage
  ): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  private validate(
    t: TFunction<'translation', undefined>,
    body: CreateMessageChatsBody
  ) {
    if (body.type === EMessageType.text && !body.message) {
      throw new Error(t('message_content_required'));
    }

    if (body.type === EMessageType.text_quoted && !body.message_quoted_id) {
      throw new Error(t('message_quoted_id_required'));
    }
  }

  private normalizeImagesArray(
    images?: UploadFileRequest | UploadFileRequest[] | null
  ): UploadFileRequest[] {
    if (!images) return [];

    if (Array.isArray(images)) {
      return images;
    }

    return [images];
  }

  private normalizeType(type: string | { value?: string }): EMessageType {
    if (type && typeof type === 'object' && 'value' in type && type.value) {
      return type.value as EMessageType;
    }

    return type as EMessageType;
  }

  private normalizeMessage(
    message?: string | { value?: string }
  ): string | null {
    if (
      message &&
      typeof message === 'object' &&
      'value' in message &&
      message.value
    ) {
      return message.value;
    }

    return message as string | null;
  }

  private async uploadImages(
    images: UploadFileRequest[],
    accountId: string
  ): Promise<UploadFileResponse[]> {
    const uploadPromises = images.map((image) =>
      this.storageService.uploadImage(image, accountId)
    );

    const uploadedImages = await Promise.all(uploadPromises);

    return uploadedImages.filter(
      (img): img is UploadFileResponse => img !== null
    );
  }

  private createImageMessage(
    chat: IChat,
    chatId: string,
    type: EMessageType,
    message: string | null,
    imageData: UploadFileResponse
  ): IChatMessage {
    return {
      message_id: uuidv4(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      content: {
        type,
        message,
        image: {
          url: imageData.url,
          caption: message,
          mimetype: imageData.mimetype,
          extension: imageData.extension,
          size: imageData.size,
          width: imageData.width,
          height: imageData.height,
        },
      },
      date: new Date().toISOString(),
    };
  }

  private createTextMessage(
    chat: IChat,
    chatId: string,
    type: EMessageType,
    message: string | null,
    linkPreview: CreateMessageChatsBody['link_preview'],
    quotedMessage: IQuotedMessage | null
  ): IChatMessage {
    return {
      message_id: uuidv4(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      content: {
        type,
        message,
        link_preview: linkPreview,
        quoted: quotedMessage,
      },
      date: new Date().toISOString(),
    };
  }

  private async getQuotedMessage(
    accountId: string,
    chatId: string,
    messageQuotedId: string
  ): Promise<IQuotedMessage | null> {
    const chatMessage = await this.getChatMessage(
      accountId,
      chatId,
      messageQuotedId
    );

    if (!chatMessage) {
      return null;
    }

    return {
      key: {
        remote_jid: chatMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: chatMessage.message_key?.remote_jid_alt ?? null,
        from_me: chatMessage.message_key?.from_me ?? null,
        id: chatMessage.message_key?.id ?? null,
        participant: chatMessage.message_key?.participant ?? null,
        participant_alt: chatMessage.message_key?.participant_alt ?? null,
        addressing_mode: chatMessage.message_key?.addressing_mode ?? null,
        is_view_once: chatMessage.message_key?.is_view_once ?? false,
      },
      message: chatMessage.content?.message ?? null,
    };
  }

  private async publishMessage(message: IChatMessage): Promise<boolean> {
    const [result, ,] = await Promise.all([
      this.chatService.saveMessageChat(message),
      this.centrifugoChatPublish(message),
      this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerSendMessage(message.worker.id),
        message
      ),
    ]);

    return result;
  }

  private getRandomDelay(): number {
    return Math.floor(Math.random() * (2000 - 500 + 1)) + 500;
  }

  private async processImageMessages(
    chat: IChat,
    chatId: string,
    images: UploadFileRequest[],
    accountId: string,
    type: EMessageType,
    message: string | null
  ): Promise<boolean> {
    const validImages = await this.uploadImages(images, accountId);

    if (validImages.length === 0) {
      return false;
    }

    if (validImages.length === 1) {
      const imageMessage = this.createImageMessage(
        chat,
        chatId,
        type,
        message,
        validImages[0]
      );

      await this.publishMessage(imageMessage);

      return true;
    }

    for (let i = 0; i < validImages.length; i++) {
      if (i > 0) {
        const delay = this.getRandomDelay();
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const imageMessage = this.createImageMessage(
        chat,
        chatId,
        type,
        message,
        validImages[i]
      );

      await this.publishMessage(imageMessage);
    }

    return true;
  }

  private async processTextMessage(
    chat: IChat,
    chatId: string,
    type: EMessageType,
    message: string | null,
    linkPreview: CreateMessageChatsBody['link_preview'],
    messageQuotedId: string | null | undefined,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    let quotedMessage: IQuotedMessage | null = null;

    if (messageQuotedId) {
      quotedMessage = await this.getQuotedMessage(
        accountId,
        chatId,
        messageQuotedId
      );

      if (!quotedMessage) {
        throw new Error(t('message_quoted_not_found'));
      }
    }

    const textMessage = this.createTextMessage(
      chat,
      chatId,
      type,
      message,
      linkPreview,
      quotedMessage
    );

    return this.publishMessage(textMessage);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody
  ): Promise<boolean> {
    this.validate(t, body);

    const chat = await this.getChat(accountId, params.chat_id);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (body.reaction_message_id && body.reaction_emoji) {
      return this.processReaction(
        chat,
        params.chat_id,
        accountId,
        body.reaction_message_id,
        body.reaction_emoji,
        t
      );
    }

    const images = this.normalizeImagesArray(body.images);
    const type = this.normalizeType(body.type);
    const message = this.normalizeMessage(body.message);

    if (images.length > 0) {
      return this.processImageMessages(
        chat,
        params.chat_id,
        images,
        accountId,
        type,
        message
      );
    }

    return this.processTextMessage(
      chat,
      params.chat_id,
      type,
      message,
      body.link_preview,
      body.message_quoted_id,
      accountId,
      t
    );
  }

  private async getMessage(
    accountId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    const query = {
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
      query
    );

    if (!result || result.hits.hits.length === 0) {
      return null;
    }

    return result.hits.hits[0]._source as IChatMessage;
  }

  private async updateMessageReaction(
    message: IChatMessage,
    emoji: string,
    userId: string,
    userName: string
  ): Promise<void> {
    const existingReactions = message.content?.reactions || [];
    const reactionsWithoutUser = existingReactions.filter(
      (reaction) => reaction.user_id !== userId
    );

    let updatedReactions: IReaction[] = reactionsWithoutUser;
    if (emoji) {
      updatedReactions = [
        ...reactionsWithoutUser,
        {
          emoji,
          user_id: userId,
          user_name: userName,
        },
      ];
    }

    let reactionsValue: IReaction[] | null = null;
    if (updatedReactions.length > 0) {
      reactionsValue = updatedReactions;
    }

    const updatedContent: IChatMessage['content'] = {
      ...message.content,
      type: message.content?.type ?? EMessageType.text,
      reactions: reactionsValue,
    };

    await this.chatService.saveMessageChat({
      ...message,
      content: updatedContent,
    });
  }

  private async processReaction(
    chat: IChat,
    chatId: string,
    accountId: string,
    reactionMessageId: string,
    emoji: string,
    t: TFunction<'translation', undefined>
  ): Promise<boolean> {
    const targetMessage = await this.getMessage(accountId, reactionMessageId);

    if (!targetMessage) {
      throw new Error(t('message_not_found'));
    }

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      throw new Error(t('message_key_not_found'));
    }

    const userId = chat.worker.id ?? '';
    const userName = chat.worker.name ?? '';

    await this.updateMessageReaction(targetMessage, emoji, userId, userName);

    const updatedMessage = await this.getMessage(accountId, reactionMessageId);
    if (!updatedMessage) {
      return false;
    }

    const reactionMessage = this.createReactionMessage(
      chat,
      chatId,
      updatedMessage
    );

    await Promise.all([
      this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerSendMessage(chat.worker.id),
        reactionMessage
      ),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private createReactionMessage(
    chat: IChat,
    chatId: string,
    targetMessage: IChatMessage
  ): IChatMessage {
    return {
      message_id: uuidv4(),
      chat_id: chatId,
      message_key: {
        remote_jid: targetMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: targetMessage.message_key?.remote_jid_alt ?? null,
        from_me: targetMessage.message_key?.from_me ?? false,
        id: targetMessage.message_key?.id ?? null,
        participant: targetMessage.message_key?.participant ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
      },
      content: {
        type: EMessageType.react,
        reactions: targetMessage.content?.reactions ?? null,
      },
      date: new Date().toISOString(),
    };
  }
}
