import { injectable, inject } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { IChatMessage, IReaction } from '@core/common/interfaces/IChatMessage';
import { v7 as uuidv7 } from 'uuid';
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
import { IUploadFileInput } from '@core/common/interfaces/IUploadFileInput';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { IMessageContext } from '@core/common/interfaces/IMessageContext';
import { IChatContext } from '@core/common/interfaces/IChatContext';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly messageTemplateService: MessageTemplateService,
    private readonly chatMessageService: ChatMessageService
  ) {}

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_others_chats,
    ];

    return hasRequiredPermission(actions, permissions);
  }

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

  private centrifugoChatPublish(dataPublish: IChatMessage): Promise<any> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
  }

  private validate(
    t: TFunction<'translation', undefined>,
    body: CreateMessageChatsBody
  ) {
    if (
      (body.type === EMessageType.text || body.type === EMessageType.system) &&
      !body.message
    ) {
      throw new Error(t('message_content_required'));
    }
  }

  private normalizeImagesArray(images?: IUploadFileInput): UploadFileRequest[] {
    if (!images) return [];

    if (Array.isArray(images)) {
      return images;
    }

    return [images];
  }

  private normalizeDocumentsArray(
    documents?: IUploadFileInput
  ): UploadFileRequest[] {
    if (!documents) return [];

    if (Array.isArray(documents)) {
      return documents;
    }

    return [documents];
  }

  private normalizeVideosArray(videos?: IUploadFileInput): UploadFileRequest[] {
    if (!videos) return [];

    if (Array.isArray(videos)) {
      return videos;
    }

    return [videos];
  }

  private normalizeAudiosArray(audios?: IUploadFileInput): UploadFileRequest[] {
    if (!audios) return [];

    if (Array.isArray(audios)) {
      return audios;
    }

    return [audios];
  }

  private normalizeContactsArray(
    contacts?: string | string[] | { value?: string | string[] } | null
  ): string[] {
    if (!contacts) return [];

    if (typeof contacts === 'object' && 'value' in contacts) {
      return this.normalizeContactsArray(contacts.value);
    }

    if (Array.isArray(contacts)) {
      return contacts.filter(
        (c): c is string => typeof c === 'string' && c.trim().length > 0
      );
    }

    if (typeof contacts === 'string' && contacts.trim().length > 0) {
      return [contacts];
    }

    return [];
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

  private normalizeDurationField(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value) && value.length > 0) {
      return this.normalizeDurationField(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('value' in record) {
        return this.normalizeDurationField(record.value);
      }
      return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    return numeric;
  }

  private normalizeBooleanFromString(value: string): boolean {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return false;
    }
    if (trimmed === 'true') return true;
    if (trimmed === '1') return true;
    if (trimmed === 'on') return true;
    return false;
  }

  private normalizeBooleanField(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (Array.isArray(value) && value.length > 0) {
      return this.normalizeBooleanField(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if ('value' in record) {
        return this.normalizeBooleanField(record.value);
      }
      return false;
    }

    if (typeof value === 'string') {
      return this.normalizeBooleanFromString(value);
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    return false;
  }

  private extractFieldValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (Array.isArray(value)) {
      return this.extractFieldValue(value[0]);
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;

      if ('value' in record) {
        return this.extractFieldValue(record.value);
      }

      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private normalizeMessageQuotedId(
    messageQuotedId: CreateMessageChatsBody['message_quoted_id']
  ): string | null {
    const rawValue = this.extractFieldValue(messageQuotedId);
    if (!rawValue) {
      return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
  }

  private normalizeHash(hash: CreateMessageChatsBody['hash']): string | null {
    const rawValue = this.extractFieldValue(hash);
    if (!rawValue) {
      return null;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
  }

  private normalizeLocationCoordinate(
    coordinate?: number | string | { value?: number | string } | null
  ): number | null {
    const rawValue = this.extractFieldValue(coordinate);
    if (!rawValue) {
      return null;
    }

    const numValue =
      typeof rawValue === 'number'
        ? rawValue
        : Number.parseFloat(String(rawValue));
    if (Number.isNaN(numValue)) {
      return null;
    }

    return numValue;
  }

  private normalizeLocationField(
    field?: string | { value?: string } | null
  ): string | null {
    const rawValue = this.extractFieldValue(field);
    if (!rawValue) {
      return null;
    }

    const trimmed = String(rawValue).trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
      return null;
    }

    return trimmed;
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
  ): Promise<IChatMessage> {
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

    const updatedMessage: IChatMessage = {
      ...message,
      content: updatedContent,
      has_quoted: message.has_quoted,
    };

    await this.chatService.saveMessageChat(updatedMessage);

    return updatedMessage;
  }

  private async processActionMessages(
    type: EMessageType,
    body: CreateMessageChatsBody,
    chat: IChat,
    chatId: string,
    accountId: string,
    context: IMessageContext
  ): Promise<boolean | null> {
    if (type === EMessageType.delete_message && body.delete_message_id) {
      return this.processDelete(
        chat,
        chatId,
        accountId,
        body.delete_message_id,
        context
      );
    }

    if (
      type === EMessageType.react &&
      body.reaction_message_id &&
      body.reaction_emoji
    ) {
      return this.processReaction(
        { chat, chatId, accountId },
        body.reaction_message_id,
        body.reaction_emoji,
        context
      );
    }

    return null;
  }

  private normalizeMessageFields(
    body: CreateMessageChatsBody,
    templateMessage: string | null
  ) {
    return {
      message: this.normalizeMessage(templateMessage || body.message),
      images: this.normalizeImagesArray(body.images),
      documents: this.normalizeDocumentsArray(body.documents),
      videos: this.normalizeVideosArray(body.videos),
      videoDuration: this.normalizeDurationField(body.video_duration),
      audios: this.normalizeAudiosArray(body.audios),
      audioDuration: this.normalizeDurationField(body.audio_duration),
      audioViewOnce: this.normalizeBooleanField(body.audio_view_once),
      audioPtt: this.normalizeBooleanField(body.audio_ptt),
      messageQuotedId: this.normalizeMessageQuotedId(body.message_quoted_id),
      contacts: this.normalizeContactsArray(body.contacts),
      hash: this.normalizeHash(body.hash),
      locationLatitude: this.normalizeLocationCoordinate(
        body.location_latitude
      ),
      locationLongitude: this.normalizeLocationCoordinate(
        body.location_longitude
      ),
      locationName: this.normalizeLocationField(body.location_name),
      locationAddress: this.normalizeLocationField(body.location_address),
    };
  }

  private async sendContactMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    contactData: {
      message: string | null;
      messageQuotedId: string | null;
      contacts: string[];
    }
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.contact_card,
      message: contactData.message,
      messageQuotedId: contactData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      contactIds: contactData.contacts,
    });
  }

  private async sendLocationMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    locationData: {
      latitude: number | null;
      longitude: number | null;
      name: string | null;
      address: string | null;
    }
  ): Promise<boolean> {
    if (locationData.latitude === null || locationData.longitude === null) {
      throw new Error(messageContext.t('location_coordinates_required'));
    }

    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.location,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      name: locationData.name,
      address: locationData.address,
    });
  }

  private async sendDocumentMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    documentData: {
      documents: UploadFileRequest[];
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
    }
  ): Promise<boolean> {
    if (documentData.documents.length === 0 && !documentData.isQuickMessage) {
      throw new Error(messageContext.t('documents_required'));
    }
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.document,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      documents:
        documentData.documents.length > 0 ? documentData.documents : undefined,
      documentUrl: documentData.isQuickMessage
        ? documentData.quickMessageUrl
        : undefined,
      documentMimetype: documentData.isQuickMessage
        ? documentData.quickMessageMimetype
        : undefined,
    });
  }

  private async sendVideoMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    videoData: {
      videos: UploadFileRequest[];
      videoDuration: number | null;
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageDuration: number | null;
      quickMessageWidth: number | null;
      quickMessageHeight: number | null;
    }
  ): Promise<boolean> {
    if (videoData.videos.length === 0 && !videoData.isQuickMessage) {
      throw new Error(messageContext.t('videos_required'));
    }
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.video,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      videos: videoData.videos.length > 0 ? videoData.videos : undefined,
      videoUrl: videoData.isQuickMessage
        ? videoData.quickMessageUrl
        : undefined,
      videoMimetype: videoData.isQuickMessage
        ? videoData.quickMessageMimetype
        : undefined,
      videoDuration:
        videoData.videoDuration ??
        (videoData.isQuickMessage
          ? videoData.quickMessageDuration
          : undefined) ??
        undefined,
      videoWidth: videoData.isQuickMessage
        ? videoData.quickMessageWidth
        : undefined,
      videoHeight: videoData.isQuickMessage
        ? videoData.quickMessageHeight
        : undefined,
    });
  }

  private async sendAudioMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    audioData: {
      audios: UploadFileRequest[];
      audioDuration: number | null;
      audioPtt: boolean;
      audioViewOnce: boolean;
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageDuration: number | null;
    }
  ): Promise<boolean> {
    if (audioData.audios.length === 0 && !audioData.isQuickMessage) {
      throw new Error(messageContext.t('audio_required'));
    }
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.audio,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      audios: audioData.audios.length > 0 ? audioData.audios : undefined,
      audioUrl: audioData.isQuickMessage
        ? audioData.quickMessageUrl
        : undefined,
      audioMimetype: audioData.isQuickMessage
        ? audioData.quickMessageMimetype
        : undefined,
      audioDuration:
        audioData.audioDuration ??
        (audioData.isQuickMessage
          ? audioData.quickMessageDuration
          : undefined) ??
        undefined,
      audioPtt: audioData.audioPtt,
      audioViewOnce: audioData.audioViewOnce,
    });
  }

  private async sendImageMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    imageData: {
      images: UploadFileRequest[];
      isQuickMessage: boolean;
      quickMessageUrl: string | null;
      quickMessageMimetype: string | null;
      quickMessageWidth: number | null;
      quickMessageHeight: number | null;
    }
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: EMessageType.image,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      images: imageData.images.length > 0 ? imageData.images : undefined,
      imageUrl: imageData.isQuickMessage
        ? imageData.quickMessageUrl
        : undefined,
      imageMimetype: imageData.isQuickMessage
        ? imageData.quickMessageMimetype
        : undefined,
      imageWidth: imageData.isQuickMessage
        ? imageData.quickMessageWidth
        : undefined,
      imageHeight: imageData.isQuickMessage
        ? imageData.quickMessageHeight
        : undefined,
    });
  }

  private async sendTextMessage(
    messageContext: IMessageContext,
    chat: IChat,
    accountId: string,
    messageData: {
      message: string | null;
      messageQuotedId: string | null;
    },
    type: EMessageType,
    linkPreview?: any
  ): Promise<boolean> {
    return this.chatMessageService.sendMessage(messageContext.t, {
      chat,
      accountId,
      type: type as EMessageType.text | EMessageType.system,
      message: messageData.message,
      messageQuotedId: messageData.messageQuotedId,
      hash: messageContext.hash,
      typeUser: messageContext.typeUser,
      linkPreview,
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: CreateMessageChatsParams,
    body: CreateMessageChatsBody,
    typeUser: ETypeUserChat,
    userId: string,
    actions: IJwtGroupHierarchy[]
  ): Promise<boolean> {
    this.validate(t, body);

    const chat = await this.getChat(accountId, params.chat_id);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!this.canViewOthersChats(actions)) {
      if (chat.user?.id) {
        if (chat.user.id !== userId) {
          throw new Error(t('chat_access_denied'));
        }
      }
    }

    const quickTemplateData = await this.resolveQuickMessageTemplate(
      t,
      accountId,
      body
    );
    const {
      templateType,
      templateMessage,
      isQuickMessage,
      quickMessageUrl,
      quickMessageMimetype,
      quickMessageDuration,
      quickMessageWidth,
      quickMessageHeight,
    } = quickTemplateData;

    const type = templateType || this.normalizeType(body.type);

    if (templateType && templateType !== this.normalizeType(body.type)) {
      throw new Error(t('message_template_type_mismatch'));
    }

    const normalizedFields = this.normalizeMessageFields(body, templateMessage);

    const actionResult = await this.processActionMessages(
      type,
      body,
      chat,
      params.chat_id,
      accountId,
      { t, hash: normalizedFields.hash, typeUser }
    );
    if (actionResult !== null) {
      return actionResult;
    }

    if (normalizedFields.contacts.length > 0) {
      return this.sendContactMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
          contacts: normalizedFields.contacts,
        }
      );
    }

    if (
      type === EMessageType.location &&
      normalizedFields.locationLatitude !== null &&
      normalizedFields.locationLongitude !== null
    ) {
      return this.sendLocationMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          latitude: normalizedFields.locationLatitude,
          longitude: normalizedFields.locationLongitude,
          name: normalizedFields.locationName,
          address: normalizedFields.locationAddress,
        }
      );
    }

    if (type === EMessageType.document) {
      return this.sendDocumentMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          documents: normalizedFields.documents,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
        }
      );
    }

    if (type === EMessageType.video) {
      return this.sendVideoMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          videos: normalizedFields.videos,
          videoDuration: normalizedFields.videoDuration,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageDuration,
          quickMessageWidth,
          quickMessageHeight,
        }
      );
    }

    if (type === EMessageType.audio) {
      return this.sendAudioMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          audios: normalizedFields.audios,
          audioDuration: normalizedFields.audioDuration,
          audioPtt: normalizedFields.audioPtt,
          audioViewOnce: normalizedFields.audioViewOnce,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageDuration,
        }
      );
    }

    if (
      normalizedFields.images.length > 0 ||
      (isQuickMessage && quickMessageUrl && type === EMessageType.image)
    ) {
      return this.sendImageMessage(
        { t, hash: normalizedFields.hash, typeUser },
        chat,
        accountId,
        {
          message: normalizedFields.message,
          messageQuotedId: normalizedFields.messageQuotedId,
        },
        {
          images: normalizedFields.images,
          isQuickMessage,
          quickMessageUrl,
          quickMessageMimetype,
          quickMessageWidth,
          quickMessageHeight,
        }
      );
    }

    return this.sendTextMessage(
      { t, hash: normalizedFields.hash, typeUser },
      chat,
      accountId,
      {
        message: normalizedFields.message,
        messageQuotedId: normalizedFields.messageQuotedId,
      },
      type,
      body.link_preview
    );
  }

  private async resolveQuickMessageTemplate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: CreateMessageChatsBody
  ): Promise<{
    templateType: EMessageType | null;
    templateMessage: string | null;
    isQuickMessage: boolean;
    quickMessageUrl: string | null;
    quickMessageMimetype: string | null;
    quickMessageDuration: number | null;
    quickMessageWidth: number | null;
    quickMessageHeight: number | null;
  }> {
    const quickMessageTemplateIdRaw = body.quick_message_template_id;
    let quickMessageTemplateId: string | null = null;

    if (typeof quickMessageTemplateIdRaw === 'string') {
      quickMessageTemplateId = quickMessageTemplateIdRaw;
    } else if (
      quickMessageTemplateIdRaw &&
      typeof quickMessageTemplateIdRaw === 'object' &&
      'value' in quickMessageTemplateIdRaw
    ) {
      quickMessageTemplateId = quickMessageTemplateIdRaw.value || null;
    }

    if (!quickMessageTemplateId) {
      return {
        templateType: null,
        templateMessage: null,
        isQuickMessage: false,
        quickMessageUrl: null,
        quickMessageMimetype: null,
        quickMessageDuration: null,
        quickMessageWidth: null,
        quickMessageHeight: null,
      };
    }

    const template = await this.messageTemplateService.viewMessageTemplateById(
      quickMessageTemplateId
    );

    if (template?.account?.account_id !== accountId) {
      throw new Error(t('message_template_not_found'));
    }

    return {
      templateType: template.type as EMessageType,
      templateMessage: template.message || null,
      isQuickMessage: true,
      quickMessageUrl: template.attachment_url || null,
      quickMessageMimetype: template.mimetype || null,
      quickMessageDuration: template.duration || null,
      quickMessageWidth: template.width || null,
      quickMessageHeight: template.height || null,
    };
  }

  private async processReaction(
    chatContext: IChatContext,
    reactionMessageId: string,
    emoji: string,
    messageContext: IMessageContext
  ): Promise<boolean> {
    const targetMessage = await this.getMessage(
      chatContext.accountId,
      reactionMessageId
    );

    if (!targetMessage) {
      throw new Error(messageContext.t('message_not_found'));
    }

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      throw new Error(messageContext.t('message_key_not_found'));
    }

    const userId = chatContext.chat.worker.id ?? '';
    const userName = chatContext.chat.worker.name ?? '';

    const updatedMessage = await this.updateMessageReaction(
      targetMessage,
      emoji,
      userId,
      userName
    );

    const reactionMessage = this.createReactionMessage(
      chatContext.chat,
      chatContext.chatId,
      updatedMessage,
      messageContext.hash,
      messageContext.typeUser
    );

    await Promise.all([
      this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerSendMessage(
          chatContext.chat.worker.id
        ),
        reactionMessage
      ),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private createReactionMessage(
    chat: IChat,
    chatId: string,
    targetMessage: IChatMessage,
    hash: string | null,
    typeUser: ETypeUserChat
  ): IChatMessage {
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: targetMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: targetMessage.message_key?.remote_jid_alt ?? null,
        from_me: targetMessage.message_key?.from_me ?? false,
        id: targetMessage.message_key?.id ?? null,
        participant: targetMessage.message_key?.participant ?? null,
        is_view_once: false,
      },
      type_user: typeUser,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: targetMessage.deleted ?? false,
      has_quoted: targetMessage.has_quoted ?? false,
      content: {
        type: EMessageType.react,
        reactions: targetMessage.content?.reactions ?? null,
      },
      date: new Date().toISOString(),
      hash: hash,
    };
  }

  private async processDelete(
    chat: IChat,
    chatId: string,
    accountId: string,
    deleteMessageId: string,
    context: IMessageContext
  ): Promise<boolean> {
    const targetMessage = await this.getMessage(accountId, deleteMessageId);

    if (!targetMessage) {
      throw new Error(context.t('message_not_found'));
    }

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      throw new Error(context.t('message_key_not_found'));
    }

    const updatedMessage = await this.markMessageAsDeleted(targetMessage);

    const deleteMessage = this.createDeleteMessage(
      chat,
      chatId,
      updatedMessage,
      context.hash,
      context.typeUser
    );

    await Promise.all([
      this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerSendMessage(chat.worker.id),
        deleteMessage
      ),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async markMessageAsDeleted(
    message: IChatMessage
  ): Promise<IChatMessage> {
    if (message.deleted) {
      return message;
    }

    let content = message.content;
    if (content?.version && content.version.length > 0) {
      const sortedVersions = [...content.version].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestVersion = sortedVersions[0];
      if (latestVersion && content.message === latestVersion.message) {
        const oldestVersion = sortedVersions.at(-1);

        if (
          oldestVersion?.message &&
          oldestVersion.message !== content.message &&
          content
        ) {
          content = {
            ...content,
            message: oldestVersion.message,
          };
        }
      }
    }

    const updatedMessage: IChatMessage = {
      ...message,
      deleted: true,
      has_quoted: message.has_quoted,
      content: content,
    };

    await this.chatService.saveMessageChat(updatedMessage);

    return updatedMessage;
  }

  private createDeleteMessage(
    chat: IChat,
    chatId: string,
    targetMessage: IChatMessage,
    hash: string | null,
    typeUser: ETypeUserChat
  ): IChatMessage {
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: targetMessage.message_key?.remote_jid ?? null,
        remote_jid_alt: targetMessage.message_key?.remote_jid_alt ?? null,
        from_me: targetMessage.message_key?.from_me ?? false,
        id: targetMessage.message_key?.id ?? null,
        participant: targetMessage.message_key?.participant ?? null,
        is_view_once: false,
      },
      type_user: typeUser,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: true,
      has_quoted: targetMessage.has_quoted ?? false,
      content: {
        type: EMessageType.delete_message,
      },
      date: new Date().toISOString(),
      hash: hash,
    };
  }
}
