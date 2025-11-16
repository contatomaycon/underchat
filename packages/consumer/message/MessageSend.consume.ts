import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';
import { BaileysMessageReactionsInteractionsService } from '@core/services/baileys/methods/messageReactionsInteractions.service';
import { BaileysMessageEditDeleteService } from '@core/services/baileys/methods/messageEditDelete.service';
import { BaileysMessageLocationContactService } from '@core/services/baileys/methods/messageLocationContact.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { proto, WAMessage, WAUrlInfo } from '@whiskeysockets/baileys';
import { Buffer } from 'node:buffer';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';
import { Kafka, Consumer } from 'kafkajs';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { convertWaveformBase64ToUint8Array } from '@core/common/functions/convertWaveform';
import { webcrypto } from 'node:crypto';

@singleton()
export class MessageSendConsume {
  private consumer: Consumer | null = null;
  private readonly lastMessageTypeByChatId: Map<string, EMessageType> =
    new Map();

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly baileysMessageMediaService: BaileysMessageMediaService,
    private readonly baileysMessageReactionsInteractionsService: BaileysMessageReactionsInteractionsService,
    private readonly baileysMessageEditDeleteService: BaileysMessageEditDeleteService,
    private readonly baileysMessageLocationContactService: BaileysMessageLocationContactService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly keyedSequencerService: KeyedSequencerService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-send-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaBaileysQueueService.workerSendMessage(
      baileysEnvironment.baileysWorkerId
    );

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

