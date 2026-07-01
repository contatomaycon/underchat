import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { Buffer } from 'node:buffer';
import { v7 as uuidv7 } from 'uuid';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  MetaWhatsappContactMessage,
  MetaGraphApiError,
  MetaWhatsappEmbeddedService,
  MetaWhatsappMessageSendResult,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { MessageSendIdempotencyService } from '@core/services/messageSendIdempotency.service';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type {
  IChatMessage,
  IContactMessage,
} from '@core/common/interfaces/IChatMessage';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import {
  buildMessageSendQueueKey,
  resolveMessageSendIdentity,
} from '@core/common/functions/messageIdentity';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type {
  KafkaConsumerRunnerContext,
  KafkaRunnerMessage,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';

interface IQueuedEnvelope {
  sourceTopic: string;
  partition: number;
  offset: number;
  kafkaKey: string | null;
  payload: unknown;
  queueKey: string;
  chatId: string | null;
}

@singleton()
export class OfficialWhatsappMessageSendConsume {
  private readonly PROVIDER = 'official-whatsapp';
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<unknown> | null = null;
  private isRunning = false;
  private readonly SYSTEM_QUEUE_KEY = 'system';
  private readonly META_MESSAGE_ID_PREFIX = 'wamid.';

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.officialWhatsappSendMessage();
    this.runner = new KafkaConsumerRunner<unknown>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-official-whatsapp-send',
      parse: (message) =>
        this.parseRawMessage(this.extractRawMessage(message.value)),
      resolveEntityKey: (payload, message) =>
        this.resolveQueueContext(payload, message).queueKey,
      preserveEntityOrder: true,
      handle: (payload, context) =>
        this.processRunnerPayload(topic, payload, context),
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  public async restart(): Promise<void> {
    await this.close();
    await this.execute();
  }

  private extractRawMessage(value: Buffer | null): string | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    return raw || null;
  }

  private parseRawMessage(raw: string | null): unknown {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private isSendMessage(payload: unknown): payload is IChatMessage {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'message_id' in payload &&
      'chat_id' in payload
    );
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;
    return chatId ? String(chatId) : null;
  }

  private resolveQueueContext(
    payload: unknown,
    message?: KafkaRunnerMessage
  ): {
    queueKey: string;
    chatId: string | null;
  } {
    if (this.isSendMessage(payload)) {
      const chatId = this.resolveChatId(payload);
      if (chatId) {
        return {
          queueKey: buildMessageSendQueueKey(payload.account.id, chatId),
          chatId,
        };
      }
    }

    return {
      queueKey: message
        ? `offset:${message.partition}:${message.offset}`
        : this.SYSTEM_QUEUE_KEY,
      chatId: null,
    };
  }

  private async processRunnerPayload(
    topic: string,
    payload: unknown,
    context: KafkaConsumerRunnerContext<unknown>
  ): Promise<void> {
    const { queueKey, chatId } = this.resolveQueueContext(payload);
    const envelope: IQueuedEnvelope = {
      sourceTopic: topic,
      partition: context.partition,
      offset: context.offset,
      kafkaKey: context.kafkaKey,
      payload,
      queueKey,
      chatId,
    };

    try {
      await this.processPayload(payload, envelope);
    } catch (error) {
      await this.routeFailedMessage(envelope, error);
    }
  }

  private async processPayload(
    payload: unknown,
    envelope: IQueuedEnvelope
  ): Promise<void> {
    if (!this.isSendMessage(payload)) {
      console.warn('[OfficialWhatsappMessageSend] Unsupported payload skipped');
      return;
    }

    const claimStatus = await this.claimMessageSend(payload);
    if (claimStatus === 'duplicate') {
      return;
    }

    if (claimStatus !== 'acquired') {
      throw new Error(`message_send_idempotency_${claimStatus}`);
    }

    const result = await this.sendMessage(payload);
    await this.pushMessageUpdate(payload, result);
    await this.pushSentStatus(payload, result);

    const annotation = this.resolveWindowAnnotation(payload, result.raw);
    if (annotation) {
      await this.publishAnnotation(payload, annotation);
    }

    envelope.chatId = this.resolveChatId(payload);
  }

  private async claimMessageSend(
    payload: IChatMessage
  ): Promise<'acquired' | 'duplicate' | 'error' | 'missing_identity'> {
    const identity = resolveMessageSendIdentity(payload);
    if (!identity) {
      return 'missing_identity';
    }

    payload.hash = identity.hash;

    const claimStatus = await this.messageSendIdempotencyService.claimSend(
      identity.accountId,
      identity.hash,
      {
        provider: this.PROVIDER,
        account_id: identity.accountId,
        chat_id: identity.chatId,
        message_id: identity.messageId,
        worker_id: payload.worker.id,
      }
    );

    if (claimStatus === 'duplicate') {
      return 'duplicate';
    }

    if (claimStatus === 'error') {
      return 'error';
    }

    return 'acquired';
  }

  private async sendMessage(
    data: IChatMessage
  ): Promise<MetaWhatsappMessageSendResult> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        data.worker.id
      );

    if (!connection) {
      throw new Error('official_whatsapp_connection_not_found');
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const to = this.resolveRecipientPhone(data);

    if (!to) {
      throw new Error('official_whatsapp_recipient_required');
    }

    const content = data.content;
    if (!content) {
      throw new Error('official_whatsapp_content_required');
    }

    const contextMessageId = this.resolveContextMessageId(data);
    const messageType = content.type;

    if (messageType === EMessageType.official_template) {
      const template = content.official_template;
      if (!template?.name || !template.language) {
        throw new Error('official_whatsapp_template_required');
      }

      return this.metaWhatsappEmbeddedService.sendTemplateMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        templateName: template.name,
        language: template.language,
        components: this.officialWhatsappTemplateService.buildMetaComponents(
          template.variables
        ),
      });
    }

    if (
      messageType === EMessageType.text ||
      messageType === EMessageType.system
    ) {
      const message = content.message?.trim();
      if (!message) {
        throw new Error('official_whatsapp_text_required');
      }

      return this.metaWhatsappEmbeddedService.sendTextMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        message,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.image) {
      const image = data.content?.image;
      const mediaId = await this.uploadOutboundMedia({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        media: image,
        fallbackPrefix: 'image',
      });

      return this.metaWhatsappEmbeddedService.sendImageMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: image?.caption ?? data.content?.message ?? null,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.video) {
      const video = data.content?.video;
      const mediaId = await this.uploadOutboundMedia({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        media: video,
        fallbackPrefix: 'video',
      });

      return this.metaWhatsappEmbeddedService.sendVideoMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: video?.caption ?? data.content?.message ?? null,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.audio) {
      const audio = data.content?.audio;
      if (audio?.view_once) {
        throw new Error('whatsapp_official_view_once_not_supported');
      }
      const mediaId = await this.uploadOutboundMedia({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        media: audio,
        fallbackPrefix: 'audio',
      });

      return this.metaWhatsappEmbeddedService.sendAudioMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        voice: audio?.ptt === true,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.document) {
      const document = data.content?.document;
      const mediaId = await this.uploadOutboundMedia({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        media: document,
        fallbackPrefix: 'document',
      });

      return this.metaWhatsappEmbeddedService.sendDocumentMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        caption: data.content?.message ?? null,
        filename: this.resolveMediaFilename(document, 'document'),
        contextMessageId,
      });
    }

    if (messageType === EMessageType.sticker) {
      const sticker = data.content?.sticker;
      const mediaId = await this.uploadOutboundMedia({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        media: sticker,
        fallbackPrefix: 'sticker',
      });

      return this.metaWhatsappEmbeddedService.sendStickerMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        mediaId,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.location) {
      const location = data.content?.location;
      if (
        typeof location?.latitude !== 'number' ||
        typeof location?.longitude !== 'number'
      ) {
        throw new Error('official_whatsapp_location_required');
      }

      return this.metaWhatsappEmbeddedService.sendLocationMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name ?? null,
        address: location.address ?? null,
        contextMessageId,
      });
    }

    if (
      messageType === EMessageType.contact_card ||
      messageType === EMessageType.contacts
    ) {
      const contacts = this.resolveMetaContacts(data);
      if (contacts.length === 0) {
        throw new Error('official_whatsapp_contacts_required');
      }

      return this.metaWhatsappEmbeddedService.sendContactsMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        contacts,
        contextMessageId,
      });
    }

    if (messageType === EMessageType.react) {
      const messageId = this.resolveReactionTargetMessageId(data);
      const emoji = data.content?.message ?? '';
      if (!messageId) {
        throw new Error('official_whatsapp_reaction_target_required');
      }

      return this.metaWhatsappEmbeddedService.sendReactionMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        messageId,
        emoji,
      });
    }

    throw new Error(this.unsupportedOfficialTypeError(messageType));
  }

  private unsupportedOfficialTypeError(type?: EMessageType | null): string {
    if (type === EMessageType.edit_text) {
      return 'whatsapp_official_edit_message_not_supported';
    }
    if (type === EMessageType.delete_message) {
      return 'whatsapp_official_delete_message_not_supported';
    }
    if (type === EMessageType.view_once) {
      return 'whatsapp_official_view_once_not_supported';
    }
    if (type === EMessageType.video_note) {
      return 'whatsapp_official_video_note_not_supported';
    }
    if (type === EMessageType.set_disappearing_messages) {
      return 'whatsapp_official_disappearing_messages_not_supported';
    }

    return `official_whatsapp_unsupported_type:${type}`;
  }

  private resolveContextMessageId(data: IChatMessage): string | null {
    const messageId = data.content?.quoted?.key?.id?.trim();
    if (!messageId?.startsWith(this.META_MESSAGE_ID_PREFIX)) {
      return null;
    }

    return messageId;
  }

  private resolveReactionTargetMessageId(data: IChatMessage): string | null {
    const messageId = data.message_key?.id?.trim();
    if (!messageId?.startsWith(this.META_MESSAGE_ID_PREFIX)) {
      return null;
    }

    return messageId;
  }

  private async uploadOutboundMedia(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    media?: {
      url?: string | null;
      mimetype?: string | null;
      name?: string | null;
      extension?: string | null;
    } | null;
    fallbackPrefix: string;
  }): Promise<string> {
    const url = input.media?.url?.trim();
    if (!url) {
      throw new Error('official_whatsapp_media_url_required');
    }

    return this.metaWhatsappEmbeddedService.uploadMediaFromUrl({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      url,
      filename: this.resolveMediaFilename(input.media, input.fallbackPrefix),
      mimetype: input.media?.mimetype ?? null,
    });
  }

  private resolveMediaFilename(
    media:
      | {
          url?: string | null;
          mimetype?: string | null;
          name?: string | null;
          extension?: string | null;
        }
      | null
      | undefined,
    fallbackPrefix: string
  ): string {
    const name = media?.name?.trim();
    if (name) {
      return name;
    }

    const url = media?.url?.trim();
    if (url) {
      try {
        const filename = new URL(url).pathname.split('/').filter(Boolean).pop();
        if (filename) {
          return decodeURIComponent(filename);
        }
      } catch {
        // Ignore malformed URLs and use the fallback below.
      }
    }

    const extension =
      media?.extension?.replace(/^\./u, '').trim() ||
      this.extensionFromMime(media?.mimetype ?? null);

    return `${fallbackPrefix}.${extension}`;
  }

  private extensionFromMime(mimetype?: string | null): string {
    const normalized = mimetype?.split(';')[0]?.trim().toLowerCase();
    const extension = normalized?.split('/')[1]?.replace(/[^a-z0-9.+-]/gu, '');
    if (!extension) {
      return 'bin';
    }

    return extension === 'jpeg' ? 'jpg' : extension;
  }

  private resolveMetaContacts(
    data: IChatMessage
  ): MetaWhatsappContactMessage[] {
    const contacts = Array.isArray(data.content?.contacts)
      ? data.content.contacts
      : [];
    const allContacts =
      contacts.length > 0
        ? contacts
        : data.content?.contact
          ? [data.content.contact]
          : [];

    return allContacts
      .map((contact) => this.toMetaContact(contact))
      .filter((contact): contact is MetaWhatsappContactMessage =>
        Boolean(contact)
      );
  }

  private toMetaContact(
    contact: IContactMessage | null | undefined
  ): MetaWhatsappContactMessage | null {
    if (!contact) {
      return null;
    }

    const firstName = contact.name?.trim();
    const lastName = contact.last_name?.trim();
    const formattedName = [firstName, lastName].filter(Boolean).join(' ');
    if (!formattedName) {
      return null;
    }

    const metaContact: MetaWhatsappContactMessage = {
      name: {
        formatted_name: formattedName,
      },
    };

    if (firstName) {
      metaContact.name.first_name = firstName;
    }
    if (lastName) {
      metaContact.name.last_name = lastName;
    }

    const phone = this.resolveContactPhone(contact);
    if (phone) {
      metaContact.phones = [
        {
          phone: phone.display,
          type: 'CELL',
          wa_id: phone.waId,
        },
      ];
    }

    const email = contact.email?.trim() || contact.email_partial?.trim();
    if (email) {
      metaContact.emails = [
        {
          email,
          type: 'WORK',
        },
      ];
    }

    return metaContact;
  }

  private resolveContactPhone(
    contact: IContactMessage
  ): { display: string; waId: string } | null {
    const phoneDigits = (contact.phone ?? contact.phone_partial ?? '').replace(
      /\D/gu,
      ''
    );
    const ddiDigits = (contact.phone_ddi ?? '').replace(/\D/gu, '');

    if (!phoneDigits && !ddiDigits) {
      return null;
    }

    const waId =
      ddiDigits &&
      phoneDigits.startsWith(ddiDigits) &&
      phoneDigits.length > ddiDigits.length + 8
        ? phoneDigits
        : `${ddiDigits}${phoneDigits}`;
    const localDigits =
      ddiDigits && phoneDigits.startsWith(ddiDigits)
        ? phoneDigits.slice(ddiDigits.length)
        : phoneDigits;
    const display = ddiDigits ? `+${ddiDigits} ${localDigits}` : localDigits;

    return {
      display,
      waId,
    };
  }

  private resolveRecipientPhone(data: IChatMessage): string | null {
    const rawPhone =
      data.phone || data.message_key?.remote_jid?.split('@')[0] || '';
    const digits = rawPhone.replace(/\D/gu, '');
    return digits || null;
  }

  private async pushMessageUpdate(
    data: IChatMessage,
    result: MetaWhatsappMessageSendResult
  ): Promise<void> {
    if (!result.message_id) {
      return;
    }

    const update: IUpdateMessage = {
      message: {
        key: {
          id: result.message_id,
          remoteJid: result.contact_wa_id
            ? `${result.contact_wa_id}@s.whatsapp.net`
            : (data.message_key?.remote_jid ?? undefined),
          fromMe: true,
        },
      },
      data,
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.updateMessage(),
      update,
      buildMessageSendQueueKey(data.account.id, data.chat_id)
    );
  }

  private async pushSentStatus(
    data: IChatMessage,
    result: MetaWhatsappMessageSendResult
  ): Promise<void> {
    if (!result.message_id) {
      return;
    }

    const statusUpdate: IMessageStatusUpdate = {
      account_id: data.account.id,
      message_id: result.message_id,
      patch: {
        is_sent: true,
      },
      key: {
        id: result.message_id,
        remoteJid: result.contact_wa_id
          ? `${result.contact_wa_id}@s.whatsapp.net`
          : (data.message_key?.remote_jid ?? undefined),
        fromMe: true,
      },
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.updateMessageStatus(),
      statusUpdate,
      MessageStatusService.statusKafkaKey(data.account.id, result.message_id)
    );
  }

  private async routeFailedMessage(
    envelope: IQueuedEnvelope,
    error: unknown
  ): Promise<void> {
    const messageId = this.extractMessageId(envelope.payload);
    if (messageId && this.isSendMessage(envelope.payload)) {
      await this.messageStatusService.markMessageAsNotSent(
        envelope.payload.account.id,
        messageId
      );
    }

    const annotation = this.resolveWindowAnnotation(
      this.isSendMessage(envelope.payload) ? envelope.payload : null,
      error
    );
    if (annotation && this.isSendMessage(envelope.payload)) {
      await this.publishAnnotation(envelope.payload, annotation);
    }

    console.error('[OfficialWhatsappMessageSend] terminal send failure:', {
      provider: this.PROVIDER,
      source_topic: envelope.sourceTopic,
      partition: envelope.partition,
      offset: envelope.offset,
      kafka_key: envelope.kafkaKey,
      queue_key: envelope.queueKey,
      chat_id: envelope.chatId,
      message_id: messageId,
      error: this.errorMessage(error),
    });
  }

  private extractMessageId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as { message_id?: unknown }).message_id;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private resolveWindowAnnotation(
    message: IChatMessage | null,
    payload: unknown
  ): string | null {
    if (!message) {
      return null;
    }

    if (this.hasExplicitOpenWindowSignal(payload)) {
      return 'A Meta retornou um sinal explícito de janela de conversa válida para este contato neste canal oficial.';
    }

    return null;
  }

  private hasExplicitOpenWindowSignal(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if (payload instanceof MetaGraphApiError) {
      return false;
    }

    const stack: unknown[] = [payload];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== 'object') {
        continue;
      }

      for (const [key, value] of Object.entries(
        current as Record<string, unknown>
      )) {
        const normalizedKey = key.toLowerCase();
        if (
          /(?:conversation|customer|service).*window/u.test(normalizedKey) ||
          /window.*(?:open|valid|active)/u.test(normalizedKey)
        ) {
          if (value === true) {
            return true;
          }

          if (
            typeof value === 'string' &&
            /^(?:open|opened|active|valid|true)$/iu.test(value.trim())
          ) {
            return true;
          }
        }

        if (value && typeof value === 'object') {
          stack.push(value);
        }
      }
    }

    return false;
  }

  private async publishAnnotation(
    data: IChatMessage,
    message: string
  ): Promise<void> {
    await this.chatMessageService.publishPreparedMessage({
      message_id: uuidv7(),
      chat_id: data.chat_id,
      message_key: {
        remote_jid: data.message_key?.remote_jid ?? null,
        remote_jid_alt: data.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.system,
      account: data.account,
      worker: data.worker,
      user: data.user ?? null,
      phone: data.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      content: {
        type: EMessageType.annotation,
        message,
      },
      date: new Date().toISOString(),
    });
  }
}
