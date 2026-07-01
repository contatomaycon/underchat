import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { Buffer } from 'node:buffer';
import { v7 as uuidv7 } from 'uuid';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
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
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
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

    if (data.content?.type === EMessageType.official_template) {
      const template = data.content.official_template;
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

    if (data.content?.type === EMessageType.text) {
      const message = data.content.message?.trim();
      if (!message) {
        throw new Error('official_whatsapp_text_required');
      }

      return this.metaWhatsappEmbeddedService.sendTextMessage({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
        to,
        message,
      });
    }

    throw new Error(`official_whatsapp_unsupported_type:${data.content?.type}`);
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
