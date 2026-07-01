import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import Redis from 'ioredis';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  MetaWhatsappDownloadedMedia,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  IActiveWorkerWhatsappOfficialConnectionWithWorker,
  WorkerWhatsappOfficialConnectionRepository,
} from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import { StorageService } from '@core/services/storage.service';
import {
  MessageStatusService,
  MessageSummaryPatch,
} from '@core/services/messageStatus.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { InboundMessageSpoolService } from '@core/services/inboundMessageSpool.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type {
  KafkaConsumerRunnerContext,
  KafkaRunnerMessage,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import {
  IMetaWhatsappWebhookChange,
  IMetaWhatsappWebhookChangeValue,
  IMetaWhatsappWebhookEvent,
  IMetaWhatsappWebhookPayload,
} from '@core/common/interfaces/IMetaWhatsappWebhookEvent';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import {
  IContactMessage,
  IContent,
} from '@core/common/interfaces/IChatMessage';
import { IOfficialWhatsappContentMetadata } from '@core/common/interfaces/IOfficialWhatsappContentMetadata';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { EMessageType } from '@core/common/enums/EMessageType';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

type MetaRecord = Record<string, unknown>;

interface IResolvedChangeContext {
  event: IMetaWhatsappWebhookEvent;
  entryId: string | null;
  field: string;
  value: IMetaWhatsappWebhookChangeValue;
  phoneNumberId: string | null;
  connection: IActiveWorkerWhatsappOfficialConnectionWithWorker | null;
}

@singleton()
export class OfficialWhatsappWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IMetaWhatsappWebhookEvent> | null = null;
  private isRunning = false;
  private readonly processedTtlSeconds = 60 * 60 * 24 * 7;
  private readonly mediaCacheTtlSeconds = 60 * 60 * 24 * 7;
  private readonly processedPrefix = 'official-whatsapp:webhook:processed:v1';
  private readonly mediaCachePrefix = 'official-whatsapp:media:v1';

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject('Redis') private readonly redis: Redis,
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
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(InboundMessageSpoolService)
    private readonly inboundMessageSpoolService: InboundMessageSpoolService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.officialWhatsappWebhookEvent();
    this.runner = new KafkaConsumerRunner<IMetaWhatsappWebhookEvent>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-official-whatsapp-webhook',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (payload, message) =>
        this.resolveEventEntityKey(payload.payload, message),
      preserveEntityOrder: true,
      maxRetries: 3,
      retryDelaysMs: [500, 2_000, 5_000],
      processingTimeoutMs: 120_000,
      handle: (payload, context) => this.processWebhookEvent(payload, context),
      onInvalidMessage: (message) => this.parkInvalidMessage(message),
      onDiscarded: (payload, context, error, reason) =>
        this.parkDiscardedMessage(payload, context, error, reason),
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

  private parseMessage(value: Buffer | null): IMetaWhatsappWebhookEvent | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as IMetaWhatsappWebhookEvent | null;

      if (!parsed?.payload || typeof parsed.payload !== 'object') {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  private resolveEventEntityKey(
    payload: IMetaWhatsappWebhookPayload,
    message: KafkaRunnerMessage
  ): string {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
        if (phoneNumberId) {
          return phoneNumberId;
        }
      }

      if (entry.id?.trim()) {
        return entry.id.trim();
      }
    }

    return `offset:${message.partition}:${message.offset}`;
  }

  private async processWebhookEvent(
    event: IMetaWhatsappWebhookEvent,
    context: KafkaConsumerRunnerContext<IMetaWhatsappWebhookEvent>
  ): Promise<void> {
    for (const entry of event.payload.entry ?? []) {
      const entryId = this.toNonEmptyString(entry.id) ?? null;
      for (const change of entry.changes ?? []) {
        await this.processChange(event, entryId, change, context);
      }
    }
  }

  private async processChange(
    event: IMetaWhatsappWebhookEvent,
    entryId: string | null,
    change: IMetaWhatsappWebhookChange,
    context: KafkaConsumerRunnerContext<IMetaWhatsappWebhookEvent>
  ): Promise<void> {
    const value = change.value;
    const field = this.toNonEmptyString(change.field) ?? 'unknown';
    if (!value) {
      await this.parkChange({
        event,
        context,
        reason: 'missing_change_value',
        field,
      });
      return;
    }

    const phoneNumberId =
      this.toNonEmptyString(value.metadata?.phone_number_id) ?? null;
    const connection = phoneNumberId
      ? await this.workerWhatsappOfficialConnectionRepository.findActiveByPhoneNumberIdWithWorker(
          phoneNumberId
        )
      : null;

    const changeContext: IResolvedChangeContext = {
      event,
      entryId,
      field,
      value,
      phoneNumberId,
      connection,
    };

    if (value.messages?.length) {
      await this.processMessages(changeContext);
    }

    if (value.statuses?.length) {
      await this.processStatuses(changeContext);
    }

    if (field === 'account_update') {
      await this.processAccountUpdate(changeContext);
    }

    if (
      !value.messages?.length &&
      !value.statuses?.length &&
      field !== 'account_update'
    ) {
      await this.parkChange({
        event,
        context,
        reason: 'non_chat_webhook_field',
        field,
        accountId: connection?.account_id,
        workerId: connection?.worker_id,
      });
    }
  }

  private async processMessages(
    context: IResolvedChangeContext
  ): Promise<void> {
    if (!context.connection) {
      await this.parkUnresolvedConnection(
        context,
        'message_connection_not_found'
      );
      return;
    }

    for (const rawMessage of context.value.messages ?? []) {
      const message = this.toRecord(rawMessage);
      if (!message) {
        continue;
      }

      const messageId =
        this.toNonEmptyString(message.id) ??
        this.syntheticMessageId(context, message);
      const processedKey = this.processedKey(
        context.connection.account_id,
        'message',
        messageId
      );

      if (await this.isProcessed(processedKey)) {
        continue;
      }

      const upsert = await this.buildUpsertFromMetaMessage(context, message);
      if (!upsert) {
        await this.parkUnresolvedConnection(context, 'message_not_mapped');
        continue;
      }

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.upsertMessage(),
        upsert,
        buildUpsertMessageKafkaKey(upsert, messageId)
      );
      await this.markProcessed(processedKey);
    }
  }

  private async processStatuses(
    context: IResolvedChangeContext
  ): Promise<void> {
    if (!context.connection) {
      await this.parkUnresolvedConnection(
        context,
        'status_connection_not_found'
      );
      return;
    }

    for (const rawStatus of context.value.statuses ?? []) {
      const status = this.toRecord(rawStatus);
      if (!status) {
        continue;
      }

      const messageId = this.toNonEmptyString(status.id);
      if (!messageId) {
        continue;
      }

      const statusValue = this.toNonEmptyString(status.status)?.toLowerCase();
      const processedKey = this.processedKey(
        context.connection.account_id,
        'status',
        `${messageId}:${statusValue ?? 'unknown'}`
      );

      if (await this.isProcessed(processedKey)) {
        continue;
      }

      const recipientPhone = this.toNonEmptyString(status.recipient_id);
      const remoteJid = this.toRemoteJid(recipientPhone);
      const key = {
        id: messageId,
        remoteJid: remoteJid ?? undefined,
        fromMe: true,
      };

      if (statusValue === 'failed') {
        await this.messageStatusService.markMessageAsNotSentByWhatsAppId(
          context.connection.account_id,
          messageId,
          key
        );
        await this.markProcessed(processedKey);
        continue;
      }

      const patch = this.statusToPatch(statusValue);
      if (!patch) {
        await this.markProcessed(processedKey);
        continue;
      }

      const statusUpdate: IMessageStatusUpdate = {
        account_id: context.connection.account_id,
        message_id: messageId,
        patch,
        key,
      };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        statusUpdate,
        MessageStatusService.statusKafkaKey(
          context.connection.account_id,
          messageId
        )
      );
      await this.markProcessed(processedKey);
    }
  }

  private async processAccountUpdate(
    context: IResolvedChangeContext
  ): Promise<void> {
    if (!this.isPartnerRemovedUpdate(context.value)) {
      return;
    }

    const connections = context.connection
      ? [context.connection]
      : context.entryId
        ? await this.workerWhatsappOfficialConnectionRepository.findActiveByWabaIdWithWorker(
            context.entryId
          )
        : [];

    for (const connection of connections) {
      const processedKey = this.processedKey(
        connection.account_id,
        'account_update',
        `partner_removed:${connection.worker_id}`
      );

      if (await this.isProcessed(processedKey)) {
        continue;
      }

      const disconnected =
        await this.workerWhatsappOfficialConnectionRepository.disconnectPreservingWorker(
          {
            accountId: connection.account_id,
            workerId: connection.worker_id,
          }
        );

      if (disconnected) {
        await this.publishOfficialDisconnect(connection);
      }

      await this.markProcessed(processedKey);
    }
  }

  private async buildUpsertFromMetaMessage(
    context: IResolvedChangeContext,
    message: MetaRecord
  ): Promise<IUpsertMessage | null> {
    const connection = context.connection;
    if (!connection) {
      return null;
    }

    const metaType =
      this.toNonEmptyString(message.type)?.toLowerCase() ?? 'unsupported';
    const isEcho = this.isEchoField(context.field);
    const remotePhone = this.resolveMessageRemotePhone(
      message,
      context.value,
      isEcho
    );
    const remoteJid = this.toRemoteJid(remotePhone);
    if (!remoteJid) {
      return null;
    }

    const messageId =
      this.toNonEmptyString(message.id) ??
      this.syntheticMessageId(context, message);
    const timestamp = this.toTimestampSeconds(message.timestamp);
    const official = this.buildOfficialMetadata(context, message, metaType, {
      echo: isEcho,
    });
    const mapped = await this.mapMessageContent({
      connection,
      context,
      message,
      metaType,
      official,
    });

    return {
      worker_id: connection.worker_id,
      account_id: connection.account_id,
      source_provider: 'official_whatsapp',
      type: mapped.type,
      message: {
        key: {
          id: messageId,
          remoteJid,
          fromMe: isEcho,
        },
        message: mapped.rawMessage,
        messageTimestamp: timestamp,
        pushName: this.resolveContactName(context.value, remotePhone),
      },
      content: mapped.content,
      has_quoted: Boolean(mapped.content.message_quoted_id),
    };
  }

  private async mapMessageContent(input: {
    connection: IActiveWorkerWhatsappOfficialConnectionWithWorker;
    context: IResolvedChangeContext;
    message: MetaRecord;
    metaType: string;
    official: IOfficialWhatsappContentMetadata;
  }): Promise<{
    type: EMessageType;
    content: IContent;
    rawMessage: MetaRecord;
  }> {
    const { message, metaType, official } = input;
    const contextMessageId = this.resolveContextMessageId(message);
    const baseContent: Partial<IContent> = {
      official,
      message_quoted_id: contextMessageId,
      context_info: this.resolveContextInfo(message),
    };

    if (metaType === 'text') {
      const text =
        this.toNonEmptyString(this.toRecord(message.text)?.body) ?? '';
      return this.textMapping(text, official, baseContent);
    }

    if (metaType === 'button') {
      const button = this.toRecord(message.button);
      official.button = {
        text: this.toNonEmptyString(button?.text) ?? null,
        payload: this.toNonEmptyString(button?.payload) ?? null,
      };

      return this.textMapping(
        official.button.text ?? official.button.payload ?? '[Botao]',
        official,
        baseContent
      );
    }

    if (metaType === 'interactive') {
      const interactive = this.resolveInteractive(message);
      official.interactive = interactive;
      return this.textMapping(
        interactive?.title ?? interactive?.description ?? '[Interativo]',
        official,
        baseContent
      );
    }

    if (metaType === 'order') {
      const order = this.toRecord(message.order) ?? {};
      official.order = {
        catalog_id: this.toNonEmptyString(order.catalog_id) ?? null,
        text: this.toNonEmptyString(order.text) ?? null,
        product_items: this.toRecordArray(order.product_items),
      };

      return this.textMapping(official.order.text ?? '[Pedido]', official, {
        ...baseContent,
        official,
      });
    }

    if (this.isMediaType(metaType)) {
      return this.mediaMapping(input, baseContent);
    }

    if (metaType === 'location') {
      const location = this.toRecord(message.location) ?? {};
      const latitude = this.toFiniteNumber(location.latitude);
      const longitude = this.toFiniteNumber(location.longitude);
      const content: IContent = {
        type: EMessageType.location,
        message: this.toNonEmptyString(location.name) ?? null,
        location: {
          latitude,
          longitude,
          name: this.toNonEmptyString(location.name) ?? null,
          address: this.toNonEmptyString(location.address) ?? null,
        },
        ...baseContent,
        official,
      };

      return {
        type: EMessageType.location,
        content,
        rawMessage: {
          locationMessage: {
            degreesLatitude: latitude,
            degreesLongitude: longitude,
            name: content.location?.name,
            address: content.location?.address,
          },
        },
      };
    }

    if (metaType === 'contacts') {
      const contacts = this.mapContacts(this.toRecordArray(message.contacts));
      const type =
        contacts.length <= 1
          ? EMessageType.contact_card
          : EMessageType.contacts;
      const content: IContent = {
        type,
        message: contacts[0]?.name ?? '[Contato]',
        contact: type === EMessageType.contact_card ? contacts[0] : null,
        contacts: type === EMessageType.contacts ? contacts : null,
        ...baseContent,
        official,
      };

      return {
        type,
        content,
        rawMessage:
          type === EMessageType.contact_card
            ? { contactMessage: { displayName: contacts[0]?.name } }
            : {
                contactsArrayMessage: {
                  contacts: contacts.map((contact) => ({
                    displayName: contact.name,
                  })),
                },
              },
      };
    }

    if (metaType === 'reaction') {
      const reaction = this.toRecord(message.reaction) ?? {};
      const targetId = this.toNonEmptyString(reaction.message_id);
      const emoji = this.toNonEmptyString(reaction.emoji) ?? '';
      const remoteJid = this.toRemoteJid(
        this.resolveMessageRemotePhone(message, input.context.value, false)
      );

      return {
        type: EMessageType.react,
        content: {
          type: EMessageType.react,
          message: emoji,
          message_quoted_id: targetId ?? undefined,
          ...baseContent,
          official,
        },
        rawMessage: {
          reactionMessage: {
            key: {
              id: targetId,
              remoteJid,
              fromMe: false,
            },
            text: emoji,
            senderTimestampMs:
              this.toTimestampSeconds(message.timestamp) * 1000,
          },
        },
      };
    }

    if (metaType === 'edit') {
      const edit = this.toRecord(message.edit) ?? {};
      const originalId = this.toNonEmptyString(edit.original_message_id);
      const editedMessage = this.toRecord(edit.message) ?? {};
      const editedText =
        this.toNonEmptyString(this.toRecord(editedMessage.text)?.body) ??
        this.toNonEmptyString(editedMessage.text) ??
        '';

      return {
        type: EMessageType.edit_text,
        content: {
          type: EMessageType.edit_text,
          message: editedText,
          message_quoted_id: originalId ?? undefined,
          ...baseContent,
          official,
        },
        rawMessage: {
          protocolMessage: {
            key: {
              id: originalId,
              remoteJid: this.toRemoteJid(
                this.resolveMessageRemotePhone(
                  message,
                  input.context.value,
                  false
                )
              ),
              fromMe: false,
            },
            editedMessage: {
              conversation: editedText,
            },
          },
        },
      };
    }

    if (metaType === 'revoke') {
      const revoke = this.toRecord(message.revoke) ?? {};
      const originalId = this.toNonEmptyString(revoke.original_message_id);
      return {
        type: EMessageType.delete_message,
        content: {
          type: EMessageType.delete_message,
          message_quoted_id: originalId ?? undefined,
          ...baseContent,
          official,
        },
        rawMessage: {
          protocolMessage: {
            key: {
              id: originalId,
              remoteJid: this.toRemoteJid(
                this.resolveMessageRemotePhone(
                  message,
                  input.context.value,
                  false
                )
              ),
              fromMe: false,
            },
          },
        },
      };
    }

    if (metaType === 'system') {
      const system = this.toRecord(message.system) ?? {};
      return {
        type: EMessageType.system,
        content: {
          type: EMessageType.system,
          message: this.toNonEmptyString(system.body) ?? '[Sistema]',
          ...baseContent,
          official,
        },
        rawMessage: { conversation: this.toNonEmptyString(system.body) ?? '' },
      };
    }

    official.unsupported = {
      type: metaType,
      reason: 'unsupported_meta_message_type',
    };

    return {
      type: EMessageType.system,
      content: {
        type: EMessageType.system,
        message: `[Mensagem nao suportada: ${metaType}]`,
        ...baseContent,
        official,
      },
      rawMessage: { conversation: `[Mensagem nao suportada: ${metaType}]` },
    };
  }

  private async mediaMapping(
    input: {
      connection: IActiveWorkerWhatsappOfficialConnectionWithWorker;
      message: MetaRecord;
      metaType: string;
      official: IOfficialWhatsappContentMetadata;
    },
    baseContent: Partial<IContent>
  ): Promise<{
    type: EMessageType;
    content: IContent;
    rawMessage: MetaRecord;
  }> {
    const media = this.toRecord(input.message[input.metaType]) ?? {};
    const caption = this.toNonEmptyString(media.caption) ?? null;
    const mediaType = this.metaMediaTypeToMessageType(input.metaType);
    const content: IContent = {
      type: mediaType,
      message: caption,
      ...baseContent,
      official: input.official,
    };
    const rawMessage: MetaRecord = {};
    const mediaMessageKey = `${input.metaType}Message`;

    try {
      const uploaded = await this.downloadAndUploadMedia(
        input.connection,
        media
      );
      if (!uploaded) {
        content.media_download_failed = true;
      } else {
        const mediaContent = {
          ...uploaded,
          caption,
          ptt:
            input.metaType === 'audio'
              ? Boolean((media as { voice?: unknown }).voice)
              : undefined,
        };

        if (mediaType === EMessageType.image) content.image = mediaContent;
        if (mediaType === EMessageType.video) content.video = mediaContent;
        if (mediaType === EMessageType.audio) content.audio = mediaContent;
        if (mediaType === EMessageType.document)
          content.document = mediaContent;
        if (mediaType === EMessageType.sticker) content.sticker = mediaContent;

        rawMessage[mediaMessageKey] = {
          url: uploaded.url,
          caption,
          mimetype: uploaded.mimetype,
          fileName: uploaded.name,
        };
      }
    } catch (error) {
      content.media_download_failed = true;
      input.official.errors = [
        {
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }

    return { type: mediaType, content, rawMessage };
  }

  private textMapping(
    text: string,
    official: IOfficialWhatsappContentMetadata,
    baseContent: Partial<IContent>
  ): { type: EMessageType; content: IContent; rawMessage: MetaRecord } {
    return {
      type: EMessageType.text,
      content: {
        type: EMessageType.text,
        message: text,
        ...baseContent,
        official,
      },
      rawMessage: {
        conversation: text,
      },
    };
  }

  private async downloadAndUploadMedia(
    connection: IActiveWorkerWhatsappOfficialConnectionWithWorker,
    media: MetaRecord
  ): Promise<UploadFileResponse | null> {
    const mediaId = this.toNonEmptyString(media.id);
    if (!mediaId) {
      return null;
    }

    const cacheKey = `${this.mediaCachePrefix}:${connection.account_id}:${mediaId}`;
    const cached = await this.getCachedUpload(cacheKey);
    if (cached) {
      return cached;
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const mediaInfo = await this.metaWhatsappEmbeddedService.getMediaUrl({
      apiVersion: connection.api_version,
      accessToken,
      mediaId,
    });
    const downloaded: MetaWhatsappDownloadedMedia =
      await this.metaWhatsappEmbeddedService.downloadMedia({
        accessToken,
        url: mediaInfo.url,
        filename:
          this.toNonEmptyString(media.filename) ??
          this.toNonEmptyString(media.file_name) ??
          `${mediaId}`,
        mimetype: this.toNonEmptyString(media.mime_type) ?? mediaInfo.mime_type,
      });
    const uploaded = await this.storageService.uploadFromBuffer(
      downloaded.buffer,
      connection.account_id,
      {
        fileName: downloaded.filename,
        mimetype: downloaded.mimetype,
      }
    );

    if (uploaded) {
      await this.redis.set(
        cacheKey,
        JSON.stringify(uploaded),
        'EX',
        this.mediaCacheTtlSeconds
      );
    }

    return uploaded;
  }

  private async getCachedUpload(
    cacheKey: string
  ): Promise<UploadFileResponse | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as UploadFileResponse;
    } catch {
      return null;
    }
  }

  private statusToPatch(
    status: string | null | undefined
  ): MessageSummaryPatch | null {
    if (status === 'read') {
      return { is_seen: true };
    }

    if (status === 'delivered') {
      return { is_delivered: true };
    }

    if (status === 'sent') {
      return { is_sent: true };
    }

    return null;
  }

  private buildOfficialMetadata(
    context: IResolvedChangeContext,
    message: MetaRecord,
    metaType: string,
    options?: { echo?: boolean }
  ): IOfficialWhatsappContentMetadata {
    const contextRecord = this.toRecord(message.context);
    return {
      provider: 'meta_whatsapp',
      type: metaType,
      webhook_field: context.field,
      message_id: this.toNonEmptyString(message.id) ?? null,
      echo: options?.echo === true,
      referral: this.toRecord(contextRecord?.referral) ?? null,
      raw: message,
    };
  }

  private resolveInteractive(
    message: MetaRecord
  ): IOfficialWhatsappContentMetadata['interactive'] {
    const interactive = this.toRecord(message.interactive);
    if (!interactive) {
      return null;
    }

    const type = this.toNonEmptyString(interactive.type) ?? null;
    const reply =
      this.toRecord(interactive.list_reply) ??
      this.toRecord(interactive.button_reply) ??
      this.toRecord(interactive.nfm_reply);

    return {
      type,
      id: this.toNonEmptyString(reply?.id) ?? null,
      title:
        this.toNonEmptyString(reply?.title) ??
        this.toNonEmptyString(reply?.name) ??
        null,
      description:
        this.toNonEmptyString(reply?.description) ??
        this.toNonEmptyString(reply?.body) ??
        null,
    };
  }

  private resolveContextMessageId(message: MetaRecord): string | undefined {
    const context = this.toRecord(message.context);
    return this.toNonEmptyString(context?.id);
  }

  private resolveContextInfo(message: MetaRecord): MetaRecord | null {
    const context = this.toRecord(message.context);
    if (!context) {
      return null;
    }

    const result: MetaRecord = {};
    const referral = this.toRecord(context.referral);
    if (referral) {
      result.external_ad_reply = {
        title: this.toNonEmptyString(referral.headline) ?? null,
        source_url: this.toNonEmptyString(referral.source_url) ?? null,
        source_id: this.toNonEmptyString(referral.source_id) ?? null,
        source_type: this.toNonEmptyString(referral.source_type) ?? null,
        thumbnail_url: this.toNonEmptyString(referral.image_url) ?? null,
      };
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  private mapContacts(contacts: MetaRecord[]): IContactMessage[] {
    return contacts.map((contact) => {
      const name = this.toRecord(contact.name);
      const phones = this.toRecordArray(contact.phones);
      const emails = this.toRecordArray(contact.emails);
      const firstPhone = phones[0];
      const composedName = [name?.first_name, name?.last_name]
        .map((value) => this.toNonEmptyString(value))
        .filter(Boolean)
        .join(' ');
      const fullName =
        this.toNonEmptyString(name?.formatted_name) ??
        this.toNonEmptyString(composedName) ??
        this.toNonEmptyString(firstPhone?.phone) ??
        'Contato';

      return {
        contact_id: null,
        name: fullName,
        last_name: this.toNonEmptyString(name?.last_name) ?? null,
        phone:
          this.toNonEmptyString(firstPhone?.wa_id) ??
          this.toNonEmptyString(firstPhone?.phone) ??
          null,
        phone_ddi: null,
        email: this.toNonEmptyString(emails[0]?.email) ?? null,
        photo: null,
      };
    });
  }

  private resolveMessageRemotePhone(
    message: MetaRecord,
    value: IMetaWhatsappWebhookChangeValue,
    isEcho: boolean
  ): string | null {
    const from = this.toNonEmptyString(message.from);
    const to = this.toNonEmptyString(message.to);
    const contactPhone = this.resolveContactWaId(value, from ?? to ?? null);
    return isEcho
      ? (to ?? contactPhone ?? from ?? null)
      : (from ?? contactPhone);
  }

  private resolveContactName(
    value: IMetaWhatsappWebhookChangeValue,
    phone: string | null
  ): string | null {
    if (!phone) {
      return null;
    }

    const contact = this.findContact(value, phone);
    return (
      this.toNonEmptyString(this.toRecord(contact?.profile)?.name) ??
      this.toNonEmptyString(contact?.wa_id) ??
      null
    );
  }

  private resolveContactWaId(
    value: IMetaWhatsappWebhookChangeValue,
    phone: string | null
  ): string | null {
    if (!phone) {
      return null;
    }

    const contact = this.findContact(value, phone);
    return this.toNonEmptyString(contact?.wa_id) ?? null;
  }

  private findContact(
    value: IMetaWhatsappWebhookChangeValue,
    phone: string
  ): MetaRecord | null {
    const digits = this.onlyDigits(phone);
    return (
      value.contacts?.find((contact) => {
        const record = this.toRecord(contact);
        const waId = this.toNonEmptyString(record?.wa_id);
        return waId ? this.onlyDigits(waId) === digits : false;
      }) ?? null
    );
  }

  private isPartnerRemovedUpdate(
    value: IMetaWhatsappWebhookChangeValue
  ): boolean {
    const candidates = [
      value.event,
      value.event_type,
      value.status,
      value.reason,
      this.toRecord(value.update)?.event,
      this.toRecord(value.update)?.event_type,
    ];

    return candidates.some((candidate) =>
      this.toNonEmptyString(candidate)
        ?.toUpperCase()
        .includes('PARTNER_REMOVED')
    );
  }

  private async publishOfficialDisconnect(
    connection: IActiveWorkerWhatsappOfficialConnectionWithWorker
  ): Promise<void> {
    const payload: IBaileysConnectionState = {
      code: ECodeMessage.loggedOut,
      status: EBaileysConnectionStatus.disconnected,
      worker_id: connection.worker_id,
      worker_name: connection.worker_name,
      account_id: connection.account_id,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.offline,
      disconnected_user: true,
      session_ready: false,
      can_send: false,
      can_receive_runtime: false,
      authenticated: false,
      provider_state: 'disconnected',
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(connection.account_id),
      payload
    );
  }

  private isMediaType(type: string): boolean {
    return ['image', 'video', 'audio', 'document', 'sticker'].includes(type);
  }

  private metaMediaTypeToMessageType(type: string): EMessageType {
    if (type === 'image') return EMessageType.image;
    if (type === 'video') return EMessageType.video;
    if (type === 'audio') return EMessageType.audio;
    if (type === 'document') return EMessageType.document;
    return EMessageType.sticker;
  }

  private isEchoField(field: string): boolean {
    return field === 'message_echoes' || field === 'smb_message_echoes';
  }

  private syntheticMessageId(
    context: IResolvedChangeContext,
    message: MetaRecord
  ): string {
    const phone = this.resolveMessageRemotePhone(
      message,
      context.value,
      this.isEchoField(context.field)
    );
    const type = this.toNonEmptyString(message.type) ?? 'unknown';
    const timestamp = this.toNonEmptyString(message.timestamp) ?? Date.now();
    return `${context.field}:${phone ?? 'unknown'}:${type}:${timestamp}`;
  }

  private toTimestampSeconds(value: unknown): number {
    const raw = Number(value);
    if (Number.isFinite(raw) && raw > 0) {
      return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
    }

    return Math.floor(Date.now() / 1000);
  }

  private toRemoteJid(phone: string | null | undefined): string | null {
    const digits = this.onlyDigits(phone);
    return digits ? `${digits}@s.whatsapp.net` : null;
  }

  private onlyDigits(value: string | null | undefined): string {
    return value?.replace(/\D/gu, '') ?? '';
  }

  private toFiniteNumber(value: unknown): number | null {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private toRecord(value: unknown): MetaRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as MetaRecord)
      : null;
  }

  private toRecordArray(value: unknown): MetaRecord[] {
    return Array.isArray(value)
      ? value
          .map((item) => this.toRecord(item))
          .filter((item): item is MetaRecord => item !== null)
      : [];
  }

  private processedKey(accountId: string, kind: string, id: string): string {
    return `${this.processedPrefix}:${accountId}:${kind}:${id}`;
  }

  private async isProcessed(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  private async markProcessed(key: string): Promise<void> {
    try {
      await this.redis.set(key, '1', 'EX', this.processedTtlSeconds);
    } catch {}
  }

  private async parkInvalidMessage(message: KafkaRunnerMessage): Promise<void> {
    await this.inboundMessageSpoolService.parkConsumerMessage({
      provider: 'official_whatsapp',
      event_source: 'official_whatsapp_webhook',
      reason: 'invalid_payload',
      stage: 'parse',
      parked_at: new Date().toISOString(),
      kafka_topic: message.topic,
      partition: message.partition,
      offset: message.offset,
      raw_payload: message.value?.toString('utf8') ?? null,
    });
  }

  private async parkDiscardedMessage(
    payload: IMetaWhatsappWebhookEvent,
    context: KafkaConsumerRunnerContext<IMetaWhatsappWebhookEvent>,
    error: unknown,
    reason: string
  ): Promise<void> {
    await this.inboundMessageSpoolService.parkConsumerMessage({
      provider: 'official_whatsapp',
      event_source: 'official_whatsapp_webhook',
      reason,
      stage: 'consume',
      parked_at: new Date().toISOString(),
      kafka_topic: context.topic,
      kafka_key: context.kafkaKey,
      partition: context.partition,
      offset: context.offset,
      error: error instanceof Error ? error.message : String(error),
      raw_payload: JSON.stringify(payload),
    });
  }

  private async parkChange(input: {
    event: IMetaWhatsappWebhookEvent;
    context: KafkaConsumerRunnerContext<IMetaWhatsappWebhookEvent>;
    reason: string;
    field: string;
    accountId?: string;
    workerId?: string;
  }): Promise<void> {
    await this.inboundMessageSpoolService.parkConsumerMessage({
      provider: 'official_whatsapp',
      account_id: input.accountId,
      worker_id: input.workerId,
      event_source: 'official_whatsapp_webhook',
      reason: input.reason,
      stage: input.field,
      parked_at: new Date().toISOString(),
      kafka_topic: input.context.topic,
      kafka_key: input.context.kafkaKey,
      partition: input.context.partition,
      offset: input.context.offset,
      raw_payload: JSON.stringify(input.event),
    });
  }

  private async parkUnresolvedConnection(
    context: IResolvedChangeContext,
    reason: string
  ): Promise<void> {
    await this.inboundMessageSpoolService.parkConsumerMessage({
      provider: 'official_whatsapp',
      event_source: 'official_whatsapp_webhook',
      reason,
      stage: context.field,
      parked_at: new Date().toISOString(),
      worker_id: context.connection?.worker_id,
      account_id: context.connection?.account_id,
      raw_payload: JSON.stringify(context.event),
      raw_meta: {
        phone_number_id: context.phoneNumberId,
        entry_id: context.entryId,
      },
    });
  }
}
