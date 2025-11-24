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
import { PublishResult } from 'centrifuge';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { ICreateVideoMessageParams } from '@core/common/interfaces/ICreateVideoMessageParams';
import { ICreateAudioMessageParams } from '@core/common/interfaces/ICreateAudioMessageParams';
import { ICreateImageMessageParams } from '@core/common/interfaces/ICreateImageMessageParams';
import { ICreateTextMessageParams } from '@core/common/interfaces/ICreateTextMessageParams';
import { ICreateDocumentMessageParams } from '@core/common/interfaces/ICreateDocumentMessageParams';
import { IProcessMediaMessagesParams } from '@core/common/interfaces/IProcessMediaMessagesParams';
import { IProcessMediaMessagesOptions } from '@core/common/interfaces/IProcessMediaMessagesOptions';
import { IProcessTextMessageParams } from '@core/common/interfaces/IProcessTextMessageParams';
import { IUploadFileInput } from '@core/common/interfaces/IUploadFileInput';
import { ICreateContactMessageParams } from '@core/common/interfaces/ICreateContactMessageParams';
import { ContactService } from '@core/services/contact.service';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';

@injectable()
export class ChatMessageCreatorUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatService: ChatService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly storageService: StorageService,
    private readonly converterService: ConverterService,
    private readonly contactService: ContactService,
    private readonly contactViewerRepository: ContactViewerRepository
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

  private async uploadVideos(
    videos: UploadFileRequest[],
    accountId: string
  ): Promise<
    Array<
      UploadFileResponse & {
        duration?: number;
        width?: number;
        height?: number;
      }
    >
  > {
    const uploadPromises = videos.map(async (video) => {
      const originalBuffer = await video.toBuffer();
      const originalMimetype = video.mimetype || null;

      const converted = await this.converterService.convertVideo(
        originalBuffer,
        originalMimetype
      );

      const filename = video.filename.replace(/\.[^.]+$/, '') || 'video';
      const newFilename = `${filename}.${converted.extension}`;

      const uploadResult = await this.storageService.uploadVideoFromBuffer(
        converted.buffer,
        newFilename,
        converted.mimetype,
        accountId,
        converted.width,
        converted.height
      );

      if (!uploadResult) {
        return null;
      }

      return {
        ...uploadResult,
        mimetype: converted.mimetype,
        duration: converted.duration,
        width: converted.width ?? null,
        height: converted.height ?? null,
      };
    });

    const uploadedVideos = await Promise.all(uploadPromises);

    const filtered = uploadedVideos.filter(
      (video): video is NonNullable<typeof video> => video !== null
    );
    return filtered as Array<
      UploadFileResponse & {
        duration?: number;
        width?: number;
        height?: number;
      }
    >;
  }

  private async uploadAudios(
    audios: UploadFileRequest[],
    accountId: string,
    isPtt: boolean
  ): Promise<
    Array<UploadFileResponse & { duration?: number; waveform?: string }>
  > {
    const uploadPromises = audios.map(async (audio) => {
      const originalBuffer = await audio.toBuffer();
      const originalMimetype = audio.mimetype || null;

      const converted = await this.converterService.convertAudio(
        originalBuffer,
        originalMimetype,
        isPtt
      );

      const filename = audio.filename.replace(/\.[^.]+$/, '') || 'audio';
      const newFilename = `${filename}.${converted.extension}`;

      const [uploadResult, waveformBase64] = await Promise.all([
        this.storageService.uploadAudioFromBuffer(
          converted.buffer,
          newFilename,
          converted.mimetype,
          accountId
        ),
        this.converterService
          .generateWaveformWithFfmpeg(converted.buffer)
          .catch(() => {
            return undefined;
          }),
      ]);

      if (!uploadResult) {
        return null;
      }

      return {
        ...uploadResult,
        mimetype: converted.mimetype,
        duration: converted.duration,
        waveform: waveformBase64 ?? undefined,
      };
    });

    const uploadedAudios = await Promise.all(uploadPromises);

    const filtered = uploadedAudios.filter(
      (audio): audio is NonNullable<typeof audio> => audio !== null
    );
    return filtered as Array<
      UploadFileResponse & { duration?: number; waveform?: string }
    >;
  }

  private createImageMessage(params: ICreateImageMessageParams): IChatMessage {
    const {
      chat,
      chatId,
      type,
      message,
      imageData,
      messageQuotedId,
      quotedMessage,
      hash,
    } = params;
    return {
      message_id: uuidv7(),
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
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
      hash: hash,
    };
  }

  private createVideoMessage(
    params: ICreateVideoMessageParams,
    hash: string | null
  ): IChatMessage {
    const {
      chat,
      chatId,
      type,
      message,
      videoData,
      messageQuotedId,
      quotedMessage,
      videoDuration,
    } = params;
    return {
      message_id: uuidv7(),
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
        video: {
          url: videoData.url,
          caption: message,
          name: videoData.name,
          mimetype: videoData.mimetype,
          extension: videoData.extension,
          size: videoData.size,
          duration:
            videoDuration && Number.isFinite(videoDuration)
              ? videoDuration
              : null,
          width: videoData.width,
          height: videoData.height,
          thumbnail: null,
        },
      },
      date: new Date().toISOString(),
      hash: hash,
    };
  }

  private createAudioMessage(
    params: ICreateAudioMessageParams,
    hash: string | null
  ): IChatMessage {
    const {
      chat,
      chatId,
      type,
      message,
      audioData,
      messageQuotedId,
      quotedMessage,
      duration,
      isViewOnce,
      isPtt,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: isViewOnce,
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
        audio: {
          url: audioData.url,
          name: audioData.name,
          mimetype: audioData.mimetype,
          extension: audioData.extension,
          size: audioData.size,
          duration: duration && Number.isFinite(duration) ? duration : null,
          ptt: isPtt,
          view_once: isViewOnce,
          waveform: (audioData as { waveform?: string }).waveform ?? null,
        },
      },
      date: new Date().toISOString(),
      hash: hash,
    };
  }

  private createTextMessage(params: ICreateTextMessageParams): IChatMessage {
    const {
      chat,
      chatId,
      type,
      message,
      linkPreview,
      messageQuotedId,
      quotedMessage,
      hash,
    } = params;
    return {
      message_id: uuidv7(),
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        link_preview: linkPreview,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
      },
      date: new Date().toISOString(),
      hash: hash,
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

    const quotedImage = chatMessage.content?.image ?? null;
    const quotedVideo = chatMessage.content?.video ?? null;
    const quotedAudio = chatMessage.content?.audio ?? null;
    const quotedDocument = chatMessage.content?.document ?? null;
    const quotedSticker = chatMessage.content?.sticker ?? null;
    const quotedLocation = chatMessage.content?.location ?? null;

    let inferredType: EMessageType | null = chatMessage.content?.type ?? null;
    if (quotedVideo) inferredType = EMessageType.video;
    if (!quotedVideo && quotedImage) inferredType = EMessageType.image;
    if (!quotedVideo && !quotedImage && quotedDocument)
      inferredType = EMessageType.document;
    if (!quotedVideo && !quotedImage && !quotedDocument && quotedAudio)
      inferredType = EMessageType.audio;
    if (
      !quotedVideo &&
      !quotedImage &&
      !quotedDocument &&
      !quotedAudio &&
      quotedSticker
    )
      inferredType = EMessageType.sticker;
    if (
      !quotedVideo &&
      !quotedImage &&
      !quotedDocument &&
      !quotedAudio &&
      !quotedSticker &&
      quotedLocation
    )
      inferredType = EMessageType.location;
    const quotedContact = chatMessage.content?.contact ?? null;
    if (
      !quotedVideo &&
      !quotedImage &&
      !quotedDocument &&
      !quotedAudio &&
      !quotedSticker &&
      !quotedLocation &&
      quotedContact
    )
      inferredType = EMessageType.contact_card;

    return {
      type: inferredType,
      image: quotedImage,
      video: quotedVideo,
      audio: quotedAudio,
      document: quotedDocument,
      sticker: quotedSticker,
      location: quotedLocation,
      contact: quotedContact,
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

    if (!result) {
      return false;
    }

    if (!message.content) {
      return true;
    }

    const messageText = extractMessageTextFromContent(message.content);

    const summaryUpdate: IChat['summary'] = {
      last_message: messageText,
      last_date: message.date,
      unread_count: 0,
    };

    const summaryUpdated = await this.chatService.updateChatSummary(
      message.chat_id,
      summaryUpdate
    );

    if (!summaryUpdated) {
      return false;
    }

    const updatedChat = await this.chatService.findChatByChatId(
      message.account.id,
      message.chat_id
    );

    if (!updatedChat) {
      return false;
    }

    const channelAccountId = updatedChat.account.id;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);

    return true;
  }

  private async processImageMessages(
    images: UploadFileRequest[],
    params: IProcessMediaMessagesParams
  ): Promise<boolean> {
    const { chat, chatId, accountId, type, message, messageQuotedId, t, hash } =
      params;
    let validImages: UploadFileResponse[];
    try {
      validImages = await this.uploadImages(images, accountId);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'IMAGE_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('image_size_exceeded'));
        }
        if (error.message === 'INVALID_IMAGE_FORMAT') {
          throw new Error(t('invalid_image_format'));
        }
      }

      throw error;
    }

    if (validImages.length === 0) {
      return false;
    }

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

    const quotedId = messageQuotedId ?? null;

    if (validImages.length === 1) {
      const imageMessage = this.createImageMessage({
        chat,
        chatId,
        type,
        message,
        imageData: validImages[0],
        messageQuotedId: quotedId,
        quotedMessage,
        hash,
      });

      await this.publishMessage(imageMessage);

      return true;
    }

    const publishTasks = validImages.map((imageData) => {
      const imageMessage = this.createImageMessage({
        chat,
        chatId,
        type,
        message,
        imageData,
        messageQuotedId: quotedId,
        quotedMessage,
        hash,
      });

      return this.publishMessage(imageMessage);
    });

    await Promise.all(publishTasks);

    return true;
  }

  private async processVideoMessages(
    videos: UploadFileRequest[],
    videoDuration: number | null,
    params: IProcessMediaMessagesParams
  ): Promise<boolean> {
    const { chat, chatId, accountId, type, message, messageQuotedId, t, hash } =
      params;
    let validVideos: UploadFileResponse[];
    try {
      validVideos = await this.uploadVideos(videos, accountId);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'VIDEO_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('video_size_exceeded'));
        }
        if (error.message === 'INVALID_VIDEO_FORMAT') {
          throw new Error(t('invalid_video_format'));
        }
      }

      throw error;
    }

    if (validVideos.length === 0) {
      return false;
    }

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

    const quotedId = messageQuotedId ?? null;

    if (validVideos.length === 1) {
      const videoMessage = this.createVideoMessage(
        {
          chat,
          chatId,
          type,
          message,
          videoData: validVideos[0],
          messageQuotedId: quotedId,
          quotedMessage,
          videoDuration,
        },
        hash
      );

      await this.publishMessage(videoMessage);

      return true;
    }

    const publishTasks = validVideos.map((videoData) => {
      const videoMessage = this.createVideoMessage(
        {
          chat,
          chatId,
          type,
          message,
          videoData,
          messageQuotedId: quotedId,
          quotedMessage,
          videoDuration,
        },
        hash
      );

      return this.publishMessage(videoMessage);
    });

    await Promise.all(publishTasks);

    return true;
  }

  private async processAudioMessages(
    audios: UploadFileRequest[],
    audioDuration: number | null,
    isViewOnce: boolean,
    isPtt: boolean,
    params: IProcessMediaMessagesParams
  ): Promise<boolean> {
    const { chat, chatId, accountId, type, message, messageQuotedId, t, hash } =
      params;
    let validAudios: Array<
      UploadFileResponse & { duration?: number; waveform?: string }
    >;

    try {
      validAudios = await this.uploadAudios(audios, accountId, isPtt);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'AUDIO_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('audio_size_exceeded'));
        }
      }

      throw error;
    }

    if (validAudios.length === 0) {
      return false;
    }

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

    const quotedId = messageQuotedId ?? null;

    if (validAudios.length === 1) {
      const finalDuration = audioDuration ?? validAudios[0].duration ?? null;
      const audioMessage = this.createAudioMessage(
        {
          chat,
          chatId,
          type,
          message,
          audioData: validAudios[0],
          messageQuotedId: quotedId,
          quotedMessage,
          duration: finalDuration,
          isViewOnce,
          isPtt,
        },
        hash
      );

      await this.publishMessage(audioMessage);

      return true;
    }

    const publishTasks = validAudios.map((audioData) => {
      const finalDuration = audioDuration ?? audioData.duration ?? null;
      const audioMessage = this.createAudioMessage(
        {
          chat,
          chatId,
          type,
          message,
          audioData,
          messageQuotedId: quotedId,
          quotedMessage,
          duration: finalDuration,
          isViewOnce,
          isPtt,
        },
        hash
      );

      return this.publishMessage(audioMessage);
    });

    await Promise.all(publishTasks);

    return true;
  }

  private async processDocumentMessages(
    documents: UploadFileRequest[],
    params: IProcessMediaMessagesParams
  ): Promise<boolean> {
    const { chat, chatId, accountId, type, message, messageQuotedId, t, hash } =
      params;
    let uploadedDocuments: Array<UploadFileResponse | null>;
    try {
      uploadedDocuments = await Promise.all(
        documents.map((document) =>
          this.storageService.uploadDocument(document, accountId)
        )
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'DOCUMENT_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('document_size_exceeded'));
        }
        if (error.message === 'IMAGE_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('image_size_exceeded'));
        }
      }

      throw error;
    }

    const validDocuments = uploadedDocuments.filter(
      (doc): doc is UploadFileResponse => doc !== null
    );

    if (validDocuments.length === 0) {
      return false;
    }

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

    const quotedId = messageQuotedId ?? null;

    if (validDocuments.length === 1) {
      const documentMessage = this.createDocumentMessage({
        chat,
        chatId,
        type,
        message,
        documentData: validDocuments[0],
        messageQuotedId: quotedId,
        quotedMessage,
        hash,
      });

      await this.publishMessage(documentMessage);

      return true;
    }

    const publishTasks = validDocuments.map((documentData) => {
      const documentMessage = this.createDocumentMessage({
        chat,
        chatId,
        type,
        message,
        documentData,
        messageQuotedId: quotedId,
        quotedMessage,
        hash,
      });

      return this.publishMessage(documentMessage);
    });

    await Promise.all(publishTasks);

    return true;
  }

  private async processTextMessage(
    params: IProcessTextMessageParams
  ): Promise<boolean> {
    const {
      chat,
      chatId,
      type,
      message,
      linkPreview,
      messageQuotedId,
      accountId,
      t,
      hash,
    } = params;
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

    const textMessage = this.createTextMessage({
      chat,
      chatId,
      type,
      message,
      linkPreview,
      messageQuotedId: messageQuotedId ?? null,
      quotedMessage,
      hash,
    });

    return this.publishMessage(textMessage);
  }

  private async processContactMessages(
    contactIds: string[],
    params: ICreateContactMessageParams
  ): Promise<boolean> {
    const {
      chat,
      chatId,
      type,
      message,
      messageQuotedId,
      quotedMessage,
      hash,
    } = params;

    if (contactIds.length === 0) return false;

    const contactsData = await Promise.all(
      contactIds.map(async (contactId) => {
        const contact = await this.contactViewerRepository.viewContactById(
          contactId,
          chat.account.id
        );
        if (!contact) return null;

        const sensitiveData =
          await this.contactService.getContactSensitiveDataDecrypted(contactId);

        return {
          contact_id: contact.contact_id,
          name: contact.name,
          last_name: contact.last_name,
          phone: sensitiveData?.phone || null,
          phone_partial: contact.phone_partial || null,
          phone_ddi: contact.phone_ddi || null,
          email: sensitiveData?.email || null,
          email_partial: contact.email_partial,
          photo: contact.photo || null,
        };
      })
    );

    const validContacts = contactsData.filter(
      (c): c is NonNullable<typeof c> => c !== null
    );

    if (validContacts.length === 0) {
      return false;
    }

    const publishTasks = validContacts.map((contactData) => {
      const messageHash = hash || uuidv7();
      const contactMessage: IChatMessage = {
        message_id: uuidv7(),
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
          is_sent_to_internal: true,
        },
        deleted: false,
        has_quoted: !!quotedMessage,
        content: {
          type,
          message,
          message_quoted_id: messageQuotedId,
          quoted: quotedMessage,
          contact: {
            contact_id: contactData.contact_id,
            name: contactData.name,
            last_name: contactData.last_name,
            phone: contactData.phone,
            phone_partial: contactData.phone_partial,
            phone_ddi: contactData.phone_ddi,
            email: contactData.email,
            email_partial: contactData.email_partial,
            photo: contactData.photo,
          },
        },
        date: new Date().toISOString(),
        hash: messageHash,
      };

      return this.publishMessage(contactMessage);
    });

    await Promise.all(publishTasks);

    return true;
  }

  private async processLocationMessage(params: {
    chat: IChat;
    chatId: string;
    type: EMessageType;
    message: string | null;
    messageQuotedId: string | null;
    quotedMessage: IQuotedMessage | null;
    hash: string | null;
    latitude: number;
    longitude: number;
    name?: string | null;
    address?: string | null;
  }): Promise<boolean> {
    const {
      chat,
      chatId,
      type,
      message,
      messageQuotedId,
      quotedMessage,
      hash,
      latitude,
      longitude,
      name,
      address,
    } = params;

    const messageHash = hash || uuidv7();
    const locationMessage: IChatMessage = {
      message_id: uuidv7(),
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
        location: {
          latitude,
          longitude,
          name: name ?? null,
          address: address ?? null,
        },
      },
      date: new Date().toISOString(),
      hash: messageHash,
    };

    await this.publishMessage(locationMessage);

    return true;
  }

  private async processActionMessages(
    type: EMessageType,
    body: CreateMessageChatsBody,
    chat: IChat,
    chatId: string,
    accountId: string,
    t: TFunction<'translation', undefined>,
    hash: string | null
  ): Promise<boolean | null> {
    if (type === EMessageType.delete_message && body.delete_message_id) {
      return this.processDelete(
        chat,
        chatId,
        accountId,
        body.delete_message_id,
        t,
        hash
      );
    }

    if (
      type === EMessageType.react &&
      body.reaction_message_id &&
      body.reaction_emoji
    ) {
      return this.processReaction(
        chat,
        chatId,
        accountId,
        body.reaction_message_id,
        body.reaction_emoji,
        t,
        hash
      );
    }

    return null;
  }

  private async processMediaMessages(
    options: IProcessMediaMessagesOptions
  ): Promise<boolean | null> {
    const {
      type,
      documents,
      videos,
      videoDuration,
      audios,
      audioDuration,
      audioViewOnce,
      audioPtt,
      t,
    } = options;

    if (type === EMessageType.document) {
      if (documents.length === 0) {
        throw new Error(t('documents_required'));
      }
      return this.processDocumentMessages(documents, options);
    }

    if (type === EMessageType.video) {
      if (videos.length === 0) {
        throw new Error(t('videos_required'));
      }
      return this.processVideoMessages(videos, videoDuration, options);
    }

    if (type === EMessageType.audio) {
      if (audios.length === 0) {
        throw new Error(t('audio_required'));
      }
      return this.processAudioMessages(
        audios,
        audioDuration,
        audioViewOnce,
        audioPtt,
        options
      );
    }

    return null;
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

    const type = this.normalizeType(body.type);
    const message = this.normalizeMessage(body.message);
    const images = this.normalizeImagesArray(body.images);
    const documents = this.normalizeDocumentsArray(body.documents);
    const videos = this.normalizeVideosArray(body.videos);
    const videoDuration = this.normalizeDurationField(body.video_duration);
    const audios = this.normalizeAudiosArray(body.audios);
    const audioDuration = this.normalizeDurationField(body.audio_duration);
    const audioViewOnce = this.normalizeBooleanField(body.audio_view_once);
    const audioPtt = this.normalizeBooleanField(body.audio_ptt);
    const messageQuotedId = this.normalizeMessageQuotedId(
      body.message_quoted_id
    );
    const contacts = this.normalizeContactsArray(body.contacts);
    const hash = this.normalizeHash(body.hash);
    const locationLatitude = this.normalizeLocationCoordinate(
      body.location_latitude
    );
    const locationLongitude = this.normalizeLocationCoordinate(
      body.location_longitude
    );
    const locationName = this.normalizeLocationField(body.location_name);
    const locationAddress = this.normalizeLocationField(body.location_address);

    const actionResult = await this.processActionMessages(
      type,
      body,
      chat,
      params.chat_id,
      accountId,
      t,
      hash
    );
    if (actionResult !== null) {
      return actionResult;
    }

    const mediaResult = await this.processMediaMessages({
      type,
      chat,
      chatId: params.chat_id,
      accountId,
      message,
      messageQuotedId,
      t,
      hash,
      documents,
      videos,
      videoDuration,
      audios,
      audioDuration,
      audioViewOnce,
      audioPtt,
    });
    if (mediaResult !== null) {
      return mediaResult;
    }

    if (contacts.length > 0) {
      const quotedMessage = messageQuotedId
        ? await this.getQuotedMessage(
            accountId,
            params.chat_id,
            messageQuotedId
          )
        : null;

      return this.processContactMessages(contacts, {
        chat,
        chatId: params.chat_id,
        type: EMessageType.contact_card,
        message,
        messageQuotedId,
        quotedMessage,
        hash,
      });
    }

    if (
      type === EMessageType.location &&
      locationLatitude !== null &&
      locationLongitude !== null
    ) {
      const quotedMessage = messageQuotedId
        ? await this.getQuotedMessage(
            accountId,
            params.chat_id,
            messageQuotedId
          )
        : null;

      return this.processLocationMessage({
        chat,
        chatId: params.chat_id,
        type: EMessageType.location,
        message,
        messageQuotedId,
        quotedMessage,
        hash,
        latitude: locationLatitude,
        longitude: locationLongitude,
        name: locationName,
        address: locationAddress,
      });
    }

    if (images.length > 0) {
      return this.processImageMessages(images, {
        chat,
        chatId: params.chat_id,
        accountId,
        type,
        message,
        messageQuotedId,
        t,
        hash,
      });
    }

    return this.processTextMessage({
      chat,
      chatId: params.chat_id,
      accountId,
      type,
      message,
      messageQuotedId,
      linkPreview: body.link_preview,
      t,
      hash,
    });
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

  private async processReaction(
    chat: IChat,
    chatId: string,
    accountId: string,
    reactionMessageId: string,
    emoji: string,
    t: TFunction<'translation', undefined>,
    hash: string | null
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

    const updatedMessage = await this.updateMessageReaction(
      targetMessage,
      emoji,
      userId,
      userName
    );

    const reactionMessage = this.createReactionMessage(
      chat,
      chatId,
      updatedMessage,
      hash
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
    targetMessage: IChatMessage,
    hash: string | null
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
      type_user: ETypeUserChat.operator,
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
    t: TFunction<'translation', undefined>,
    hash: string | null
  ): Promise<boolean> {
    const targetMessage = await this.getMessage(accountId, deleteMessageId);

    if (!targetMessage) {
      throw new Error(t('message_not_found'));
    }

    if (
      !targetMessage.message_key?.id ||
      !targetMessage.message_key?.remote_jid
    ) {
      throw new Error(t('message_key_not_found'));
    }

    const updatedMessage = await this.markMessageAsDeleted(targetMessage);

    const deleteMessage = this.createDeleteMessage(
      chat,
      chatId,
      updatedMessage,
      hash
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
    hash: string | null
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
      type_user: ETypeUserChat.operator,
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

  private createDocumentMessage(
    params: ICreateDocumentMessageParams
  ): IChatMessage {
    const {
      chat,
      chatId,
      type,
      message,
      documentData,
      messageQuotedId,
      quotedMessage,
      hash,
    } = params;
    return {
      message_id: uuidv7(),
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
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: !!quotedMessage,
      content: {
        type,
        message,
        message_quoted_id: messageQuotedId,
        quoted: quotedMessage,
        document: {
          url: documentData.url,
          name: documentData.name,
          mimetype: documentData.mimetype ?? null,
          extension: documentData.extension,
          size: documentData.size,
        },
      },
      date: new Date().toISOString(),
      hash: hash,
    };
  }
}