        const chatId = this.resolveChatId(data);
        if (!chatId) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.enqueueByChatId(chatId, async () => {
            await this.processMessage(data);
          });
        } catch {
          await this.commitNext(topic, partition, message.offset);
        } finally {
          stop();
        }

        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    await this.keyedSequencerService.drain();

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

  private parseMessage(value: Buffer | null): IChatMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IChatMessage;
      return parsed ?? null;
    } catch {
      return null;
    }
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

  private async processMessageWithDelay(
    jid: string,
    chatId: string,
    data: IChatMessage,
    currentType: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.applyDelayIfNeeded(currentType, lastType);
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, currentType);
  }

  private async processMediaMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    lastType: EMessageType | undefined,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await this.processMessageWithDelay(
      jid,
      chatId,
      data,
      type,
      lastType,
      processor
    );
  }

  private async processTextMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    hasQuoted: boolean
  ): Promise<void> {
    if (hasQuoted && data.content?.quoted) {
      await this.processTextQuoted(jid, data);
    } else {
      await this.processText(jid, data);
    }
    this.lastMessageTypeByChatId.set(chatId, EMessageType.text);
  }

  private async processActionMessage(
    jid: string,
    chatId: string,
    data: IChatMessage,
    type: EMessageType,
    processor: (jid: string, data: IChatMessage) => Promise<void>
  ): Promise<void> {
    await processor(jid, data);
    this.lastMessageTypeByChatId.set(chatId, type);
  }

  private selectMessageHandler(
    currentType: EMessageType | undefined,
    jid: string,
    chatId: string,
    data: IChatMessage,
    lastType: EMessageType | undefined,
    hasQuoted: boolean
  ): (() => Promise<void>) | null {
    if (!currentType) {
      return null;
    }

    if (currentType === EMessageType.image && data.content?.image?.url) {
      return () =>
        this.processMediaMessage(
          jid,
          chatId,
          data,
          EMessageType.image,
          lastType,
          (j, d) => this.processImage(j, d)
        );
    }

    if (currentType === EMessageType.document && data.content?.document?.url) {
      return () =>
        this.processMediaMessage(
          jid,
          chatId,
          data,
          EMessageType.document,
          lastType,
          (j, d) => this.processDocument(j, d)
        );
    }

    if (currentType === EMessageType.audio && data.content?.audio?.url) {
      return () =>
        this.processMediaMessage(
          jid,
          chatId,
          data,
          EMessageType.audio,
          lastType,
          (j, d) => this.processAudio(j, d)
        );
    }

    if (currentType === EMessageType.video && data.content?.video?.url) {
      return () =>
        this.processMediaMessage(
          jid,
          chatId,
          data,
          EMessageType.video,
          lastType,
          (j, d) => this.processVideo(j, d)
        );
    }

    if (currentType === EMessageType.text && data.content?.message) {
      return () => this.processTextMessage(jid, chatId, data, hasQuoted);
    }

    if (currentType === EMessageType.contact_card && data.content?.contact) {
      return () =>
        this.processActionMessage(
          jid,
          chatId,
          data,
          EMessageType.contact_card,
          (j, d) => this.processContact(j, d)
        );
    }

    if (currentType === EMessageType.delete_message && data.message_key?.id) {
      return () =>
        this.processActionMessage(
          jid,
          chatId,
          data,
          EMessageType.delete_message,
          (j, d) => this.processDelete(j, d)
        );
    }

    if (currentType === EMessageType.react && data.message_key?.id) {
      return () =>
        this.processActionMessage(
          jid,
          chatId,
          data,
          EMessageType.react,
          (j, d) => this.processReact(j, d)
        );
    }

    return null;
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const jid = selectJidChat(data);

    if (!jid) {
      throw new Error('Received message without remoteJid');
    }

    const chatId = this.resolveChatId(data);
    if (!chatId) {
      throw new Error('Received message without chatId');
    }

    const currentType = data?.content?.type;
    const lastType = this.lastMessageTypeByChatId.get(chatId);
    const hasQuoted = data.has_quoted ?? !!data.content?.quoted;

    const handler = this.selectMessageHandler(
      currentType,
      jid,
      chatId,
      data,
      lastType,
      hasQuoted
    );

    if (handler) {
      await handler();
    }
  }

  private async processDelete(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id) {
      return;
    }

    const messageKey = {
      remoteJid: data.message_key.remote_jid ?? '',
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };

    await this.baileysMessageEditDeleteService.deleteMessage(jid, messageKey);
  }

  private async processDocument(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const document = data.content?.document;

    if (!document?.url) {
      throw new Error('Document URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendDocument(
      jid,
      { url: document.url },
      {
        mimetype: document.mimetype ?? 'application/octet-stream',
        fileName: document.name ?? undefined,
        caption: data.content?.message ?? undefined,
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send document');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processVideo(jid: string, data: IChatMessage): Promise<void> {
    const video = data.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendVideo(
      jid,
      { url: video.url },
      {
        caption: video.caption ?? data.content?.message ?? undefined,
        seconds: data.content?.video?.duration ?? undefined,
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send video');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processAudio(jid: string, data: IChatMessage): Promise<void> {
    const audio = data.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const isPtt = audio.ptt ?? true;

    let waveform: Uint8Array | undefined;
    if (isPtt && audio.waveform) {
      waveform = convertWaveformBase64ToUint8Array(audio.waveform);
    }

    const result = await this.baileysMessageMediaService.sendAudio(
      jid,
      { url: audio.url },
      {
        ptt: isPtt,
        seconds: audio.duration ?? undefined,
        mimetype: audio.mimetype ?? undefined,
        viewOnce: data.message_key?.is_view_once ?? audio.view_once ?? false,
        waveform,
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send audio');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private generateVCard = (contact: {
    name: string;
    last_name?: string | null;
    phone?: string | null;
    phone_ddi?: string | null;
    email?: string | null;
    email_partial?: string | null;
  }): string => {
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

    const fullName = [contact.name, contact.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (fullName) {
      const nameParts = fullName.split(' ');
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
      const firstName = nameParts[0] || '';
      lines.push(`N:${lastName};${firstName};;;`);
      lines.push(`FN:${fullName}`);
    }

    if (contact.phone) {
      let phone = contact.phone.replace(/\D/g, '');
      const ddi = contact.phone_ddi ? contact.phone_ddi.replace(/\D/g, '') : '';

      if (ddi && phone) {
        phone = `+${ddi}${phone}`;
      }

      if (phone) {
        lines.push(`TEL;TYPE=CELL:${phone}`);
      }
    }

    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }
    if (!contact.email && contact.email_partial) {
      lines.push(`EMAIL:${contact.email_partial}`);
    }

    lines.push('END:VCARD');
    return lines.join('\n');
  };

  private async processContact(jid: string, data: IChatMessage): Promise<void> {
    const contactData = data.content?.contact;

    if (!contactData) {
      throw new Error('Contact data is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const vcard = this.generateVCard(contactData);

    const displayName =
      `${contactData.name} ${contactData.last_name || ''}`.trim() || 'Contato';

    const result =
      await this.baileysMessageLocationContactService.sendContactCard(
        jid,
        vcard,
        displayName,
        quotedMessage ? { quoted: quotedMessage } : undefined
      );

    if (!result) {
      throw new Error('Failed to send contact');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processReact(jid: string, data: IChatMessage): Promise<void> {
    if (!data.message_key?.id || !data.content?.reactions) {
      return;
    }

    const lastReaction = data.content.reactions.at(-1);
    if (!lastReaction) {
      return;
    }

    const messageKey = {
      remoteJid: data.message_key.remote_jid ?? '',
      fromMe: data.message_key.from_me ?? false,
      id: data.message_key.id,
      participant: data.message_key.participant ?? undefined,
    };

    const result = await this.baileysMessageReactionsInteractionsService.react(
      jid,
      messageKey,
      lastReaction.emoji
    );

    if (!result) {
      throw new Error('Failed to send reaction');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processText(jid: string, data: IChatMessage): Promise<void> {
    const result = await this.baileysMessageTextService.sendText(
      jid,
      data.content?.message ?? '',
      { linkPreview: data.content?.link_preview as WAUrlInfo }
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processImage(jid: string, data: IChatMessage): Promise<void> {
    const imageUrl = data.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    const quotedMessage = data.content?.quoted
      ? this.composeQuotedMessage(data)
      : undefined;

    const result = await this.baileysMessageMediaService.sendImage(
      jid,
      { url: imageUrl },
      {
        caption: data.content?.image?.caption ?? undefined,
      },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );

    if (!result) {
      throw new Error('Failed to send image');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processTextQuoted(
    jid: string,
    data: IChatMessage
  ): Promise<void> {
    const quoted = this.composeQuotedMessage(data);

    const result = await this.baileysMessageTextService.sendTextQuoted(
      jid,
      data.content?.message ?? '',
      quoted
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private extractBase64FromThumbnail(thumb: string | null): string | null {
    if (!thumb) return null;
    if (!thumb.startsWith('data:')) return thumb;
    return thumb.split(',')[1] ?? null;
  }

  private createQuotedImageMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.image) return null;

    const thumb = q.image?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      imageMessage: {
        caption: q.image?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
      },
    };
  }

  private createQuotedVideoMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.video) return null;

    const thumb = q.video?.thumbnail ?? null;
    const base64 = this.extractBase64FromThumbnail(thumb);

    return {
      videoMessage: {
        caption: q.video?.caption ?? undefined,
        jpegThumbnail: base64 ? Buffer.from(base64, 'base64') : undefined,
        fileLength: q.video?.size ?? undefined,
        mimetype: q.video?.mimetype ?? undefined,
      },
    };
  }

  private createQuotedDocumentMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.document || !q?.document) return null;

    return {
      documentMessage: {
        fileName: q.document.name ?? undefined,
        mimetype: q.document.mimetype ?? undefined,
        caption: q.message ?? undefined,
        fileLength: q.document.size ?? undefined,
      },
    };
  }

  private createQuotedAudioMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.audio || !q?.audio) return null;

    return {
      audioMessage: {
        ptt: q.audio.ptt ?? true,
        seconds: q.audio.duration ?? undefined,
        mimetype: q.audio.mimetype ?? undefined,
      },
    };
  }

  private createQuotedTextMessage(
    q: NonNullable<IChatMessage['content']>['quoted']
  ): proto.IMessage | null {
    if (q?.type !== EMessageType.text || !q?.message) return null;

    return {
      conversation: q.message,
    };
  }

  private composeQuotedMessage(data: IChatMessage): WAMessage {
    const q = data.content?.quoted;

    const quoted: WAMessage = {
      key: {
        remoteJid: q?.key.remote_jid ?? '',
        fromMe: q?.key.from_me ?? false,
        id: q?.key.id ?? '',
        participant: q?.key.participant ?? undefined,
      },
      message: (q?.message as proto.IMessage | null) ?? null,
    };

    if (quoted.message) {
      return quoted;
    }

    if (!q) {
      return quoted;
    }

    const messageCreators = [
      () => this.createQuotedTextMessage(q),
      () => this.createQuotedImageMessage(q),
      () => this.createQuotedVideoMessage(q),
      () => this.createQuotedDocumentMessage(q),
      () => this.createQuotedAudioMessage(q),
    ];

    for (const creator of messageCreators) {
      const message = creator();
      if (message) {
        quoted.message = message;
        break;
      }
    }

    return quoted;
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();

    await this.streamProducerService.send(topic, input);
  }
}
