import { singleton, inject } from 'tsyringe';
import { KafkaConsumer, type LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { v7 as uuidv7 } from 'uuid';
import { AccountService } from '@core/services/account.service';
import { WorkerService } from '@core/services/worker.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatService } from '@core/services/chat.service';
import {
  IChatMessage,
  IContent,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { remoteJid } from '@core/common/functions/remoteJid';
import { StorageService } from '@core/services/storage.service';
import {
  LinkPreview,
  MessageVersion,
} from '@core/schema/chat/listMessageChats/response.schema';
import { buildQuotedTextFromExtended } from '@core/common/functions/buildQuotedTextFromExtended';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { convertWaveformToBase64 } from '@core/common/functions/convertWaveform';
import { createChatCacheKey } from '@core/common/functions/createCacheKey';
import Redis from 'ioredis';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  downloadMediaMessage,
  proto,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import {
  extractPhoneAndDdiFromContactMessage,
  extractPhoneAndDdi,
} from '@core/common/functions/extractPhoneAndDdi';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { ContactService } from '@core/services/contact.service';
import { TFunction } from 'i18next';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { withLock } from '@core/common/functions/withLock';
import { delay } from '@core/common/functions/delay';
import { extractReactionMessage } from '@core/common/functions/extractReactionMessage';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

@singleton()
export class MessageUpsertConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly accountService: AccountService,
    private readonly workerService: WorkerService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly storageService: StorageService,
    private readonly streamProducerService: StreamProducerService,
    private readonly encryptService: EncryptService,
    private readonly contactService: ContactService,
    private readonly chatMessageService: ChatMessageService,
    private readonly workerConfigService: WorkerConfigService,
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    private readonly planAccountService: PlanAccountService,
    private readonly pushNotificationService: PushNotificationService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private normalizePhoneForLock(phone: string): string {
    const candidates = buildCandidates(phone);
    return candidates.sort()[0] ?? phone;
  }

  private centrifugoChatPublish(
    dataPublish: IChatMessage
  ): Promise<PublishResult> {
    const promise = this.centrifugoService.publishSub(
      chatAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );

    return promise;
  }

  private centrifugoChatQueuePublish(
    dataPublish: IChat
  ): Promise<PublishResult> {
    const promise = this.centrifugoService.publishSub(
      chatQueueAccountCentrifugo(dataPublish.account.id),
      dataPublish
    );

    return promise;
  }

  private async handleNewChatMessageAndPublish(
    createChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    await this.createChatMessage(createChat, data);

    const updatedChat = await this.chatService.findChatByChatId(
      data.account_id,
      createChat.chat_id
    );

    if (updatedChat && updatedChat.status === EChatStatus.queue) {
      await this.centrifugoChatQueuePublish(updatedChat);
      return;
    }

    if (!updatedChat) {
      await this.centrifugoChatQueuePublish(createChat);
    }
  }

  private async ensureChatAndHandleMessage(
    data: IUpsertMessage,
    chat: IChat | null
  ): Promise<IChat | null> {
    if (chat) {
      await this.createChatMessage(chat, data);

      return chat;
    }

    const newChat = await this.createChat(data, EChatStatus.ura);

    if (!newChat) {
      throw new Error('Failed to create chat');
    }

    const jid = remoteJid(data.message?.key);
    const jidAlt = remoteJidAlt(data.message?.key);
    const phone = getPhoneFromJid(jid, jidAlt);

    if (!phone) {
      throw new Error('Received message without valid phone');
    }

    const phoneWithPlus = `+${phone}`;
    const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);

    if (phoneAndDdi) {
      const ignoreResult = await this.ensureContactForChat(
        newChat,
        data,
        phoneAndDdi,
        phone,
        newChat.name ?? null
      );

      if (ignoreResult === 'ignore_totally') {
        const closedChat: IChat = {
          ...newChat,
          status: EChatStatus.closed,
          closed_at: new Date().toISOString(),
        };

        await this.saveChatWithCaches(closedChat);

        return null;
      }

      if (ignoreResult === 'ignore_automation') {
        await this.saveChatWithCaches(newChat);
      }
    }

    await this.handleNewChatMessageAndPublish(newChat, data);

    return newChat;
  }

  private async markIncomingMessageAsRead(
    accountId: string,
    workerId: string,
    key: WAMessageKey
  ): Promise<void> {
    const markReadData: IMessageMarkRead = {
      account_id: accountId,
      worker_id: workerId,
      keys: [key],
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.markMessageRead(),
      markReadData
    );
  }

  private async findMessageByKeyId(
    accountId: string,
    chatId: string,
    messageId: string
  ): Promise<IChatMessage | null> {
    if (!messageId) return null;

    const must: Array<Record<string, unknown>> = [
      {
        term: { chat_id: chatId },
      },
      {
        nested: {
          path: 'message_key',
          query: {
            term: { 'message_key.id': messageId },
          },
        },
      },
    ];

    if (accountId) {
      must.push({
        nested: {
          path: 'account',
          query: {
            term: { 'account.id': accountId },
          },
        },
      });
    }

    const queryElastic = {
      query: {
        bool: {
          must,
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    if (!result || result.hits.hits.length === 0) {
      return null;
    }

    return result.hits.hits[0]._source as IChatMessage;
  }

  private async handleReactionMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean | null> {
    if (data.type !== EMessageType.react) {
      return null;
    }

    const reactionMsg = extractReactionMessage(data.message?.message);
    if (!reactionMsg?.key?.id) {
      return null;
    }

    const targetMessageId = reactionMsg.key.id;

    const targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId
    );

    if (!targetMessage) {
      return true;
    }

    const userId = data.message?.key?.fromMe
      ? getChat.worker.id
      : (getChat.user?.id ?? '');
    const userName = data.message?.key?.fromMe
      ? getChat.worker.name
      : (getChat.user?.name ?? '');
    const emoji = reactionMsg.text ?? '';

    const existingReactions = targetMessage.content?.reactions || [];
    const reactionsWithoutUser = existingReactions.filter(
      (reaction) => reaction.user_id !== userId
    );

    let updatedReactions = reactionsWithoutUser;
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

    let reactionsValue: IContent['reactions'] = null;
    if (updatedReactions.length > 0) {
      reactionsValue = updatedReactions;
    }

    const updatedContent: IContent = {
      ...targetMessage.content,
      type: targetMessage.content?.type ?? EMessageType.text,
      reactions: reactionsValue,
    };

    const updatedMessage: IChatMessage = {
      ...targetMessage,
      content: updatedContent,
      has_quoted: targetMessage.has_quoted,
    };

    await Promise.all([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async handleEditMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean | null> {
    if (data.type !== EMessageType.edit_text) return null;

    const editedMessage = (data.message?.message?.editedMessage ??
      data.message?.message) as proto.Message.IFutureProofMessage &
      proto.IMessage;

    const protocolMessage =
      editedMessage?.message?.protocolMessage ?? editedMessage?.protocolMessage;

    const targetMessageId = protocolMessage?.key?.id;
    const editedContent = protocolMessage?.editedMessage;

    if (!targetMessageId || !editedContent) return true;

    const targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId
    );

    if (!targetMessage?.content) {
      return true;
    }

    const newText =
      editedContent.conversation ??
      editedContent.extendedTextMessage?.text ??
      '';

    if (!newText) {
      return true;
    }

    const newVersion: MessageVersion = {
      type: targetMessage.content.type,
      message: newText,
      date: new Date().toISOString(),
    };

    const versions = targetMessage.content.version ?? [];
    const updatedContent: IContent = {
      ...targetMessage.content,
      version: [...versions, newVersion],
    };

    const updatedMessage: IChatMessage = {
      ...targetMessage,
      content: updatedContent,
      has_quoted: targetMessage.has_quoted,
    };

    await Promise.all([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async handleDeleteMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean | null> {
    if (
      data.type !== EMessageType.delete_message ||
      !data.message?.message?.protocolMessage?.key?.id
    ) {
      return null;
    }

    const protocolMessage = data.message.message.protocolMessage;
    const targetMessageId = protocolMessage?.key?.id;
    if (!targetMessageId) {
      return true;
    }

    const targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId
    );

    if (!targetMessage) {
      return true;
    }

    let content = targetMessage.content;
    if (content?.version && content.version.length > 0) {
      const sortedVersions = [...content.version].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestVersion = sortedVersions[0];
      if (latestVersion && content.message === latestVersion.message) {
        const oldestVersion = sortedVersions.at(-1);
        if (
          oldestVersion?.message &&
          oldestVersion.message !== content.message
        ) {
          content = {
            ...content,
            message: oldestVersion.message,
          };
        }
      }
    }

    const updatedMessage: IChatMessage = {
      ...targetMessage,
      deleted: true,
      has_quoted: targetMessage.has_quoted,
      content: content,
    };

    await Promise.all([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async updateChatPhotoIfNeeded(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (!data.photo) return;

    const needsPhotoUpdate = !getChat.photo;
    const needsContactPhotoUpdate = getChat.contact && !getChat.contact.photo;

    if (!needsPhotoUpdate && !needsContactPhotoUpdate) return;

    const photoResult = await this.storageService.uploadFromUrl(
      data.photo,
      data.account_id,
      getChat.chat_id
    );

    if (!photoResult?.url) return;

    if (needsPhotoUpdate) getChat.photo = photoResult.url;

    if (needsContactPhotoUpdate && getChat.contact?.id) {
      await this.contactService.updateContactById(
        {
          image_url: photoResult.url,
        },
        getChat.contact.id,
        data.account_id
      );

      getChat.contact = {
        ...getChat.contact,
        photo: photoResult.url,
      };
    }

    const updateData: Partial<IChat> = {};
    if (needsPhotoUpdate) {
      updateData.photo = photoResult.url;
    }

    if (needsContactPhotoUpdate && getChat.contact) {
      updateData.contact = getChat.contact;
    }

    if (Object.keys(updateData).length > 0) {
      await this.chatService.saveChat({
        ...getChat,
        ...updateData,
      });
    }
  }

  private async updateChatNameIfNeeded(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (getChat?.name || data.message?.key?.fromMe) {
      return;
    }

    const name = this.nameChat(data);
    if (!name) {
      return;
    }

    const scriptSource = `
      if (ctx._source == null) {
        ctx.op = 'noop';
        return;
      }
      
      if (ctx._source.name == null || ctx._source.name == '') {
        ctx._source.name = params.name;
      } else {
        ctx.op = 'noop';
      }
    `;

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.chat,
      getChat.chat_id,
      {
        source: scriptSource,
        params: { name },
      },
      {
        maxRetries: 5,
      }
    );

    if (result === 'updated' || result === 'created') {
      getChat.name = name;
      await this.centrifugoChatQueuePublish(getChat);
    }
  }

  private async handleImageMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.image ||
      !data.message?.message?.imageMessage?.url
    ) {
      return;
    }

    const buffer = await downloadMediaMessage(data.message, 'buffer', {
      startByte: 0,
    });

    const photoResult = await this.storageService.uploadFromBuffer(
      buffer,
      data.account_id
    );

    content.image = photoResult
      ? {
          url: photoResult.url,
          caption: data.message.message.imageMessage.caption ?? null,
          mimetype: data.message.message.imageMessage.mimetype,
          extension: photoResult.extension,
          size: photoResult.size,
          height: data.message.message.imageMessage.height,
          width: data.message.message.imageMessage.width,
        }
      : undefined;
  }

  private async handleVideoMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.video ||
      !data.message?.message?.videoMessage?.url
    ) {
      return;
    }

    const videoMsg = data.message.message.videoMessage;
    const buffer = await downloadMediaMessage(data.message, 'buffer', {
      startByte: 0,
    });

    const inferredVideoName =
      (videoMsg as { fileName?: string | null })?.fileName ?? undefined;

    const videoResult = await this.storageService.uploadFromBuffer(
      buffer,
      data.account_id,
      {
        fileName: inferredVideoName,
        mimetype: videoMsg.mimetype ?? undefined,
      }
    );

    const thumb =
      videoMsg.jpegThumbnail && videoMsg.jpegThumbnail.length > 0
        ? `data:image/jpeg;base64,${Buffer.from(
            videoMsg.jpegThumbnail
          ).toString('base64')}`
        : null;

    content.video = videoResult
      ? {
          url: videoResult.url,
          caption: videoMsg.caption ?? null,
          name: inferredVideoName ?? videoResult.name,
          mimetype: videoMsg.mimetype ?? videoResult.mimetype ?? 'video/mp4',
          extension: videoResult.extension,
          size: videoResult.size,
          duration: videoMsg.seconds ?? null,
          height: videoMsg.height ?? null,
          width: videoMsg.width ?? null,
          thumbnail: thumb,
        }
      : undefined;
  }

  private async handleAudioMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.audio ||
      !data.message?.message?.audioMessage?.url
    ) {
      return;
    }

    const audioMsg = data.message.message.audioMessage;
    const buffer = await downloadMediaMessage(data.message, 'buffer', {
      startByte: 0,
    });

    const inferredAudioName =
      (audioMsg as { fileName?: string | null })?.fileName ?? undefined;

    const audioResult = await this.storageService.uploadFromBuffer(
      buffer,
      data.account_id,
      {
        fileName: inferredAudioName,
        mimetype: audioMsg.mimetype ?? undefined,
      }
    );

    const waveform = convertWaveformToBase64(audioMsg.waveform);

    content.audio = audioResult
      ? {
          url: audioResult.url,
          name: inferredAudioName ?? audioResult.name,
          mimetype: audioMsg.mimetype ?? audioResult.mimetype ?? null,
          extension: audioResult.extension,
          size: audioResult.size,
          duration: audioMsg.seconds ?? null,
          ptt: audioMsg.ptt ?? false,
          view_once: data.message?.key?.isViewOnce ?? false,
          waveform: waveform ?? null,
        }
      : undefined;
  }

  private async handleDocumentMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.document ||
      !data.message?.message?.documentMessage?.url
    ) {
      return;
    }

    const documentMsg = data.message.message.documentMessage;
    const buffer = await downloadMediaMessage(data.message, 'buffer', {
      startByte: 0,
    });

    const documentResult = await this.storageService.uploadFromBuffer(
      buffer,
      data.account_id,
      {
        fileName: documentMsg.fileName ?? undefined,
        mimetype: documentMsg.mimetype ?? undefined,
      }
    );

    content.document = documentResult
      ? {
          url: documentResult.url,
          name: documentMsg.fileName ?? documentResult.name,
          mimetype: documentMsg.mimetype ?? documentResult.mimetype ?? null,
          extension: documentResult.extension,
          size: documentResult.size,
        }
      : undefined;
  }

  private async handleStickerMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.sticker ||
      !data.message?.message?.stickerMessage?.url
    ) {
      return;
    }

    const stickerMsg = data.message.message.stickerMessage;
    const buffer = await downloadMediaMessage(data.message, 'buffer', {
      startByte: 0,
    });

    const stickerResult = await this.storageService.uploadFromBuffer(
      buffer,
      data.account_id
    );

    content.sticker = stickerResult
      ? {
          url: stickerResult.url,
          mimetype: stickerMsg.mimetype ?? stickerResult.mimetype ?? null,
          extension: stickerResult.extension,
          size: stickerResult.size,
          height: stickerMsg.height ?? stickerResult.height ?? null,
          width: stickerMsg.width ?? stickerResult.width ?? null,
          is_animated: stickerMsg.isAnimated ?? false,
        }
      : undefined;
  }

  private async handleLocationMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.location ||
      !data.message?.message?.locationMessage
    ) {
      return;
    }

    const locationMsg = data.message.message.locationMessage;

    content.location = {
      latitude: locationMsg.degreesLatitude ?? null,
      longitude: locationMsg.degreesLongitude ?? null,
      name: locationMsg.name ?? null,
      address: locationMsg.address ?? null,
    };
  }

  private parseVCard(vcard: string): {
    name?: string;
    last_name?: string;
    phone?: string;
    phone_ddi?: string;
    email?: string;
  } {
    const result: {
      name?: string;
      last_name?: string;
      phone?: string;
      phone_ddi?: string;
      email?: string;
    } = {};

    const lines = vcard.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      this.processVCardLine(trimmed, result);
    }

    return result;
  }

  private processVCardLine(
    trimmed: string,
    result: {
      name?: string;
      last_name?: string;
      phone?: string;
      phone_ddi?: string;
      email?: string;
    }
  ): void {
    if (trimmed.startsWith('FN:')) {
      this.parseFullName(trimmed.substring(3).trim(), result);
      return;
    }

    if (trimmed.startsWith('N:')) {
      this.processNLine(trimmed, result);
      return;
    }

    if (trimmed.startsWith('TEL') || trimmed.includes('.TEL')) {
      this.parseTelephone(trimmed, result);
      return;
    }

    if (trimmed.startsWith('EMAIL:') || trimmed.includes('.EMAIL')) {
      this.processEmailLine(trimmed, result);
    }
  }

  private processNLine(
    trimmed: string,
    result: {
      name?: string;
      last_name?: string;
    }
  ): void {
    const nValue = trimmed.substring(2).trim();
    const parts = nValue.split(';').map((p) => p.trim());

    for (let i = 1; i < parts.length; i++) {
      if (parts[i] && !result.name) {
        this.parseFullName(parts[i], result);
        break;
      }
    }
  }

  private processEmailLine(trimmed: string, result: { email?: string }): void {
    const emailIndex = trimmed.indexOf('EMAIL');
    if (emailIndex === -1) return;

    const afterEmail = trimmed.slice(emailIndex);
    const colonIndex = afterEmail.indexOf(':');
    if (colonIndex === -1) return;

    result.email = afterEmail
      .slice(colonIndex + 1)
      .trim()
      .split(/[\n\r;]/)[0];
  }

  private parseFullName(
    fullName: string,
    result: {
      name?: string;
      last_name?: string;
    }
  ): void {
    if (!fullName) return;

    const nameParts = fullName.split(' ');
    if (nameParts.length === 0) return;

    result.name = nameParts[0];
    if (nameParts.length > 1) {
      result.last_name = nameParts.slice(1).join(' ');
    }
  }

  private parseTelephone(
    telLine: string,
    result: {
      phone?: string;
      phone_ddi?: string;
    }
  ): void {
    const waidIndex = telLine.indexOf('waid=');
    if (waidIndex !== -1) {
      const afterWaid = telLine.slice(waidIndex + 5);
      const colonIndex = afterWaid.indexOf(':');
      if (colonIndex !== -1) {
        const waid = afterWaid
          .slice(0, colonIndex)
          .trim()
          .replaceAll(/[;:]/g, '');
        const fullPhone = afterWaid
          .slice(colonIndex + 1)
          .trim()
          .split(/[\n\r;]/)[0];
        this.parseTelephoneWithWaid(waid, fullPhone, result);
        return;
      }
    }

    const telIndex = telLine.indexOf('TEL');
    if (telIndex === -1) return;

    const afterTel = telLine.slice(telIndex);
    const colonIndex = afterTel.indexOf(':');
    if (colonIndex === -1) return;

    const phone = afterTel
      .slice(colonIndex + 1)
      .trim()
      .split(/[\n\r;]/)[0];
    this.parseTelephoneValue(phone, result);
  }

  private parseTelephoneWithWaid(
    waid: string,
    fullPhone: string,
    result: {
      phone?: string;
      phone_ddi?: string;
    }
  ): void {
    const fullPhoneTrimmed = fullPhone?.trim();
    if (fullPhoneTrimmed) {
      const fullPhoneWithPlus = fullPhoneTrimmed.startsWith('+')
        ? fullPhoneTrimmed
        : `+${fullPhoneTrimmed}`;

      const fullPhoneResult = extractPhoneAndDdi(fullPhoneWithPlus);
      if (fullPhoneResult) {
        result.phone = fullPhoneResult.phone;
        result.phone_ddi = fullPhoneResult.phone_ddi;
        return;
      }
    }

    const waidDigits = waid.replaceAll(/\D/g, '');
    if (waidDigits) {
      const waidWithPlus = `+${waidDigits}`;
      const waidResult = extractPhoneAndDdi(waidWithPlus);
      if (waidResult) {
        result.phone = waidResult.phone;
        result.phone_ddi = waidResult.phone_ddi;
        return;
      }
    }

    result.phone = waidDigits;
  }

  private parseTelephoneValue(
    phone: string,
    result: {
      phone?: string;
      phone_ddi?: string;
    }
  ): void {
    if (phone.startsWith('+')) {
      const phoneDigits = phone.substring(1).replaceAll(/\D/g, '');
      if (phoneDigits.length > 10) {
        result.phone_ddi = phoneDigits.substring(0, phoneDigits.length - 10);
        result.phone = phoneDigits.substring(phoneDigits.length - 10);
        return;
      }
      result.phone = phoneDigits;
      return;
    }

    result.phone = phone.replaceAll(/\D/g, '');
  }

  private async handleContactMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.contact_card ||
      !data.message?.message?.contactMessage?.vcard
    ) {
      return;
    }

    const contactMsg = data.message.message.contactMessage;
    const vcard = contactMsg.vcard ?? '';
    const parsed = this.parseVCard(vcard);

    const phoneAndDdi = extractPhoneAndDdiFromContactMessage(contactMsg);

    if (!phoneAndDdi) return;

    const phonePartial = this.encryptService.sanitize(
      phoneAndDdi.phone,
      ETypeSanetize.phone
    );

    const emailPartial = parsed?.email
      ? this.encryptService.sanitize(parsed.email, ETypeSanetize.email)
      : null;

    let existingContactId: string | null = null;
    let existingContactPhoto: string | null = null;

    const existingContact = await this.contactService.getContactByPhone(
      data.account_id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );

    let existingContactName =
      parsed.name ?? contactMsg.displayName ?? 'Contato';
    let existingContactLastName = parsed.last_name ?? null;
    if (existingContact) {
      existingContactId = existingContact.contact_id;
      existingContactPhoto = existingContact.photo ?? null;
      existingContactName = existingContact.name;
      existingContactLastName = existingContact.last_name ?? null;
    }

    content.contact = {
      contact_id: existingContactId,
      name: existingContactName,
      last_name: existingContactLastName,
      phone: phoneAndDdi.phone,
      phone_partial: phonePartial,
      phone_ddi: phoneAndDdi.phone_ddi,
      email: parsed.email ?? null,
      email_partial: emailPartial,
      photo: existingContactPhoto,
    };
  }

  private async ensureContactForChat(
    inputChatMessage: IChat,
    data: IUpsertMessage,
    phoneAndDdi: { phone: string; phone_ddi: string | null },
    phone: string,
    name: string | null
  ): Promise<'ignore_totally' | 'ignore_automation' | null> {
    const existingContact = await this.contactService.getContactByPhone(
      data.account_id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );

    if (existingContact) {
      if (existingContact.is_valided === false) {
        await this.contactService.updateContactIsValided(
          existingContact.contact_id,
          true
        );
      }

      const ignoreStatus = existingContact.ignore ?? 'not_ignore';

      if (ignoreStatus === EContactIgnore.ignore_totally) {
        return 'ignore_totally';
      }

      const responsibleAttendant = existingContact.user
        ? {
            id: existingContact.user.user_id,
            name: existingContact.user.name ?? '',
            photo: existingContact.user.photo ?? null,
          }
        : null;

      inputChatMessage.contact = {
        id: existingContact.contact_id,
        name: existingContact.name,
        phone: existingContact.phone_partial ?? phone,
        phone_ddi: existingContact.phone_ddi ?? phoneAndDdi.phone_ddi,
        photo: existingContact.photo ?? null,
        responsible_attendant: responsibleAttendant,
        ignore: ignoreStatus,
      };

      if (ignoreStatus === EContactIgnore.ignore_automation) {
        inputChatMessage.status = EChatStatus.queue;
        if (responsibleAttendant) {
          inputChatMessage.user = responsibleAttendant;
        }

        return 'ignore_automation';
      }

      return null;
    }

    const shouldAutoSave = await this.shouldAutoSaveContact(data.worker_id);
    if (!shouldAutoSave) {
      return null;
    }

    const createdContact = await this.createContactAutomatically(
      data,
      phoneAndDdi,
      name ?? phone
    );

    if (createdContact) {
      const ignoreStatus = createdContact.ignore ?? 'not_ignore';

      if (ignoreStatus === EContactIgnore.ignore_totally) {
        return 'ignore_totally';
      }

      const responsibleAttendant = createdContact.user
        ? {
            id: createdContact.user.user_id,
            name: createdContact.user.name ?? '',
            photo: createdContact.user.photo ?? null,
          }
        : null;

      inputChatMessage.contact = {
        id: createdContact.contact_id,
        name: createdContact.name,
        phone: createdContact.phone_partial ?? phone,
        phone_ddi: createdContact.phone_ddi ?? phoneAndDdi.phone_ddi,
        photo: createdContact.photo ?? null,
        responsible_attendant: responsibleAttendant,
        ignore: ignoreStatus,
      };

      if (ignoreStatus === EContactIgnore.ignore_automation) {
        inputChatMessage.status = EChatStatus.queue;
        if (responsibleAttendant) {
          inputChatMessage.user = responsibleAttendant;
        }

        return 'ignore_automation';
      }
    }

    return null;
  }

  private async shouldAutoSaveContact(workerId: string): Promise<boolean> {
    const workerConfig =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);

    return Boolean(workerConfig?.auto_save_contacts);
  }

  private splitFullName(fullName: string): {
    name: string;
    last_name: string | null;
    nickname: string | null;
  } {
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      return {
        name: '',
        last_name: null,
        nickname: null,
      };
    }

    const parts = trimmedName.split(/\s+/).filter((part) => part.length > 0);

    if (parts.length === 0) {
      return {
        name: '',
        last_name: null,
        nickname: null,
      };
    }

    if (parts.length === 1) {
      return {
        name: parts[0],
        last_name: null,
        nickname: null,
      };
    }

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');

    return {
      name: firstName,
      last_name: lastName,
      nickname: firstName,
    };
  }

  private async createContactAutomatically(
    data: IUpsertMessage,
    phoneAndDdi: { phone: string; phone_ddi: string | null },
    contactName: string
  ): Promise<ViewContactResponse | null> {
    const canCreate =
      await this.planAccountService.validateCanCreateContactReceived(
        data.account_id
      );
    if (!canCreate) return null;

    const { name, last_name, nickname } = this.splitFullName(contactName);

    const contactToCreate = {
      name,
      last_name,
      nickname,
      phone: phoneAndDdi.phone,
      phone_ddi: phoneAndDdi.phone_ddi ?? '55',
    };

    const contactId = await this.contactService.createContact(
      contactToCreate,
      data.account_id,
      true
    );

    if (!contactId) {
      return null;
    }

    return this.contactService.getContactByPhone(
      data.account_id,
      phoneAndDdi.phone,
      phoneAndDdi.phone_ddi
    );
  }

  private async handleCallEvent(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage
  ): Promise<void> {
    if (!data.call_phone || !data.is_call_event) {
      return;
    }

    const workerConfig =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(data.worker_id);

    if (!workerConfig?.show_message_on_call) {
      return;
    }

    const normalizedPhone = this.normalizePhoneForLock(data.call_phone);
    const lockKey = `chat-create:${data.account_id}:${data.worker_id}:${normalizedPhone}`;

    await withLock(
      this.redis,
      lockKey,
      async () => {
        const callPhone = data.call_phone;
        if (!callPhone) return;

        let chat = await this.chatService.findChatByPhone(
          data.account_id,
          data.worker_id,
          callPhone
        );

        if (!chat) {
          chat = await this.createChatFromCallEvent(data);

          if (!chat) return;
        }

        if (chat) {
          await this.updateChatPhotoIfNeeded(chat, data);
        }

        const message = replaceMessageTags({
          message: workerConfig.show_message_on_call,
          chat,
          t,
        });

        await this.chatMessageService.sendMessage(t, {
          chat,
          accountId: data.account_id,
          type: EMessageType.system,
          message,
          typeUser: ETypeUserChat.system,
        });
      },
      { ttlMs: 30000, retryMs: 100 }
    );
  }

  private async createChatFromCallEvent(
    data: IUpsertMessage
  ): Promise<IChat | null> {
    const jid = data.call_jid;
    const jidAlt = data.call_jid_alt ?? null;

    if (!jid && !jidAlt) {
      return null;
    }

    const phone = getPhoneFromJid(jid, jidAlt);
    if (!phone) {
      return null;
    }

    const [viewAccountName, viewWorkerNameAndId] = await Promise.all([
      this.accountService.viewAccountName(data.account_id),
      this.workerService.viewWorkerNameAndId(data.account_id, data.worker_id),
    ]);

    if (!viewAccountName || !viewWorkerNameAndId) {
      return null;
    }

    const chatId = uuidv7();
    const messageDate = new Date().toISOString();

    const inputChatMessage: IChat = {
      chat_id: chatId,
      message_key: {
        remote_jid: jid,
        remote_jid_alt: jidAlt,
      },
      account: viewAccountName,
      worker: viewWorkerNameAndId,
      name: data.call_name ?? null,
      phone,
      status: EChatStatus.closed,
      date: messageDate,
      closed_at: messageDate,
      summary: {
        last_message: null,
        last_date: messageDate,
        unread_count: 0,
      },
    };

    const phoneWithPlus = `+${phone}`;
    const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);

    if (phoneAndDdi) {
      const ignoreResult = await this.ensureContactForChat(
        inputChatMessage,
        data,
        phoneAndDdi,
        phone,
        data.call_name ?? null
      );

      if (ignoreResult === 'ignore_totally') {
        return null;
      }

      if (inputChatMessage.contact) {
        inputChatMessage.name = inputChatMessage.contact.name;
      }
    }

    if (data.photo) {
      const photoResult = await this.storageService.uploadFromUrl(
        data.photo,
        data.account_id,
        chatId
      );
      inputChatMessage.photo =
        inputChatMessage.contact?.photo ?? photoResult?.url ?? null;
    }

    await this.saveChatWithCaches(inputChatMessage);

    return inputChatMessage;
  }

  private async updateChatSummaryWithRetry(
    chatId: string,
    messageText: string | null,
    lastDate: string,
    lastDateEpochMillis: number,
    lastMessageId: string | null,
    processedMessageId: string | null,
    incrementUnreadCount: boolean,
    maxRetries = 3
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const success = await this.chatService.updateChatSummaryAtomically(
        chatId,
        messageText,
        lastDate,
        lastDateEpochMillis,
        lastMessageId,
        processedMessageId,
        incrementUnreadCount
      );

      if (success) {
        return true;
      }

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(50 * Math.pow(2, attempt), 200);
        await delay(backoffMs);
      }
    }

    return false;
  }

  private async createChatMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean> {
    try {
      await this.updateChatPhotoIfNeeded(getChat, data);

      const reactionResult = await this.handleReactionMessage(getChat, data);
      if (reactionResult !== null) {
        return reactionResult;
      }

      const editResult = await this.handleEditMessage(getChat, data);
      if (editResult !== null) {
        return editResult;
      }

      const deleteResult = await this.handleDeleteMessage(getChat, data);
      if (deleteResult !== null) {
        return deleteResult;
      }

      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);

      const content = this.buildMessageContent(data);

      const messageQuotedId = content.quoted?.key.id ?? null;
      if (content.quoted && messageQuotedId) {
        await this.enrichQuotedMessageContent(
          content.quoted,
          data.account_id,
          getChat.chat_id,
          messageQuotedId
        );
      }

      const hasQuotedFlag = data.has_quoted || !!content.quoted;

      await this.updateChatNameIfNeeded(getChat, data);

      await this.handleImageMessage(content, data);
      await this.handleVideoMessage(content, data);
      await this.handleAudioMessage(content, data);
      await this.handleDocumentMessage(content, data);
      await this.handleStickerMessage(content, data);
      await this.handleLocationMessage(content, data);
      await this.handleContactMessage(content, data);

      const isFromMe = data.message?.key?.fromMe ?? false;

      let typeUser: ETypeUserChat = ETypeUserChat.client;
      let summary: IChatMessage['summary'] = {
        is_sent: true,
        is_delivered: true,
        is_seen: true,
        is_sent_to_internal: true,
      };

      if (isFromMe) {
        typeUser = ETypeUserChat.operator;
        summary = {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        };
      }

      const inputChatMessage: IChatMessage = {
        message_id: uuidv7(),
        chat_id: getChat.chat_id,
        message_key: {
          remote_jid: jid,
          remote_jid_alt: jidAlt,
          from_me: data.message?.key?.fromMe,
          id: data.message?.key?.id,
          participant: data.message?.key?.participant,
          participant_alt: data.message?.key?.participantAlt,
          addressing_mode: data.message?.key?.addressingMode,
          is_view_once: data.message?.key?.isViewOnce ?? false,
        },
        type_user: typeUser,
        account: getChat.account,
        worker: getChat.worker,
        user: getChat.user,
        phone: getChat.phone,
        summary,
        content,
        date: new Date().toISOString(),
        deleted: false,
        has_quoted: hasQuotedFlag,
        hash: uuidv7(),
      };

      const messageId = data.message?.key?.id;
      if (!messageId) {
        return false;
      }

      const createResult =
        await this.chatService.createMessageIdempotent(inputChatMessage);

      if (!createResult.created && !createResult.conflict) {
        return false;
      }

      if (createResult.conflict) {
        await this.chatService.patchExistingMessageMissingFields(
          createResult.id,
          inputChatMessage
        );

        return true;
      }

      await this.centrifugoChatPublish(inputChatMessage);

      if (!data.message?.key?.fromMe && data.message?.key) {
        await this.markIncomingMessageAsRead(
          data.account_id,
          data.worker_id,
          data.message.key
        );
      }

      const messageText = extractMessageTextFromContent(content);
      const incrementUnreadCount = !isFromMe;
      const lastDateEpochMillis = new Date(inputChatMessage.date).getTime();

      const lockKey = `chat-summary:${getChat.chat_id}`;
      await withLock(
        this.redis,
        lockKey,
        async () => {
          await this.updateChatSummaryWithRetry(
            getChat.chat_id,
            messageText,
            inputChatMessage.date,
            lastDateEpochMillis,
            inputChatMessage.message_id,
            inputChatMessage.message_id,
            incrementUnreadCount
          );

          const updatedChat = await this.chatService.findChatByChatId(
            data.account_id,
            getChat.chat_id
          );

          if (!updatedChat) {
            return;
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

          if (inputChatMessage.type_user !== ETypeUserChat.operator) {
            const isFromMe = inputChatMessage.message_key?.from_me === true;

            if (!isFromMe) {
              await this.pushNotificationService
                .sendNotificationForChatMessage(updatedChat, inputChatMessage)
                .catch(() => {});
            }
          }
        },
        { ttlMs: 20000 }
      );

      return true;
    } catch {
      return false;
    }
  }

  private enrichSticker(
    quoted: IQuotedMessage,
    originalContent: IContent
  ): void {
    if (quoted.sticker && !quoted.sticker.url && originalContent.sticker?.url) {
      quoted.sticker.url = originalContent.sticker.url;
    }
  }

  private enrichImage(quoted: IQuotedMessage, originalContent: IContent): void {
    if (quoted.image && !quoted.image.url && originalContent.image?.url) {
      quoted.image.url = originalContent.image.url;
      if (!quoted.image.thumbnail && originalContent.image?.thumbnail) {
        quoted.image.thumbnail = originalContent.image.thumbnail;
      }
    }
  }

  private enrichVideo(quoted: IQuotedMessage, originalContent: IContent): void {
    if (quoted.video && !quoted.video.url && originalContent.video?.url) {
      quoted.video.url = originalContent.video.url;
      if (!quoted.video.thumbnail && originalContent.video?.thumbnail) {
        quoted.video.thumbnail = originalContent.video.thumbnail;
      }
    }
  }

  private enrichDocument(
    quoted: IQuotedMessage,
    originalContent: IContent
  ): void {
    if (
      quoted.document &&
      !quoted.document.url &&
      originalContent.document?.url
    ) {
      quoted.document.url = originalContent.document.url;
    }
  }

  private enrichAudio(quoted: IQuotedMessage, originalContent: IContent): void {
    if (quoted.audio && !quoted.audio.url && originalContent.audio?.url) {
      quoted.audio.url = originalContent.audio.url;
    }
  }

  private async enrichQuotedMessageContent(
    quoted: IQuotedMessage,
    accountId: string,
    chatId: string,
    messageQuotedId: string
  ): Promise<void> {
    if (!quoted || !messageQuotedId) return;

    const originalMessage = await this.findMessageByKeyId(
      accountId,
      chatId,
      messageQuotedId
    );

    if (!originalMessage?.content) return;

    this.enrichSticker(quoted, originalMessage.content);
    this.enrichImage(quoted, originalMessage.content);
    this.enrichVideo(quoted, originalMessage.content);
    this.enrichDocument(quoted, originalMessage.content);
    this.enrichAudio(quoted, originalMessage.content);
  }

  private nameChat(data: IUpsertMessage) {
    let name = null;

    if (!data.message?.key?.fromMe) {
      name = data?.message?.pushName ?? null;
    }

    return name;
  }

  private buildMessageContent(data: IUpsertMessage): IContent {
    const extended = data?.message?.message?.extendedTextMessage;

    const linkPreview = extended
      ? ({
          'canonical-url': extended?.matchedText ?? '',
          'matched-text': extended?.matchedText ?? '',
          title: extended?.title ?? '',
          description: extended?.description ?? '',
          jpegThumbnail: extended?.jpegThumbnail,
        } as LinkPreview)
      : undefined;

    const content: IContent = {
      type: data.type,
      message:
        data.message?.message?.extendedTextMessage?.text ??
        data.message?.message?.conversation,
      link_preview: linkPreview,
      quoted: buildQuotedTextFromExtended(data.message),
    };

    const messageQuotedId = content.quoted?.key.id ?? null;
    if (messageQuotedId) {
      content.message_quoted_id = messageQuotedId;
    }

    return content;
  }

  private async createChat(
    data: IUpsertMessage,
    status: EChatStatus
  ): Promise<IChat> {
    const [viewAccountName, viewWorkerNameAndId] = await Promise.all([
      this.accountService.viewAccountName(data.account_id),
      this.workerService.viewWorkerNameAndId(data.account_id, data.worker_id),
    ]);

    if (!viewAccountName || !viewWorkerNameAndId) {
      throw new Error('Account or Worker not found');
    }

    const jid = remoteJid(data.message?.key);
    const jidAlt = remoteJidAlt(data.message?.key);

    if (!jid && !jidAlt) {
      throw new Error('Received message without remoteJid');
    }

    const phone = getPhoneFromJid(jid, jidAlt);
    if (!phone) {
      throw new Error('Received message without valid phone');
    }

    const chatId = uuidv7();
    const name = this.nameChat(data);
    const messageDate = new Date().toISOString();
    const isFromMe = data.message?.key?.fromMe ?? false;

    const content = this.buildMessageContent(data);
    const messageText = extractMessageTextFromContent(content);

    const inputChatMessage: IChat = {
      chat_id: chatId,
      message_key: {
        remote_jid: jid,
        remote_jid_alt: jidAlt,
      },
      account: viewAccountName,
      worker: viewWorkerNameAndId,
      name,
      phone,
      status,
      date: messageDate,
      summary: {
        last_message: messageText,
        last_date: messageDate,
        unread_count: isFromMe ? 0 : 1,
      },
    };

    const phoneWithPlus = `+${phone}`;
    const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);

    if (phoneAndDdi) {
      const ignoreResult = await this.ensureContactForChat(
        inputChatMessage,
        data,
        phoneAndDdi,
        phone,
        name
      );

      if (ignoreResult === 'ignore_totally') {
        inputChatMessage.status = EChatStatus.closed;
        inputChatMessage.closed_at = new Date().toISOString();
      }
    }

    if (data.photo) {
      const photoResult = await this.storageService.uploadFromUrl(
        data.photo,
        data.account_id,
        chatId
      );
      inputChatMessage.photo =
        inputChatMessage.contact?.photo ?? photoResult?.url ?? null;
    }

    await this.saveChatWithCaches(inputChatMessage);

    return inputChatMessage;
  }

  private parseMessage(value: Buffer | null): IUpsertMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IUpsertMessage | null;

      if (!parsed) return null;

      parsed.has_quoted = !!parsed.has_quoted;

      return parsed;
    } catch {
      return null;
    }
  }

  private async createOrUpdateChatBotFlow(
    t: TFunction<'translation', undefined>,
    getChat: IChat | null,
    data: IUpsertMessage,
    chatbotId: string
  ) {
    const jid = remoteJid(data.message?.key);
    const jidAlt = remoteJidAlt(data.message?.key);

    if (!jid && !jidAlt) {
      throw new Error('Received message without remoteJid');
    }

    const phone = getPhoneFromJid(jid, jidAlt);
    if (!phone) {
      throw new Error('Failed to get phone from jid');
    }

    const chat = await this.ensureChatAndHandleMessage(data, getChat);
    if (!chat) {
      return;
    }

    return this.chatbotFlowRunnerService.execute(t, data, chat, chatbotId);
  }

  private async createOrUpdateChatQueue(
    t: TFunction<'translation', undefined>,
    getChat: IChat | null,
    data: IUpsertMessage
  ): Promise<void> {
    if (!getChat) {
      const createChat = await this.createChat(data, EChatStatus.queue);
      if (!createChat) {
        throw new Error('Failed to create chat');
      }

      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);
      const phone = getPhoneFromJid(jid, jidAlt);
      if (!phone) {
        throw new Error('Received message without valid phone');
      }

      const phoneWithPlus = `+${phone}`;
      const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);

      if (phoneAndDdi) {
        const ignoreResult = await this.ensureContactForChat(
          createChat,
          data,
          phoneAndDdi,
          phone,
          createChat.name ?? null
        );

        if (ignoreResult === 'ignore_totally') {
          const closedChat: IChat = {
            ...createChat,
            status: EChatStatus.closed,
            closed_at: new Date().toISOString(),
          };

          await this.saveChatWithCaches(closedChat);

          return;
        }
      }

      return this.handleNewChatMessageAndPublish(createChat, data);
    }

    await this.createChatMessage(getChat, data);
  }

  private async createOrUpdateChat(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    phone: string
  ): Promise<void> {
    const normalizedPhone = this.normalizePhoneForLock(phone);
    const lockKey = `chat-create:${data.account_id}:${data.worker_id}:${normalizedPhone}`;

    await withLock(
      this.redis,
      lockKey,
      async () => {
        const [chatbotConfig, getChat] = await Promise.all([
          this.workerConfigService.viewChatbot(data.worker_id),
          this.chatService.findChatByPhone(
            data.account_id,
            data.worker_id,
            phone
          ),
        ]);

        const chatbotId =
          chatbotConfig.enabled && chatbotConfig.chatbot_id
            ? chatbotConfig.chatbot_id
            : null;

        if (chatbotId && (!getChat || getChat.status === EChatStatus.ura)) {
          await this.createOrUpdateChatBotFlow(t, getChat, data, chatbotId);

          return;
        }

        await this.createOrUpdateChatQueue(t, getChat, data);
      },
      { ttlMs: 30000, retryMs: 100 }
    );
  }

  public async execute(t: TFunction<'translation', undefined>): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.upsertMessage();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-upsert'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);
        try {
          if (data.is_call_event) {
            await this.handleCallEvent(t, data);
            return;
          }

          const jid = remoteJid(data.message?.key);
          const jidAlt = remoteJidAlt(data.message?.key);

          if (!jid && !jidAlt) {
            throw new Error('Received message without remoteJid');
          }

          const phone = getPhoneFromJid(jid, jidAlt);
          if (!phone) {
            throw new Error('Received message without valid phone');
          }
          await this.createOrUpdateChat(t, data, phone);
        } finally {
          stop();
          await this.commitNext(topic, partition, offset);
        }
      });

      this.partitionChains.set(partition, currentChain);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
    await Promise.all(this.partitionChains.values());

    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
      this.partitionChains.clear();
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    try {
      await commitOffset(this.consumerOrThrow, topic, partition, offset);
    } catch (error: unknown) {
      if (MessageUpsertConsume.isLibrdKafkaError(error) && error.code === 22) {
        return;
      }

      throw error;
    }
  }

  private static isLibrdKafkaError(error: unknown): error is LibrdKafkaError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'number'
    );
  }

  private async saveChatWithCaches(chat: IChat): Promise<boolean> {
    const result = await this.chatService.saveChat(chat);

    if (!result) {
      await this.chatService.invalidateChatCache(chat);
    }

    return result ?? false;
  }

  private async getChatFromCache(
    accountId: string,
    workerId: string,
    phone: string
  ): Promise<IChat | null> {
    const key = createChatCacheKey(accountId, workerId, phone);
    const raw = await this.redis.get(key);

    return raw ? (JSON.parse(raw) as IChat) : null;
  }
}
