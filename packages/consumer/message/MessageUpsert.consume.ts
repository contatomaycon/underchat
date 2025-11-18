import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
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
import { IChatMessage, IContent } from '@core/common/interfaces/IChatMessage';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
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
import { buildQuotedTextFromExtended } from '@core/common/functions/buildQuotedTextFromExtended';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { convertWaveformToBase64 } from '@core/common/functions/convertWaveform';
import Redis from 'ioredis';
import { EMessageType } from '@core/common/enums/EMessageType';
import { downloadMediaMessage, WAMessageKey } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';

@singleton()
export class MessageUpsertConsume {
  private consumer: Consumer | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly accountService: AccountService,
    private readonly workerService: WorkerService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly storageService: StorageService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
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

  private async markIncomingMessageAsRead(
    accountId: string,
    workerId: string,
    key: WAMessageKey
  ): Promise<void> {
    try {
      const markReadData: IMessageMarkRead = {
        account_id: accountId,
        worker_id: workerId,
        keys: [key],
      };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.markMessageRead(),
        markReadData
      );
    } catch (error) {
      console.error('Error sending mark read to queue', {
        accountId,
        workerId,
        messageId: key.id,
        error,
      });
    }
  }

  private async getChat(
    accountId: string,
    workerId: string,
    phone: string,
    jid?: string | null,
    jidAlt?: string | null
  ): Promise<IChat | null> {
    const cached = await this.getChatFromCache(accountId, workerId, phone);
    if (cached) {
      return cached;
    }

    const candidates = buildCandidates(phone);
    const shouldClauses: any[] = [];

    if (Array.isArray(candidates) && candidates.length) {
      shouldClauses.push({ terms: { phone: candidates } });
    }

    if (jid || jidAlt) {
      const messageKeyQueries: any[] = [];

      if (jid) {
        messageKeyQueries.push({
          term: { 'message_key.remote_jid': jid },
        });
      }

      if (jidAlt) {
        messageKeyQueries.push({
          term: { 'message_key.remote_jid_alt': jidAlt },
        });
      }

      if (messageKeyQueries.length > 0) {
        shouldClauses.push({
          nested: {
            path: 'message_key',
            query: {
              bool: {
                should: messageKeyQueries,
                minimum_should_match: 1,
              },
            },
          },
        });
      }
    }

    const queryElastic = {
      query: {
        bool: {
          filter: [
            {
              nested: {
                path: 'account',
                query: { term: { 'account.id': accountId } },
              },
            },
            {
              nested: {
                path: 'worker',
                query: { term: { 'worker.id': workerId } },
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
          ],
          ...(shouldClauses.length
            ? {
                must: [
                  { bool: { should: shouldClauses, minimum_should_match: 1 } },
                ],
              }
            : {}),
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

  private async messageIdExists(
    accountId: string,
    workerId: string,
    messageId: string
  ): Promise<boolean> {
    if (!messageId) return false;

    const queryElastic = {
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': accountId },
                },
              },
            },
            {
              nested: {
                path: 'worker',
                query: {
                  term: { 'worker.id': workerId },
                },
              },
            },
            {
              nested: {
                path: 'message_key',
                query: {
                  term: { 'message_key.id': messageId },
                },
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

    return (result?.hits.total as { value: number })?.value > 0;
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
    if (
      data.type !== EMessageType.react ||
      !data.message?.message?.reactionMessage?.key?.id
    ) {
      return null;
    }

    const reactionMsg = data.message.message.reactionMessage;
    const targetMessageId = reactionMsg.key?.id;
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
      this.chatService.saveMessageChat(updatedMessage),
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

    const updatedMessage: IChatMessage = {
      ...targetMessage,
      deleted: true,
      has_quoted: targetMessage.has_quoted,
    };

    await Promise.all([
      this.chatService.saveMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async updateChatNameIfNeeded(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (getChat?.name || data.message?.key?.fromMe) {
      return;
    }

    const name = this.nameChat(data);

    await this.elasticDatabaseService.update(
      EElasticIndex.chat,
      { name },
      getChat.chat_id
    );
    getChat.name = name;

    await this.centrifugoChatQueuePublish(getChat);
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

  private async createChatMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean> {
    try {
      const reactionResult = await this.handleReactionMessage(getChat, data);
      if (reactionResult !== null) {
        return reactionResult;
      }

      const deleteResult = await this.handleDeleteMessage(getChat, data);
      if (deleteResult !== null) {
        return deleteResult;
      }

      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);

      const content = this.buildMessageContent(data);

      const hasQuotedFlag = data.has_quoted || !!content.quoted;

      await this.updateChatNameIfNeeded(getChat, data);

      await this.handleImageMessage(content, data);
      await this.handleVideoMessage(content, data);
      await this.handleAudioMessage(content, data);
      await this.handleDocumentMessage(content, data);
      await this.handleStickerMessage(content, data);
      await this.handleLocationMessage(content, data);

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

      const [, result] = await Promise.all([
        this.centrifugoChatPublish(inputChatMessage),
        this.chatService.saveMessageChat(inputChatMessage),
      ]);

      if (!data.message?.key?.fromMe && data.message?.key) {
        await this.markIncomingMessageAsRead(
          data.account_id,
          data.worker_id,
          data.message.key
        );
      }

      const messageText = extractMessageTextFromContent(content);
      const currentUnreadCount = getChat.summary?.unread_count ?? 0;
      const newUnreadCount = isFromMe ? 0 : currentUnreadCount + 1;

      const summaryUpdate: IChat['summary'] = {
        last_message: messageText,
        last_date: inputChatMessage.date,
        unread_count: newUnreadCount,
      };

      await this.chatService.updateChatSummary(getChat.chat_id, summaryUpdate);

      const updatedChat = await this.chatService.findChatByChatId(
        data.account_id,
        getChat.chat_id
      );

      if (!updatedChat) {
        return result;
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

      return result;
    } catch {
      return false;
    }
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

  private async createChat(data: IUpsertMessage): Promise<IChat> {
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
      status: EChatStatus.queue,
      date: messageDate,
      summary: {
        last_message: messageText,
        last_date: messageDate,
        unread_count: isFromMe ? 0 : 1,
      },
    };

    if (data.photo) {
      const photoResult = await this.storageService.uploadFromUrl(
        data.photo,
        data.account_id,
        chatId
      );
      inputChatMessage.photo = photoResult?.url;
    }

    await this.cacheChat(inputChatMessage);

    const result = await this.chatService.saveChat(inputChatMessage);
    if (!result) {
      throw new Error('Failed to create chat');
    }

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

  private async createOrUpdateChat(
    data: IUpsertMessage,
    phone: string,
    jid?: string | null,
    jidAlt?: string | null
  ): Promise<void> {
    const getChat = await this.getChat(
      data.account_id,
      data.worker_id,
      phone,
      jid,
      jidAlt
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
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-upsert'
    );

    const topic = this.kafkaServiceQueueService.upsertMessage();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);
        if (!data) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const offset = message.offset;

        this.processingChain = this.processingChain.then(async () => {
          const stop = startHeartbeat(heartbeat);
          try {
            const messageId = data.message?.key?.id;
            if (messageId) {
              const exists = await this.messageIdExists(
                data.account_id,
                data.worker_id,
                messageId
              );

              if (exists) {
                await this.commitNext(topic, partition, offset);
                return;
              }
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
            await this.createOrUpdateChat(data, phone, jid, jidAlt);
          } catch {
            await this.commitNext(topic, partition, message.offset);
          } finally {
            stop();
          }

          await this.commitNext(topic, partition, offset);
        });
      },
    });
  }

  public async close(): Promise<void> {
    await this.processingChain;

    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    const next = (BigInt(offset) + 1n).toString();

    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: next },
    ]);
  }

  private cacheKeyChat(accountId: string, workerId: string, phone: string) {
    return `underchat:chat:${accountId}:${workerId}:${phone}`;
  }

  private async cacheChat(chat: IChat): Promise<void> {
    const key = this.cacheKeyChat(chat.account.id, chat.worker.id, chat.phone);
    await this.redis.set(key, JSON.stringify(chat), 'PX', 60_000);
  }

  private async getChatFromCache(
    accountId: string,
    workerId: string,
    phone: string
  ): Promise<IChat | null> {
    const key = this.cacheKeyChat(accountId, workerId, phone);
    const raw = await this.redis.get(key);

    return raw ? (JSON.parse(raw) as IChat) : null;
  }
}
