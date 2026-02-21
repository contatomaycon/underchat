import { singleton, inject } from 'tsyringe';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';
import { WwebjsMessageMediaService } from '@core/services/wwebjs/methods/messageMedia.service';
import { WwebjsMessageReactionsInteractionsService } from '@core/services/wwebjs/methods/messageReactionsInteractions.service';
import { WwebjsMessageEditDeleteService } from '@core/services/wwebjs/methods/messageEditDelete.service';
import { WwebjsMessageLocationContactService } from '@core/services/wwebjs/methods/messageLocationContact.service';
import { WwebjsMessageStatusStoriesService } from '@core/services/wwebjs/methods/messageStatusStories.service';
import { WwebjsProfileService } from '@core/services/wwebjs/methods/profile.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { Buffer } from 'node:buffer';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { webcrypto } from 'node:crypto';

@singleton()
export class MessageSendWwebjsConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private readonly lastMessageTypeByChatId: Map<string, EMessageType> =
    new Map();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(WwebjsMessageTextService)
    private readonly wwebjsMessageTextService: WwebjsMessageTextService,
    @inject(WwebjsMessageMediaService)
    private readonly wwebjsMessageMediaService: WwebjsMessageMediaService,
    @inject(WwebjsMessageReactionsInteractionsService)
    private readonly wwebjsMessageReactionsInteractionsService: WwebjsMessageReactionsInteractionsService,
    @inject(WwebjsMessageEditDeleteService)
    private readonly wwebjsMessageEditDeleteService: WwebjsMessageEditDeleteService,
    @inject(WwebjsMessageLocationContactService)
    private readonly wwebjsMessageLocationContactService: WwebjsMessageLocationContactService,
    @inject(WwebjsMessageStatusStoriesService)
    private readonly wwebjsMessageStatusStoriesService: WwebjsMessageStatusStoriesService,
    @inject(WwebjsProfileService)
    private readonly wwebjsProfileService: WwebjsProfileService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(KeyedSequencerService)
    private readonly keyedSequencerService: KeyedSequencerService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaBaileysQueueService.workerSendMessage(
      wwebjsEnvironment.wwebjsWorkerId
    );

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-wwebjs-send-${wwebjsEnvironment.wwebjsWorkerId}`
    );

    this.consumer.on('data', async (message) => {
      const payload = this.parseRawMessage(message.value);

      if (!payload) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      let shouldCommit = true;

      try {
        if (this.isDeleteStatusMessage(payload)) {
          await this.processDeleteStatus(payload);
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        if (this.isStatusMessage(payload)) {
          await this.processProfileStatus(payload);
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        if (this.isProfileInfoMessage(payload)) {
          await this.processProfileInfo(payload);
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        const isSend = this.isSendMessage(payload);

        if (!isSend) {
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        const chatId = this.resolveChatId(payload);

        if (!chatId) {
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        await this.enqueueByChatId(chatId, async () => {
          await this.processMessage(payload);
        });
      } catch (error) {
        shouldCommit = this.isTransientError(error);

        if (!shouldCommit) {
          throw error;
        }
      } finally {
        stop();
        if (shouldCommit) {
          await this.commitNext(topic, message.partition, message.offset);
        }
      }
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
    await this.keyedSequencerService.drain();

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
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private parseRawMessage(value: Buffer | null): unknown {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private isDeleteStatusMessage(
    payload: unknown
  ): payload is IProfileStatusDeleteMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return (
      'worker_profile_status_id' in payload &&
      'worker_id' in payload &&
      'external_id' in payload
    );
  }

  private isStatusMessage(payload: unknown): payload is IProfileStatusMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return (
      'worker_profile_status_id' in payload &&
      'worker_id' in payload &&
      !('external_id' in payload)
    );
  }

  private isProfileInfoMessage(
    payload: unknown
  ): payload is IProfileInfoMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return 'worker_id' in payload && 'account_id' in payload;
  }

  private isSendMessage(payload: unknown): payload is IChatMessage {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return 'message_id' in payload && 'chat_id' in payload;
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;

    if (!chatId) {
      return null;
    }

    return String(chatId);
  }

  private async enqueueByChatId(
    chatId: string,
    task: () => Promise<void>
  ): Promise<void> {
    await this.keyedSequencerService.enqueue(chatId, task);
  }

  private isTransientError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    const transientPatterns = [
      'timeout',
      'timed out',
      'network',
      'connection',
      'temporary',
      'retry',
      'unavailable',
      'service unavailable',
      'too many requests',
      'rate limit',
    ];

    for (const pattern of transientPatterns) {
      if (lowerMessage.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  private getRandomDelay(): number {
    const array = new Uint32Array(1);
    webcrypto.getRandomValues(array);
    const randomValue = array[0] / (0xffffffff + 1);
    return Math.floor(randomValue * (2000 - 500 + 1)) + 500;
  }

  private async applyDelayIfNeeded(
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<void> {
    if (currentType && currentType === lastType) {
      const delay = this.getRandomDelay();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private getQuotedKey(data: IChatMessage):
    | {
        key: {
          id: string;
          remote_jid?: string | null;
          remote_jid_alt?: string | null;
          from_me?: boolean | null;
        };
      }
    | undefined {
    const quotedKey = data.content?.quoted?.key;
    const id = quotedKey?.id;
    if (!id) return undefined;

    return {
      key: {
        id,
        remote_jid: quotedKey.remote_jid ?? null,
        remote_jid_alt: quotedKey.remote_jid_alt ?? null,
        from_me: quotedKey.from_me ?? null,
      },
    };
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const jid = selectJidChat(data);
    if (!jid) throw new Error('Received message without remoteJid');
    const chatId = this.resolveChatId(data);
    if (!chatId) throw new Error('Received message without chatId');
    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = !!data.content?.quoted || data.has_quoted === true;

    if (
      await this.processTextOrSystemMessage(
        data,
        jid,
        chatId,
        currentType,
        hasQuoted
      )
    )
      return;
    if (
      await this.processImageMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processDocumentMessage(
        data,
        jid,
        chatId,
        currentType,
        lastType
      )
    )
      return;
    if (
      await this.processAudioMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processVideoMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (
      await this.processStickerMessage(data, jid, chatId, currentType, lastType)
    )
      return;
    if (await this.processLocationMessage(data, jid, chatId, currentType))
      return;
    if (await this.processContactCardMessage(data, jid, chatId, currentType))
      return;
    if (await this.processDeleteMessage(data, jid, chatId, currentType)) return;
    await this.processReactMessage(data, jid, chatId, currentType);
  }

  private async processTextOrSystemMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    hasQuoted: boolean
  ): Promise<boolean> {
    if (
      currentType !== EMessageType.text &&
      currentType !== EMessageType.system
    ) {
      return false;
    }

    const hasVersions = !!data.content?.version?.length;
    const messageKey = data.message_key;
    const hasMessageKey = !!messageKey?.id;

    if (currentType === EMessageType.text && hasVersions && hasMessageKey) {
      const latestVersion = data.content?.version
        ? [...data.content.version].sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0]
        : null;

      const newText = latestVersion?.message ?? data.content?.message ?? '';

      const result = await this.wwebjsMessageEditDeleteService.editText(
        newText,
        {
          remoteJid: messageKey?.remote_jid ?? jid,
          fromMe: messageKey?.from_me ?? false,
          id: messageKey?.id ?? '',
          participant: messageKey?.participant ?? undefined,
        }
      );

      if (!result) {
        throw new Error('Failed to edit message');
      }

      await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    const quotedKey = this.getQuotedKey(data);

    if (hasQuoted && quotedKey) {
      const result = await this.wwebjsMessageTextService.sendTextQuoted(
        jid,
        data.content?.message ?? '',
        quotedKey
      );
      if (result) await this.pushUpdate({ message: result, data });
      this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
      return true;
    }

    if (hasQuoted && !quotedKey) {
      console.warn(
        '[MessageSendWwebjs] Quoted flag is true but quoted key is missing. Sending as regular text.'
      );
    }

    const result = await this.wwebjsMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      {
        linkPreview: data.content?.link_preview as {
          title?: string;
          description?: string;
        } | null,
      }
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
    return true;
  }

  private async processImageMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.image || !data.content?.image?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendImage(
      jid,
      { url: data.content.image.url },
      { caption: data.content.image.caption ?? undefined },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.image);
    return true;
  }

  private async processDocumentMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.document || !data.content?.document?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendDocument(
      jid,
      { url: data.content.document.url },
      {
        mimetype: data.content.document.mimetype ?? 'application/octet-stream',
        fileName: data.content.document.name ?? undefined,
        caption: data.content?.message ?? undefined,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.document);
    return true;
  }

  private async processAudioMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.audio || !data.content?.audio?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const waveform =
      data.content.audio.ptt && data.content.audio.waveform
        ? convertWaveformBase64ToUint8Array(data.content.audio.waveform)
        : undefined;
    const result = await this.wwebjsMessageMediaService.sendAudio(
      jid,
      { url: data.content.audio.url },
      {
        ptt: data.content.audio.ptt ?? true,
        seconds: data.content.audio.duration ?? undefined,
        mimetype: data.content.audio.mimetype ?? undefined,
        viewOnce:
          data.message_key?.is_view_once ??
          data.content.audio.view_once ??
          undefined,
        waveform,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.audio);
    return true;
  }

  private async processVideoMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.video || !data.content?.video?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendVideo(
      jid,
      { url: data.content.video.url },
      {
        caption:
          data.content.video.caption ?? data.content?.message ?? undefined,
        seconds: data.content.video.duration ?? undefined,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.video);
    return true;
  }

  private async processStickerMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined,
    lastType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.sticker || !data.content?.sticker?.url)
      return false;
    await this.applyDelayIfNeeded(currentType, lastType);
    const result = await this.wwebjsMessageMediaService.sendSticker(
      jid,
      { url: data.content.sticker.url },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.sticker);
    return true;
  }

  private async processLocationMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.location || !data.content?.location)
      return false;
    const loc = data.content.location;
    const result = await this.wwebjsMessageLocationContactService.sendLocation(
      jid,
      {
        degreesLatitude: loc.latitude ?? 0,
        degreesLongitude: loc.longitude ?? 0,
        name: loc.name ?? undefined,
        address: loc.address ?? undefined,
      },
      this.getQuotedKey(data)
    );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.location);
    return true;
  }

  private async processContactCardMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.contact_card || !data.content?.contact)
      return false;
    const contactData = data.content.contact;
    const vcardLines = ['BEGIN:VCARD', 'VERSION:3.0'];
    const fullName = [contactData.name, contactData.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) {
      vcardLines.push(`N:;${fullName};;;`, `FN:${fullName}`);
    }
    if (contactData.phone) vcardLines.push(`TEL:${contactData.phone}`);
    if (contactData.email) vcardLines.push(`EMAIL:${contactData.email}`);
    vcardLines.push('END:VCARD');
    const vcard = vcardLines.join('\n');
    const result =
      await this.wwebjsMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        this.getQuotedKey(data)
      );
    if (result) await this.pushUpdate({ message: result, data });
    this.lastMessageTypeByChatId.set(chatId, EMessageType.contact_card);
    return true;
  }

  private async processDeleteMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<boolean> {
    if (currentType !== EMessageType.delete_message || !data.message_key?.id) {
      return false;
    }
    const key = {
      remoteJid: data.message_key.remote_jid ?? jid,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };
    await this.wwebjsMessageEditDeleteService.deleteMessage(key);
    this.lastMessageTypeByChatId.set(chatId, EMessageType.delete_message);
    return true;
  }

  private async processReactMessage(
    data: IChatMessage,
    jid: string,
    chatId: string,
    currentType: EMessageType | undefined
  ): Promise<void> {
    if (
      currentType !== EMessageType.react ||
      !data.message_key?.id ||
      !data.content?.reactions?.length
    ) {
      return;
    }
    const lastReaction =
      data.content.reactions[data.content.reactions.length - 1];
    const key = {
      remoteJid: jid,
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };
    await this.wwebjsMessageReactionsInteractionsService.react(
      key,
      lastReaction.emoji
    );
    this.lastMessageTypeByChatId.set(chatId, EMessageType.react);
  }

  private async processProfileStatus(
    data: IProfileStatusMessage
  ): Promise<void> {
    const jid = 'status@broadcast';
    const valueParts = data.value.split('|');
    const url = valueParts[0];
    const caption =
      valueParts.length > 1 ? valueParts.slice(1).join('|') : undefined;

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.text) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusText(
          jid,
          data.value
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.image) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusImage(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.video) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusVideo(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
      return;
    }

    if (data.worker_profile_status_type_id === EWorkerProfileStatusType.audio) {
      const result =
        await this.wwebjsMessageStatusStoriesService.sendStatusAudio(
          jid,
          { url },
          { caption }
        );
      if (result?.key?.id) {
        await this.sendExternalIdUpdate(
          data.worker_profile_status_id,
          result.key.id
        );
      }
    }
  }

  private async processDeleteStatus(
    data: IProfileStatusDeleteMessage
  ): Promise<void> {
    await this.wwebjsMessageStatusStoriesService.deleteStatus(data.external_id);
  }

  private async processProfileInfo(data: IProfileInfoMessage): Promise<void> {
    if (data.name) {
      await this.wwebjsProfileService.updateProfileName(data.name);
    }

    if (data.message) {
      await this.wwebjsProfileService.updateProfileStatus(data.message);
    }

    if (data.photo === null) {
      await this.wwebjsProfileService.removeProfilePicture();
      return;
    }

    if (data.photo) {
      await this.wwebjsProfileService.updateProfilePicture(data.photo);
    }
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    await this.streamProducerService.send(topic, input);
  }

  private async sendExternalIdUpdate(
    workerProfileStatusId: string,
    externalId: string
  ): Promise<void> {
    const updateMessage: IUpdateProfileStatusExternalId = {
      worker_profile_status_id: workerProfileStatusId,
      external_id: externalId,
    };

    const topic = this.kafkaServiceQueueService.updateProfileStatusExternalId();
    await this.streamProducerService.send(topic, updateMessage);
  }
}
