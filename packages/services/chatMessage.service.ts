import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { ChatService } from './chat.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { StreamProducerService } from './streamProducer.service';
import { KafkaBaileysQueueService } from './kafkaBaileysQueue.service';
import { CentrifugoService } from './centrifugo.service';
import { StorageService } from './storage.service';
import { ConverterService } from './converter';
import { ContactService } from './contact.service';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';
import { WorkerService } from './worker.service';
import { v7 as uuidv7 } from 'uuid';
import {
  IChatMessage,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import Redis from 'ioredis';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { ICreateVideoMessageParams } from '@core/common/interfaces/ICreateVideoMessageParams';
import { ICreateAudioMessageParams } from '@core/common/interfaces/ICreateAudioMessageParams';
import { ICreateImageMessageParams } from '@core/common/interfaces/ICreateImageMessageParams';
import { ICreateTextMessageParams } from '@core/common/interfaces/ICreateTextMessageParams';
import { ICreateDocumentMessageParams } from '@core/common/interfaces/ICreateDocumentMessageParams';
import {
  SendMessageOptions,
  ISendImageMessageOptions,
  ISendVideoMessageOptions,
  ISendAudioMessageOptions,
  ISendDocumentMessageOptions,
  ISendLocationMessageOptions,
  ISendContactMessageOptions,
} from '@core/common/interfaces/ISendMessageOptions';

@injectable()
export class ChatMessageService {
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
    private readonly contactViewerRepository: ContactViewerRepository,
    private readonly workerService: WorkerService
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

  private async formatOperatorTextWithAttendeeName(
    chat: IChat,
    message: string | null,
    messageType?: EMessageType
  ): Promise<string> {
    const text = message ?? '';

    if (
      !text ||
      !chat.worker?.id ||
      !chat.user?.name ||
      messageType === EMessageType.system ||
      messageType === EMessageType.annotation
    ) {
      return text;
    }

    const workerConfig =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    if (!workerConfig?.show_attendee_name) {
      return text;
    }

    const prefix = `*${chat.user.name}*:\n\n`;
    if (text.startsWith(prefix)) {
      return text;
    }

    return `${prefix}${text}`;
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

  private centrifugoChatPublish(dataPublish: IChatMessage): Promise<any> {
    return this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );
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
    const messageType = message.content?.type;
    const isAnnotation = messageType === EMessageType.annotation;

    const promises: Promise<any>[] = [
      this.chatService.saveMessageChat(message),
      this.centrifugoChatPublish(message),
    ];

    if (!isAnnotation) {
      const kafkaTopic = this.kafkaBaileysQueueService.workerSendMessage(
        message.worker.id
      );
      promises.push(this.streamProducerService.send(kafkaTopic, message));
    }

    const [result] = await Promise.all(promises);

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
      typeUser,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
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
      typeUser,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
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
      typeUser,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
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
      typeUser,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: isViewOnce,
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
      typeUser,
    } = params;
    return {
      message_id: uuidv7(),
      chat_id: chatId,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
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

  async sendMessage(
    t: TFunction<'translation', undefined>,
    options: SendMessageOptions
  ): Promise<boolean> {
    const { chat, accountId, type, message, messageQuotedId, hash, typeUser } =
      options;

    const chatData = await this.getChat(accountId, chat.chat_id);
    if (!chatData) {
      throw new Error(t('chat_not_found'));
    }

    let quotedMessage: IQuotedMessage | null = null;
    if (messageQuotedId) {
      quotedMessage = await this.getQuotedMessage(
        accountId,
        chat.chat_id,
        messageQuotedId
      );
    }

    const quotedId = messageQuotedId ?? null;
    const normalizedHash = hash ?? null;

    if (
      type === EMessageType.text ||
      type === EMessageType.system ||
      type === EMessageType.annotation
    ) {
      const formattedMessage = await this.formatOperatorTextWithAttendeeName(
        chatData,
        message ?? null,
        type
      );

      const textMessage = this.createTextMessage({
        chat: chatData,
        chatId: chat.chat_id,
        type,
        message: formattedMessage,
        linkPreview: 'linkPreview' in options ? options.linkPreview : undefined,
        messageQuotedId: quotedId,
        quotedMessage,
        hash: normalizedHash,
        typeUser,
      });

      return this.publishMessage(textMessage);
    }

    if (type === EMessageType.image) {
      const imageOptions = options as ISendImageMessageOptions;
      let imageData: UploadFileResponse | null = null;

      if (imageOptions.imageUrl) {
        imageData = {
          url: imageOptions.imageUrl,
          name: `image.${imageOptions.imageMimetype?.split('/')[1] || 'jpg'}`,
          mimetype: imageOptions.imageMimetype || 'image/jpeg',
          size: 0,
          extension: imageOptions.imageMimetype?.split('/')[1] || 'jpg',
          width: imageOptions.imageWidth ?? undefined,
          height: imageOptions.imageHeight ?? undefined,
        };
      } else if (imageOptions.images && imageOptions.images.length > 0) {
        const uploadedImages = await this.uploadImages(
          imageOptions.images,
          accountId
        );
        if (uploadedImages.length > 0) {
          imageData = uploadedImages[0];
        }
      }

      if (!imageData) {
        return false;
      }

      const imageMessage = this.createImageMessage({
        chat: chatData,
        chatId: chat.chat_id,
        type,
        message: message ?? null,
        imageData,
        messageQuotedId: quotedId,
        quotedMessage,
        hash: normalizedHash,
        typeUser,
      });

      return this.publishMessage(imageMessage);
    }

    if (type === EMessageType.video) {
      const videoOptions = options as ISendVideoMessageOptions;
      let videoData:
        | (UploadFileResponse & {
            duration?: number;
            width?: number;
            height?: number;
          })
        | null = null;

      if (videoOptions.videoUrl) {
        videoData = {
          url: videoOptions.videoUrl,
          name: `video.${videoOptions.videoMimetype?.split('/')[1] || 'mp4'}`,
          mimetype: videoOptions.videoMimetype || 'video/mp4',
          size: 0,
          extension: videoOptions.videoMimetype?.split('/')[1] || 'mp4',
          width: videoOptions.videoWidth ?? undefined,
          height: videoOptions.videoHeight ?? undefined,
          duration: videoOptions.videoDuration ?? undefined,
        };
      } else if (videoOptions.videos && videoOptions.videos.length > 0) {
        const uploadedVideos = await this.uploadVideos(
          videoOptions.videos,
          accountId
        );
        if (uploadedVideos.length > 0) {
          videoData = uploadedVideos[0];
        }
      }

      if (!videoData) {
        return false;
      }

      const finalDuration =
        videoOptions.videoDuration ?? videoData.duration ?? null;

      const videoMessage = this.createVideoMessage(
        {
          chat: chatData,
          chatId: chat.chat_id,
          type,
          message: message ?? null,
          videoData,
          messageQuotedId: quotedId,
          quotedMessage,
          videoDuration: finalDuration,
          typeUser,
        },
        normalizedHash
      );

      return this.publishMessage(videoMessage);
    }

    if (type === EMessageType.audio) {
      const audioOptions = options as ISendAudioMessageOptions;
      let audioData:
        | (UploadFileResponse & {
            duration?: number;
            waveform?: string;
          })
        | null = null;

      if (audioOptions.audioUrl) {
        audioData = {
          url: audioOptions.audioUrl,
          name: `audio.${audioOptions.audioMimetype?.split('/')[1] || 'mp3'}`,
          mimetype: audioOptions.audioMimetype || 'audio/mpeg',
          size: 0,
          extension: audioOptions.audioMimetype?.split('/')[1] || 'mp3',
          duration: audioOptions.audioDuration ?? undefined,
        };
      } else if (audioOptions.audios && audioOptions.audios.length > 0) {
        const uploadedAudios = await this.uploadAudios(
          audioOptions.audios,
          accountId,
          audioOptions.audioPtt ?? false
        );
        if (uploadedAudios.length > 0) {
          audioData = uploadedAudios[0];
        }
      }

      if (!audioData) {
        return false;
      }

      const finalDuration =
        audioOptions.audioDuration ?? audioData.duration ?? null;

      const audioMessage = this.createAudioMessage(
        {
          chat: chatData,
          chatId: chat.chat_id,
          type,
          message: message ?? null,
          audioData,
          messageQuotedId: quotedId,
          quotedMessage,
          duration: finalDuration,
          isViewOnce: audioOptions.audioViewOnce ?? false,
          isPtt: audioOptions.audioPtt ?? false,
          typeUser,
        },
        normalizedHash
      );

      return this.publishMessage(audioMessage);
    }

    if (type === EMessageType.document) {
      const documentOptions = options as ISendDocumentMessageOptions;
      let documentData: UploadFileResponse | null = null;

      if (documentOptions.documentUrl) {
        documentData = {
          url: documentOptions.documentUrl,
          name: `document.${documentOptions.documentMimetype?.split('/')[1] || 'pdf'}`,
          mimetype: documentOptions.documentMimetype || 'application/pdf',
          size: 0,
          extension: documentOptions.documentMimetype?.split('/')[1] || 'pdf',
        };
      } else if (
        documentOptions.documents &&
        documentOptions.documents.length > 0
      ) {
        const uploadedDocuments = await Promise.all(
          documentOptions.documents.map((document) =>
            this.storageService.uploadDocument(document, accountId)
          )
        );
        const validDocuments = uploadedDocuments.filter(
          (doc): doc is UploadFileResponse => doc !== null
        );
        if (validDocuments.length > 0) {
          documentData = validDocuments[0];
        }
      }

      if (!documentData) {
        return false;
      }

      const documentMessage = this.createDocumentMessage({
        chat: chatData,
        chatId: chat.chat_id,
        type,
        message: message ?? null,
        documentData,
        messageQuotedId: quotedId,
        quotedMessage,
        hash: normalizedHash,
        typeUser,
      });

      return this.publishMessage(documentMessage);
    }

    if (type === EMessageType.location) {
      const locationOptions = options as ISendLocationMessageOptions;

      const locationMessage: IChatMessage = {
        message_id: uuidv7(),
        chat_id: chat.chat_id,
        message_key: {
          remote_jid: chatData.message_key?.remote_jid ?? null,
          remote_jid_alt: chatData.message_key?.remote_jid_alt ?? null,
          is_view_once: false,
        },
        type_user: typeUser,
        account: chatData.account,
        worker: chatData.worker,
        user: chatData.user,
        phone: chatData.phone,
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
          message: message ?? null,
          message_quoted_id: quotedId,
          quoted: quotedMessage,
          location: {
            latitude: locationOptions.latitude,
            longitude: locationOptions.longitude,
            name: locationOptions.name ?? null,
            address: locationOptions.address ?? null,
          },
        },
        date: new Date().toISOString(),
        hash: normalizedHash,
      };

      return this.publishMessage(locationMessage);
    }

    if (type === EMessageType.contact_card) {
      const contactOptions = options as ISendContactMessageOptions;

      if (contactOptions.contactIds.length === 0) {
        return false;
      }

      const contactsData = await Promise.all(
        contactOptions.contactIds.map(async (contactId) => {
          const contact = await this.contactViewerRepository.viewContactById(
            contactId,
            accountId
          );
          if (!contact) return null;

          const sensitiveData =
            await this.contactService.getContactSensitiveDataDecrypted(
              contactId
            );

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
        const messageHash = normalizedHash || uuidv7();
        const contactMessage: IChatMessage = {
          message_id: uuidv7(),
          chat_id: chat.chat_id,
          message_key: {
            remote_jid: chatData.message_key?.remote_jid ?? null,
            remote_jid_alt: chatData.message_key?.remote_jid_alt ?? null,
            is_view_once: false,
          },
          type_user: typeUser,
          account: chatData.account,
          worker: chatData.worker,
          user: chatData.user,
          phone: chatData.phone,
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
            message: message ?? null,
            message_quoted_id: quotedId,
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

    return false;
  }
}
