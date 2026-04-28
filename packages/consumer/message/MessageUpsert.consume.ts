import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import {
  type IUpsertMessageEnvelope,
  type IUpsertMessageKey,
  IUpsertMessage,
} from '@core/common/interfaces/IUpsertMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { v7 as uuidv7 } from 'uuid';
import { createHash } from 'node:crypto';
import { AccountService } from '@core/services/account.service';
import { WorkerService } from '@core/services/worker.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatService } from '@core/services/chat.service';
import {
  IChatMessage,
  IContactMessage,
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
import { buildContextInfoFromMessage } from '@core/common/functions/buildContextInfoFromMessage';
import { unwrapMessage } from '@core/common/functions/unwrapMessage';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import Redis from 'ioredis';
import { EMessageType } from '@core/common/enums/EMessageType';
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
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { SectorService } from '@core/services/sector.service';
import { UserService } from '@core/services/user.service';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { withLock } from '@core/common/functions/withLock';
import { delay } from '@core/common/functions/delay';
import { extractReactionMessage } from '@core/common/functions/extractReactionMessage';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { isUuidLike } from '@core/common/functions/isUuidLike';
import { IMessageKeyIdContext } from '@core/common/interfaces/IMessageKeyIdContext';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import {
  isAttendanceHoursConfigEnabledValid,
  isNowWithinAttendanceHours,
  parseAttendanceHoursConfig,
} from '@core/common/functions/attendanceHoursConfig';
import { IAttendanceHoursConfig } from '@core/common/interfaces/IAttendanceHours';
import { getActiveChatbotWorkingHoursRule } from '@core/common/functions/chatbotWorkingHours';
import { generalEnvironment } from '@core/config/environments';
import { logger } from '@core/plugins/telemetry/logger';
import {
  incrementCounter,
  recordException,
} from '@core/plugins/telemetry/observability';
import { shouldResetAttendanceInactivityFromOperatorMessageType } from '@core/common/functions/attendanceInactivityInteraction';

type ReactionInactivityTypeUser = ETypeUserChat.operator | ETypeUserChat.client;

interface IReactionInactivityInteraction {
  actorTypeUser: ReactionInactivityTypeUser;
  targetTypeUser: ReactionInactivityTypeUser;
}

interface IReactionHandleResult {
  handled: boolean;
  inactivityInteraction: IReactionInactivityInteraction | null;
}

interface ICreateChatMessageResult {
  handled: boolean;
  reactionInactivityInteraction: IReactionInactivityInteraction | null;
}

function isReactionInactivityTypeUser(
  typeUser: ETypeUserChat
): typeUser is ReactionInactivityTypeUser {
  return (
    typeUser === ETypeUserChat.operator || typeUser === ETypeUserChat.client
  );
}

@singleton()
export class MessageUpsertConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [100, 500, 2000];
  private readonly MESSAGE_PROCESSING_TIMEOUT_MS = 120000;
  private readonly MAX_CONSECUTIVE_FAILURES = 10;
  private readonly OUTSIDE_HOURS_DEBOUNCE_SECONDS = 5;
  private readonly OUTSIDE_HOURS_DEFAULT_MESSAGE =
    'Olá {{ name }}, nosso horário de atendimento está encerrado no momento. Retornaremos assim que estivermos disponíveis.';
  private readonly AUTOMATION_SEND_DEDUPE_PREFIX =
    'automation-send:idempotency:v1';
  private readonly AUTOMATION_SEND_DEDUPE_TTL_SECONDS =
    generalEnvironment.automationSendDedupeTtlSeconds;

  private static readonly PROTOCOL_MESSAGE_TYPE_EPHEMERAL_SETTING = 3;
  private static readonly PROTOCOL_MESSAGE_TYPE_EPHEMERAL_SYNC_RESPONSE = 4;
  private partitionFailureCounts: Map<number, number> = new Map();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(PushNotificationService)
    private readonly pushNotificationService: PushNotificationService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(UserService)
    private readonly userService: UserService
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

  private incrementPartitionFailure(partition: number): void {
    const current = this.partitionFailureCounts.get(partition) ?? 0;
    this.partitionFailureCounts.set(partition, current + 1);
  }

  private async sendToDlq(
    data: IUpsertMessage,
    error: unknown,
    retryCount: number
  ): Promise<boolean> {
    const maxDlqRetries = 5;
    const dlqTopic = this.kafkaServiceQueueService.upsertMessageDlq();

    for (let attempt = 0; attempt < maxDlqRetries; attempt++) {
      try {
        await this.streamProducerService.send(dlqTopic, {
          ...data,
          dlq_error: error instanceof Error ? error.message : String(error),
          dlq_stack: error instanceof Error ? error.stack : undefined,
          dlq_timestamp: new Date().toISOString(),
          dlq_retry_count: retryCount,
          dlq_pod: process.env.HOSTNAME || 'unknown',
        });
        return true;
      } catch (dlqError) {
        console.error(
          `[DLQ] Attempt ${attempt + 1}/${maxDlqRetries} failed:`,
          dlqError
        );
        if (attempt < maxDlqRetries - 1) {
          await delay(Math.min(100 * Math.pow(2, attempt), 2000));
        }
      }
    }

    console.error(
      '[DLQ] CRITICAL: Failed to send to DLQ after all retries. Message data:',
      JSON.stringify({
        account_id: data.account_id,
        worker_id: data.worker_id,
        message_key_id: data.message?.key?.id,
      })
    );
    return false;
  }

  private async processWithRetry(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    phone: string
  ): Promise<void> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await this.createOrUpdateChat(t, data, phone);
        return;
      } catch (error) {
        lastError = error;
        const isLastAttempt = attempt === this.MAX_RETRIES - 1;
        const isReadOnlyAllowDeleteError =
          this.elasticDatabaseService.isReadOnlyAllowDeleteBlockError(error);

        console.error(
          `[MessageUpsert] Attempt ${attempt + 1}/${this.MAX_RETRIES} failed for message ${data.message?.key?.id}:`,
          error instanceof Error ? error.message : error
        );

        if (isReadOnlyAllowDeleteError) {
          logger.error({
            type: 'message_upsert_elastic_read_only_allow_delete',
            message:
              'Elasticsearch flood-stage read-only block detected while processing upsert. Skipping retry and DLQ.',
            account_id: data.account_id,
            worker_id: data.worker_id,
            message_key_id: data.message?.key?.id,
            attempt: attempt + 1,
          });
          incrementCounter('message_upsert_elastic_read_only_allow_delete');
          throw error instanceof Error ? error : new Error(String(error));
        }

        if (!isLastAttempt) {
          const delayMs = this.RETRY_DELAYS[attempt] ?? 1000;
          await delay(delayMs);
        }
      }
    }

    logger.error({
      type: 'message_upsert_retry_exhausted_no_commit',
      message:
        'Message upsert retries exhausted. Offset will not be committed; message remains eligible for retry.',
      account_id: data.account_id,
      worker_id: data.worker_id,
      message_key_id: data.message?.key?.id,
      retry_count: this.MAX_RETRIES,
      error: lastError instanceof Error ? lastError.message : lastError,
    });
    incrementCounter('message_upsert_retry_exhausted_no_commit');

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to process message: ${data.message?.key?.id}`);
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
    const accountChannel = chatAccountCentrifugo(dataPublish.account.id);
    const queueChannel = chatQueueAccountCentrifugo(dataPublish.account.id);

    return Promise.allSettled([
      this.centrifugoService.publishSub(accountChannel, dataPublish),
      this.centrifugoService.publishSub(queueChannel, dataPublish),
    ]).then(([accountResult, queueResult]) => {
      if (accountResult.status === 'rejected') {
        logger.error({
          type: 'centrifugo_queue_publish_account_channel_failed',
          message: 'Failed to publish to account channel in queue publish',
          channel: accountChannel,
          error:
            accountResult.reason instanceof Error
              ? accountResult.reason.message
              : accountResult.reason,
        });
        incrementCounter('centrifugo_account_publish_failed');
      }

      if (queueResult.status === 'rejected') {
        throw queueResult.reason;
      }

      return queueResult.value;
    });
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
      const shouldDiscardEmptyText = this.shouldDiscardEmptyText(data);
      const shouldSkipMessageCreation =
        shouldDiscardEmptyText &&
        ((data.webhook_message_type === 'chatbot' && data.webhook_chatbot_id) ||
          data.webhook_message_type === 'message');

      if (!shouldSkipMessageCreation) {
        await this.createChatMessage(chat, data);
      }

      return chat;
    }

    const initialStatus =
      data.webhook_message_type === 'chatbot' && data.webhook_chatbot_id
        ? EChatStatus.ura_webhook
        : EChatStatus.ura;

    const newChat = await this.createChat(data, initialStatus);
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

    const shouldDiscardEmptyText = this.shouldDiscardEmptyText(data);
    const shouldSkipMessageCreation =
      shouldDiscardEmptyText &&
      ((data.webhook_message_type === 'chatbot' && data.webhook_chatbot_id) ||
        data.webhook_message_type === 'message');

    if (shouldSkipMessageCreation) {
      await this.saveChatWithCaches(newChat);
      await this.centrifugoChatQueuePublish(newChat);
      return newChat;
    }

    await this.handleNewChatMessageAndPublish(newChat, data);

    return newChat;
  }

  private async markIncomingMessageAsRead(
    accountId: string,
    workerId: string,
    key: IUpsertMessageKey
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

  private async shouldMarkAsRead(workerId: string): Promise<boolean> {
    const cacheKey = `worker:${workerId}:mark_as_read`;
    const cached = await this.redis.get(cacheKey);

    if (cached !== null) {
      return cached === 'true';
    }

    const config = await this.workerConfigService.viewWorkerConfig(workerId);
    const value = config?.mark_as_read ?? false;

    await this.redis.set(cacheKey, String(value), 'EX', 60 * 60 * 24);

    return value;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private toRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private firstStringField(
    record: Record<string, unknown> | undefined,
    keys: string[]
  ): string | undefined {
    if (!record) return undefined;
    for (const key of keys) {
      const value = this.toNonEmptyString(record[key]);
      if (value) return value;
    }
    return undefined;
  }

  private getProtocolMessagePayload(
    data: IUpsertMessage
  ): Record<string, unknown> | undefined {
    const baseMessage = this.getBaseMessage(data);
    const rawMessage = this.toRecord(baseMessage?.message);
    const editedWrapper =
      this.toRecord(rawMessage?.editedMessage) ?? rawMessage;

    return (
      this.toRecord(editedWrapper?.message) ??
      this.toRecord(editedWrapper?.protocolMessage)
    );
  }

  private isSystemMessageJid(value: string): boolean {
    const raw = this.toNonEmptyString(value)?.toLowerCase();
    if (!raw) {
      return false;
    }

    const normalized = (normalizeJid(raw) ?? raw).toLowerCase();
    if (normalized === '0@c.us' || normalized === '0@s.whatsapp.net') {
      return true;
    }

    const [user, domain] = normalized.split('@');
    if (!user || !domain) {
      return false;
    }

    return user === '0' && (domain === 'c.us' || domain === 's.whatsapp.net');
  }

  private normalizeReactionActorId(value: unknown): string | undefined {
    const normalized = this.toNonEmptyString(value);
    if (!normalized) {
      return undefined;
    }

    return normalizeJid(normalized) ?? normalized;
  }

  private isUuidLike(value: string | undefined): boolean {
    return isUuidLike(value);
  }

  private isPhoneLikeName(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;

    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 8) return false;

    const nonPhoneChars = normalized.replace(/[0-9+\-().\s]/g, '');
    return nonPhoneChars.length === 0;
  }

  private isJidLikeName(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;

    const jidSuffixes = [
      '@s.whatsapp.net',
      '@c.us',
      '@lid',
      '@g.us',
      '@broadcast',
      '@newsletter',
    ];

    return jidSuffixes.some((suffix) => normalized.endsWith(suffix));
  }

  private normalizeChatNameCandidate(value: unknown): string | null {
    const name = this.toNonEmptyString(value);
    if (!name) return null;
    if (this.isPhoneLikeName(name)) return null;
    return name;
  }

  private normalizeComparableName(
    value: string | null | undefined
  ): string | null {
    const normalized = this.toNonEmptyString(value);
    if (!normalized) return null;
    return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private isLikelyOwnAccountName(
    candidateName: string | null | undefined,
    accountName: string | null | undefined
  ): boolean {
    const candidate = this.normalizeComparableName(candidateName);
    const account = this.normalizeComparableName(accountName);
    if (!candidate || !account) return false;
    return candidate === account;
  }

  private parseNumericStatusCandidate(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private getOutgoingStatusOrAck(data: IUpsertMessage): number | null {
    const envelope = data.message as
      | (IUpsertMessageEnvelope & {
          ack?: unknown;
          status?: unknown;
          _data?: { ack?: unknown; status?: unknown };
        })
      | undefined;
    if (!envelope) {
      return null;
    }

    const candidates: unknown[] = [
      envelope.ack,
      envelope.status,
      envelope._data?.ack,
      envelope._data?.status,
    ];

    for (const candidate of candidates) {
      const parsed = this.parseNumericStatusCandidate(candidate);
      if (parsed !== null) {
        return parsed;
      }
    }

    return null;
  }

  private buildOutgoingSummary(data: IUpsertMessage): IChatMessage['summary'] {
    const statusOrAck = this.getOutgoingStatusOrAck(data);
    const isSeen = statusOrAck !== null && statusOrAck >= 3;

    return {
      is_sent: true,
      is_delivered: true,
      is_seen: isSeen,
      is_sent_to_internal: true,
    };
  }

  private collectRemoteIdCandidatesFromKey(
    keyContext?: IMessageKeyIdContext
  ): string[] {
    if (!keyContext) return [];

    const rawCandidates = [
      keyContext.remoteJid,
      keyContext.remoteJidAlt,
      keyContext.participant,
      keyContext.participantAlt,
      keyContext.remote_jid,
      keyContext.remote_jid_alt,
      keyContext.participant_alt,
    ];

    const candidates = new Set<string>();

    for (const candidate of rawCandidates) {
      const raw = this.toNonEmptyString(candidate);
      if (!raw) continue;

      candidates.add(raw);

      const normalized = normalizeJid(raw) ?? raw;
      candidates.add(normalized);

      if (normalized.endsWith('@s.whatsapp.net')) {
        candidates.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
      }

      if (normalized.endsWith('@c.us')) {
        candidates.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
      }
    }

    return Array.from(candidates);
  }

  private collectFromMeCandidatesFromKey(
    keyContext?: IMessageKeyIdContext
  ): boolean[] {
    if (!keyContext) {
      return [false, true];
    }

    const fromMe = keyContext.fromMe ?? keyContext.from_me;
    if (typeof fromMe === 'boolean') {
      return [fromMe];
    }

    return [false, true];
  }

  private buildMessageKeyIdCandidates(
    messageId: string,
    keyContext?: IMessageKeyIdContext
  ): string[] {
    const normalizedId = this.toNonEmptyString(messageId);
    if (!normalizedId) {
      return [];
    }

    const candidates = new Set<string>([normalizedId]);
    const parsed = parseSerializedMessageId(normalizedId);
    const stanzaId = parsed?.stanzaId ?? normalizedId;

    candidates.add(stanzaId);

    const remoteCandidates = new Set<string>([
      ...this.collectRemoteIdCandidatesFromKey(keyContext),
      ...(parsed?.remoteJid ? [parsed.remoteJid] : []),
    ]);

    const fromMeCandidates = this.collectFromMeCandidatesFromKey(keyContext);
    if (parsed && !fromMeCandidates.includes(parsed.fromMe)) {
      fromMeCandidates.push(parsed.fromMe);
    }

    for (const remoteCandidate of remoteCandidates) {
      for (const fromMe of fromMeCandidates) {
        candidates.add(`${fromMe}_${remoteCandidate}_${stanzaId}`);
      }
    }

    return Array.from(candidates);
  }

  private buildAlbumIdCandidates(
    messageId: string,
    ...keyContexts: Array<IMessageKeyIdContext | undefined>
  ): string[] {
    const candidates = new Set<string>();
    const normalizedId = this.toNonEmptyString(messageId);
    if (!normalizedId) return [];

    candidates.add(normalizedId);

    const parsed = parseSerializedMessageId(normalizedId);
    if (parsed?.stanzaId) {
      candidates.add(parsed.stanzaId);
    }

    for (const keyContext of keyContexts) {
      for (const candidate of this.buildMessageKeyIdCandidates(
        normalizedId,
        keyContext
      )) {
        candidates.add(candidate);
      }
    }

    return Array.from(candidates);
  }

  private async findMessageByKeyId(
    accountId: string,
    chatId: string,
    messageId: string,
    keyContext?: IMessageKeyIdContext
  ): Promise<IChatMessage | null> {
    if (!messageId) return null;

    const keyIdCandidates = this.buildMessageKeyIdCandidates(
      messageId,
      keyContext
    );
    if (!keyIdCandidates.length) {
      return null;
    }

    const must: Array<Record<string, unknown>> = [
      {
        term: { chat_id: chatId },
      },
      {
        nested: {
          path: 'message_key',
          query: {
            bool: {
              should: keyIdCandidates.map((candidate) => ({
                term: { 'message_key.id': candidate },
              })),
              minimum_should_match: 1,
            },
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

  private albumItemIndex(message: IChatMessage): number | null {
    const value: unknown = message.content?.album?.item_index;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private messageDateMillis(message: IChatMessage): number {
    const parsed = new Date(message.date).getTime();
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  private sortAlbumMessagesForGalleryHead(
    messages: IChatMessage[]
  ): IChatMessage[] {
    return [...messages].sort((a, b) => {
      const aIndex = this.albumItemIndex(a);
      const bIndex = this.albumItemIndex(b);

      if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      if (aIndex !== null && bIndex === null) return -1;
      if (aIndex === null && bIndex !== null) return 1;

      const dateDiff = this.messageDateMillis(a) - this.messageDateMillis(b);
      if (dateDiff !== 0) return dateDiff;

      return String(a.message_id ?? '').localeCompare(
        String(b.message_id ?? '')
      );
    });
  }

  private async findAlbumHeadMessageByAlbumId(
    accountId: string,
    chatId: string,
    albumId: string,
    ...keyContexts: Array<IMessageKeyIdContext | undefined>
  ): Promise<IChatMessage | null> {
    const albumIdCandidates = this.buildAlbumIdCandidates(
      albumId,
      ...keyContexts
    );
    if (!albumIdCandidates.length) {
      return null;
    }

    const must: Array<Record<string, unknown>> = [
      {
        term: { chat_id: chatId },
      },
      {
        nested: {
          path: 'content.album',
          query: {
            bool: {
              should: [
                { terms: { 'content.album.id': albumIdCandidates } },
                {
                  terms: {
                    'content.album.parent_message_id': albumIdCandidates,
                  },
                },
              ],
              minimum_should_match: 1,
            },
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
      size: 50,
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

    const messages = result.hits.hits
      .map((hit) => hit._source as IChatMessage | undefined)
      .filter((message): message is IChatMessage => Boolean(message));

    return this.sortAlbumMessagesForGalleryHead(messages)[0] ?? null;
  }

  private async findMessageByKeyIdInAccount(
    accountId: string,
    messageId: string,
    keyContext?: IMessageKeyIdContext
  ): Promise<IChatMessage | null> {
    if (!accountId || !messageId) {
      return null;
    }

    const keyIdCandidates = this.buildMessageKeyIdCandidates(
      messageId,
      keyContext
    );
    if (!keyIdCandidates.length) {
      return null;
    }

    const queryElastic = {
      size: 1,
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
                path: 'message_key',
                query: {
                  bool: {
                    should: keyIdCandidates.map((candidate) => ({
                      term: { 'message_key.id': candidate },
                    })),
                    minimum_should_match: 1,
                  },
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

    if (!result || result.hits.hits.length === 0) {
      return null;
    }

    return result.hits.hits[0]._source as IChatMessage;
  }

  private async handleReactionMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<IReactionHandleResult | null> {
    if (data.type !== EMessageType.react) {
      return null;
    }

    const reactionMsg = extractReactionMessage(
      data.message?.message as Parameters<typeof extractReactionMessage>[0]
    );
    if (!reactionMsg?.key?.id) {
      return null;
    }

    const targetMessageId = reactionMsg.key.id;

    let targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId,
      data.message?.key
    );

    if (!targetMessage) {
      targetMessage = await this.findAlbumHeadMessageByAlbumId(
        data.account_id,
        getChat.chat_id,
        targetMessageId,
        reactionMsg.key as IMessageKeyIdContext,
        data.message?.key
      );
    }

    if (!targetMessage) {
      return {
        handled: true,
        inactivityInteraction: null,
      };
    }

    const isFromMe = data.message?.key?.fromMe === true;
    const actorParticipant = this.normalizeReactionActorId(
      data.message?.key?.participant ?? data.message?.key?.participantAlt
    );
    const actorRemote = this.normalizeReactionActorId(
      data.message?.key?.remoteJid ?? data.message?.key?.remoteJidAlt
    );

    // For fromMe reactions, prefer JID/LID from the message key over UUID
    const canonicalUserId = isFromMe
      ? (actorParticipant ??
        actorRemote ??
        this.toNonEmptyString(getChat.worker?.id) ??
        this.toNonEmptyString(getChat.user?.id) ??
        '')
      : (actorParticipant ?? actorRemote ?? '');
    const canonicalUserIdNormalized =
      this.normalizeReactionActorId(canonicalUserId) ?? canonicalUserId;

    // Detect if a non-fromMe reaction is actually from the operator.
    // In 1:1 chats, if the actor JID does not match the contact JID,
    // then the reaction belongs to the operator (fromMe was mis-detected).
    const chatContactJid = this.normalizeReactionActorId(
      getChat.message_key?.remote_jid
    );
    const chatContactJidAlt = this.normalizeReactionActorId(
      getChat.message_key?.remote_jid_alt
    );
    const isEffectivelyOwn =
      isFromMe ||
      (!!canonicalUserIdNormalized &&
        !!chatContactJid &&
        canonicalUserIdNormalized !== chatContactJid &&
        (!chatContactJidAlt ||
          canonicalUserIdNormalized !== chatContactJidAlt));
    const actorTypeUser: ReactionInactivityTypeUser = isEffectivelyOwn
      ? ETypeUserChat.operator
      : ETypeUserChat.client;
    const targetTypeUser = targetMessage.type_user;

    const canonicalUserName = isEffectivelyOwn
      ? (this.toNonEmptyString(getChat.worker?.name) ??
        this.toNonEmptyString(getChat.user?.name) ??
        '')
      : (this.toNonEmptyString(getChat.contact?.name) ?? '');
    const emoji = reactionMsg.text ?? '';

    const existingReactions = targetMessage.content?.reactions || [];
    const legacyOwnIds = new Set<string>();
    for (const legacyCandidate of [
      this.toNonEmptyString(getChat.user?.id),
      this.toNonEmptyString(getChat.worker?.id),
      this.toNonEmptyString(canonicalUserId),
    ]) {
      if (legacyCandidate) {
        legacyOwnIds.add(legacyCandidate);
      }
    }

    const legacyOwnIdsNormalized = new Set<string>();
    for (const legacyId of legacyOwnIds) {
      legacyOwnIdsNormalized.add(
        this.normalizeReactionActorId(legacyId) ?? legacyId
      );
    }

    const reactionsWithoutUser = existingReactions.filter((reaction) => {
      const reactionUserId = this.toNonEmptyString(reaction.user_id);
      const reactionUserIdNormalized =
        this.normalizeReactionActorId(reactionUserId) ?? reactionUserId ?? '';

      if (!reactionUserId && !canonicalUserId) {
        return true;
      }

      if (isEffectivelyOwn) {
        const isCanonicalOwn =
          (reactionUserId && reactionUserId === canonicalUserId) ||
          reactionUserIdNormalized === canonicalUserIdNormalized;
        const isLegacyOwn =
          (reactionUserId && legacyOwnIds.has(reactionUserId)) ||
          legacyOwnIdsNormalized.has(reactionUserIdNormalized);
        const isLegacyUuid = isUuidLike(reactionUserId);

        return !(isCanonicalOwn || isLegacyOwn || isLegacyUuid);
      }

      if (!canonicalUserIdNormalized) {
        return true;
      }

      return reactionUserIdNormalized !== canonicalUserIdNormalized;
    });

    let updatedReactions = reactionsWithoutUser;
    if (emoji) {
      updatedReactions = [
        ...reactionsWithoutUser,
        {
          emoji,
          user_id: canonicalUserId,
          user_name: canonicalUserName,
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

    await Promise.allSettled([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    const inactivityInteraction =
      isReactionInactivityTypeUser(targetTypeUser) &&
      actorTypeUser !== targetTypeUser
        ? {
            actorTypeUser,
            targetTypeUser,
          }
        : null;

    return {
      handled: true,
      inactivityInteraction,
    };
  }

  private async handleEditMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean | null> {
    if (data.type !== EMessageType.edit_text) return null;

    const protocolMessage = this.getProtocolMessagePayload(data);
    const protocolKey = this.toRecord(protocolMessage?.key);
    const targetMessageId = this.firstStringField(protocolKey, ['id', 'ID']);
    const editedContent = this.toRecord(protocolMessage?.editedMessage);

    if (!targetMessageId || !editedContent) {
      logger.warn(
        {
          component: 'message_upsert_consume',
          event: 'edit_message_skipped',
          reason: !targetMessageId
            ? 'missing_target_message_id'
            : 'missing_edited_content',
          account_id: data.account_id,
          chat_id: getChat.chat_id,
          worker_id: data.worker_id,
          event_message_id: data.message?.key?.id,
          protocol_key: protocolKey,
        },
        'Message edit skipped'
      );
      return true;
    }

    let targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId,
      data.message?.key
    );

    if (!targetMessage) {
      const isWwebjsSerializedId = /^(true|false)_.+@.+_.+$/.test(
        targetMessageId
      );

      if (isWwebjsSerializedId) {
        targetMessage = await this.findMessageByKeyIdInAccount(
          data.account_id,
          targetMessageId,
          data.message?.key
        );
      }
    }

    if (!targetMessage?.content) {
      logger.warn(
        {
          component: 'message_upsert_consume',
          event: 'edit_message_skipped',
          reason: 'target_message_not_found',
          account_id: data.account_id,
          chat_id: getChat.chat_id,
          worker_id: data.worker_id,
          target_message_id: targetMessageId,
          event_message_id: data.message?.key?.id,
        },
        'Message edit skipped'
      );
      return true;
    }

    const extText = this.toRecord(editedContent.extendedTextMessage);
    const newText =
      this.firstStringField(editedContent, ['conversation']) ??
      this.firstStringField(extText, ['text']) ??
      '';

    if (!newText) {
      logger.warn(
        {
          component: 'message_upsert_consume',
          event: 'edit_message_skipped',
          reason: 'empty_edited_text',
          account_id: data.account_id,
          chat_id: getChat.chat_id,
          worker_id: data.worker_id,
          target_message_id: targetMessageId,
          event_message_id: data.message?.key?.id,
        },
        'Message edit skipped'
      );
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

    await Promise.allSettled([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async handleDeleteMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<boolean | null> {
    const protocolMessage = this.getProtocolMessagePayload(data);
    const protocolKey = this.toRecord(protocolMessage?.key);
    const targetMessageId = this.firstStringField(protocolKey, ['id', 'ID']);
    if (data.type !== EMessageType.delete_message || !targetMessageId) {
      return null;
    }

    const targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId,
      data.message?.key
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

    await Promise.allSettled([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);

    return true;
  }

  private async handlePinMessage(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (data.type !== EMessageType.system) {
      return;
    }

    const rawMsg = this.getBaseMessage(data)?.message as
      | Record<string, unknown>
      | undefined;
    const pinMessage = rawMsg?.pinInChatMessage as
      | { key?: { id?: string }; type?: unknown }
      | undefined;
    const targetMessageId = pinMessage?.key?.id;
    if (!targetMessageId) {
      return;
    }
    const targetMessage = await this.findMessageByKeyId(
      data.account_id,
      getChat.chat_id,
      targetMessageId,
      data.message?.key
    );

    if (!targetMessage) {
      return;
    }

    const jid = remoteJid(data.message?.key);
    const jidAlt = remoteJidAlt(data.message?.key);
    const phone = getPhoneFromJid(jid, jidAlt);
    const pushName = data.message?.pushName;
    const pinType = pinMessage.type;

    let formattedPhone: string | null = null;
    if (phone) {
      const phoneWithPlus = `+${phone}`;
      const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);
      formattedPhone = phoneAndDdi
        ? `${phoneAndDdi.phone_ddi} ${phoneAndDdi.phone}`
        : phone;
    }

    const isUnpin =
      pinType === 2 ||
      pinType === '2' ||
      pinType === 'UNPIN_FOR_ALL' ||
      pinType === 'UNPIN';

    const pinData = isUnpin
      ? null
      : {
          pin_action: pinType ? String(pinType) : null,
          pin_user_name: pushName ?? null,
          pin_user_phone: formattedPhone,
        };

    const updatedContent: IContent = {
      ...targetMessage.content,
      type: targetMessage.content?.type ?? EMessageType.text,
      pin: pinData,
    };

    const updatedMessage: IChatMessage = {
      ...targetMessage,
      content: updatedContent,
      has_quoted: targetMessage.has_quoted,
    };

    await Promise.allSettled([
      this.chatService.updateMessageChat(updatedMessage),
      this.centrifugoChatPublish(updatedMessage),
    ]);
  }

  private buildTypeUserAndSummary(
    messageType: EMessageType,
    isFromMe: boolean,
    data: IUpsertMessage
  ): {
    typeUser: ETypeUserChat;
    summary: IChatMessage['summary'];
  } {
    if (
      messageType === EMessageType.system ||
      messageType === EMessageType.set_disappearing_messages
    ) {
      return {
        typeUser: ETypeUserChat.system,
        summary: {
          is_sent: true,
          is_delivered: true,
          is_seen: true,
          is_sent_to_internal: true,
        },
      };
    }

    if (isFromMe) {
      return {
        typeUser: ETypeUserChat.operator,
        summary: this.buildOutgoingSummary(data),
      };
    }

    return {
      typeUser: ETypeUserChat.client,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
    };
  }

  private shouldResetOperatorAttendanceInactivity(
    messageType: EMessageType,
    shouldSkipMessageCreation: boolean
  ): boolean {
    if (shouldSkipMessageCreation) {
      return false;
    }

    if (messageType === EMessageType.react) {
      return false;
    }

    return shouldResetAttendanceInactivityFromOperatorMessageType(messageType);
  }

  private async updateChatPhotoIfNeeded(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (!data.photo) return;

    const needsPhotoUpdate = true;
    const needsContactPhotoUpdate = Boolean(getChat.contact);

    if (!needsPhotoUpdate && !needsContactPhotoUpdate) return;

    try {
      const photoResult = await this.storageService.uploadFromUrl(
        data.photo,
        data.account_id,
        getChat.chat_id
      );

      if (!photoResult?.url) return;

      const previousChatPhoto = getChat.photo;
      if (previousChatPhoto && previousChatPhoto !== photoResult.url) {
        await this.storageService
          .deleteImage(previousChatPhoto)
          .catch(() => {});
      }

      getChat.photo = photoResult.url;

      if (needsContactPhotoUpdate && getChat.contact?.id) {
        const previousContactPhoto = getChat.contact.photo ?? null;
        if (previousContactPhoto && previousContactPhoto !== photoResult.url) {
          await this.storageService
            .deleteImage(previousContactPhoto)
            .catch(() => {});
        }

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

      const updateData: Partial<IChat> = {
        photo: photoResult.url,
      };

      if (getChat.contact) {
        updateData.contact = getChat.contact;
      }

      await this.chatService.saveChat({
        ...getChat,
        ...updateData,
      });
    } catch (error) {
      console.error(
        `[MessageUpsert] Failed to update chat photo for chat ${getChat.chat_id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  private async updateChatNameIfNeeded(
    getChat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (getChat?.name) {
      return;
    }

    const contactName = this.normalizeChatNameCandidate(getChat?.contact?.name);
    const messageNameRaw = this.nameChat(data);
    const messageName = this.isLikelyOwnAccountName(
      messageNameRaw,
      getChat?.account?.name
    )
      ? null
      : messageNameRaw;
    const name = contactName ?? messageName;
    if (!name) {
      return;
    }

    try {
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
    } catch (error) {
      console.error(
        `[MessageUpsert] Failed to update chat name for chat ${getChat.chat_id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  private async handleMediaMessages(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    const mediaPromises: Promise<void>[] = [];

    if (content.type === EMessageType.image) {
      mediaPromises.push(this.handleImageMessage(content, data));
    }

    if (content.type === EMessageType.video) {
      mediaPromises.push(this.handleVideoMessage(content, data));
    }

    if (content.type === EMessageType.video_note) {
      mediaPromises.push(this.handleVideoMessage(content, data));
    }

    if (content.type === EMessageType.audio) {
      mediaPromises.push(this.handleAudioMessage(content, data));
    }

    if (content.type === EMessageType.document) {
      mediaPromises.push(this.handleDocumentMessage(content, data));
    }

    if (content.type === EMessageType.sticker) {
      mediaPromises.push(this.handleStickerMessage(content, data));
    }

    await Promise.allSettled(mediaPromises);
  }

  private getDocumentMessage(
    data: IUpsertMessage
  ): Record<string, unknown> | null {
    const msg = this.getInnerMessage(data);
    if (!msg) return null;

    if ((msg as Record<string, unknown>).documentMessage) {
      return (msg as Record<string, unknown>).documentMessage as Record<
        string,
        unknown
      >;
    }

    const withCaption = (msg as Record<string, unknown>)
      .documentWithCaptionMessage as Record<string, unknown> | undefined;
    const doc = withCaption?.message as Record<string, unknown> | undefined;
    const documentMessage = doc?.documentMessage;
    if (documentMessage) {
      return documentMessage as Record<string, unknown>;
    }

    return null;
  }

  private getImageMessage(
    data: IUpsertMessage
  ): Record<string, unknown> | null {
    const msg = this.getInnerMessage(data);
    if (!msg) return null;

    if ((msg as Record<string, unknown>).imageMessage) {
      return (msg as Record<string, unknown>).imageMessage as Record<
        string,
        unknown
      >;
    }

    const withCaption = (msg as Record<string, unknown>)
      .imageWithCaptionMessage as Record<string, unknown> | undefined;
    const inner = withCaption?.message as Record<string, unknown> | undefined;
    const imageMessage = inner?.imageMessage;
    if (imageMessage) {
      return imageMessage as Record<string, unknown>;
    }

    return null;
  }

  private getVideoMessage(
    data: IUpsertMessage
  ): Record<string, unknown> | null {
    const msg = this.getInnerMessage(data) as
      | Record<string, unknown>
      | undefined;
    if (!msg) return null;

    const ptv = msg.ptvMessage;
    if (ptv && (ptv as Record<string, unknown>).url) {
      return ptv as Record<string, unknown>;
    }

    if ((msg.videoMessage as Record<string, unknown> | undefined)?.url) {
      return msg.videoMessage as Record<string, unknown>;
    }

    const withCaption = msg.videoWithCaptionMessage as
      | Record<string, unknown>
      | undefined;
    const inner = withCaption?.message as Record<string, unknown> | undefined;
    const videoMessage = inner?.videoMessage;
    if (videoMessage) {
      return videoMessage as Record<string, unknown>;
    }

    return null;
  }

  private async handleImageMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (content.type !== EMessageType.image) {
      return;
    }

    if (data.content?.image) {
      if (this.hasMediaUrl(data.content.image)) {
        content.image = data.content.image;
      } else {
        content.media_download_failed = true;
      }
      return;
    }

    if (content.image) {
      if (!this.hasMediaUrl(content.image)) {
        content.media_download_failed = true;
      }
      return;
    }

    const imageMsg = this.getImageMessage(data);
    if (!imageMsg) {
      return;
    }

    content.media_download_failed = true;
  }

  private async handleVideoMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.video &&
      content.type !== EMessageType.video_note
    ) {
      return;
    }

    if (data.content?.video) {
      if (this.hasMediaUrl(data.content.video)) {
        content.video = data.content.video;
      } else {
        content.media_download_failed = true;
      }
      return;
    }

    if (content.video) {
      if (!this.hasMediaUrl(content.video)) {
        content.media_download_failed = true;
      }
      return;
    }

    const videoMsg = this.getVideoMessage(data);
    if (!videoMsg) {
      return;
    }

    content.media_download_failed = true;
  }

  private async handleAudioMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (content.type !== EMessageType.audio) {
      return;
    }

    if (data.content?.audio) {
      if (this.hasMediaUrl(data.content.audio)) {
        content.audio = data.content.audio;
      } else {
        content.media_download_failed = true;
      }
      return;
    }

    if (content.audio) {
      if (!this.hasMediaUrl(content.audio)) {
        content.media_download_failed = true;
      }
      return;
    }

    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    if (!msg?.audioMessage) {
      return;
    }

    content.media_download_failed = true;
  }

  private async handleDocumentMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (content.type !== EMessageType.document) {
      return;
    }

    if (data.content?.document) {
      if (this.hasMediaUrl(data.content.document)) {
        content.document = data.content.document;
      } else {
        content.media_download_failed = true;
      }
      return;
    }

    if (content.document) {
      if (!this.hasMediaUrl(content.document)) {
        content.media_download_failed = true;
      }
      return;
    }

    const documentMsg = this.getDocumentMessage(data);
    if (!documentMsg) {
      return;
    }

    content.media_download_failed = true;
  }

  private async handleStickerMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (content.type !== EMessageType.sticker) {
      return;
    }

    if (data.content?.sticker) {
      if (this.hasMediaUrl(data.content.sticker)) {
        content.sticker = data.content.sticker;
      } else {
        content.media_download_failed = true;
      }
      return;
    }

    if (content.sticker) {
      if (!this.hasMediaUrl(content.sticker)) {
        content.media_download_failed = true;
      }
      return;
    }

    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    if (!msg?.stickerMessage) {
      return;
    }

    content.media_download_failed = true;
  }

  private hasMediaUrl(media?: { url?: string | null } | null): boolean {
    return typeof media?.url === 'string' && media.url.trim().length > 0;
  }

  private async handleLocationMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    if (
      content.type !== EMessageType.location ||
      !this.getInnerMessage(data)?.locationMessage
    ) {
      return;
    }

    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    const locationMsg = msg?.locationMessage as
      | {
          degreesLatitude?: number;
          degreesLongitude?: number;
          name?: string;
          address?: string;
        }
      | undefined;
    if (!locationMsg) return;

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
    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    const contactMsg = msg?.contactMessage as
      | { vcard?: string; displayName?: string }
      | undefined;
    if (content.type !== EMessageType.contact_card || !contactMsg?.vcard) {
      return;
    }

    try {
      const vcard = contactMsg.vcard ?? '';
      const parsed = this.parseVCard(vcard);

      const phoneAndDdi = extractPhoneAndDdiFromContactMessage(
        contactMsg as Parameters<typeof extractPhoneAndDdiFromContactMessage>[0]
      );

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
    } catch (error) {
      console.error(
        `[MessageUpsert] Failed to handle contact message for message ${data.message?.key?.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  private async handleContactsMessage(
    content: IContent,
    data: IUpsertMessage
  ): Promise<void> {
    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    const contactsArrayMessage = msg?.contactsArrayMessage as
      | { contacts?: Array<{ vcard?: string; displayName?: string }> }
      | undefined;
    const contactsArray = contactsArrayMessage?.contacts;
    if (content.type !== EMessageType.contacts || !contactsArray?.length) {
      return;
    }

    try {
      const processedContacts: IContactMessage[] = [];

      for (const contactMsg of contactsArray) {
        if (!contactMsg.vcard) continue;

        const vcard = contactMsg.vcard;
        const parsed = this.parseVCard(vcard);

        const phoneAndDdi = extractPhoneAndDdiFromContactMessage(
          contactMsg as Parameters<
            typeof extractPhoneAndDdiFromContactMessage
          >[0]
        );

        if (!phoneAndDdi) continue;

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

        processedContacts.push({
          contact_id: existingContactId,
          name: existingContactName,
          last_name: existingContactLastName,
          phone: phoneAndDdi.phone,
          phone_partial: phonePartial,
          phone_ddi: phoneAndDdi.phone_ddi,
          email: parsed.email ?? null,
          email_partial: emailPartial,
          photo: existingContactPhoto,
        });
      }

      if (processedContacts.length > 0) {
        content.contacts = processedContacts;
      }
    } catch (error) {
      console.error(
        `[MessageUpsert] Failed to handle contacts message for message ${data.message?.key?.id}:`,
        error instanceof Error ? error.message : error
      );
    }
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

      const contactLabels =
        existingContact.label_templates?.map((label) => ({
          label_template_id: label.label_template_id,
          label: label.label,
          color: label.color,
        })) ?? null;

      inputChatMessage.contact = {
        id: existingContact.contact_id,
        name: existingContact.name,
        phone: existingContact.phone_partial ?? phone,
        phone_ddi: existingContact.phone_ddi ?? phoneAndDdi.phone_ddi,
        photo: existingContact.photo ?? null,
        responsible_attendant: responsibleAttendant,
        ignore: ignoreStatus,
      };

      if (contactLabels) {
        inputChatMessage.label = contactLabels;
      }

      if (ignoreStatus === EContactIgnore.ignore_automation) {
        inputChatMessage.status = EChatStatus.queue;
        if (responsibleAttendant) {
          inputChatMessage.user = responsibleAttendant;
        }

        return 'ignore_automation';
      }

      return null;
    }

    const canCreateContact =
      await this.planAccountService.validateCanCreateContactReceived(
        data.account_id
      );
    if (!canCreateContact) return null;

    const shouldAutoSave = await this.shouldAutoSaveContact(data.worker_id);
    if (!shouldAutoSave) return null;

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

      const contactLabels =
        createdContact.label_templates?.map((label) => ({
          label_template_id: label.label_template_id,
          label: label.label,
          color: label.color,
        })) ?? null;

      inputChatMessage.contact = {
        id: createdContact.contact_id,
        name: createdContact.name,
        phone: createdContact.phone_partial ?? phone,
        phone_ddi: createdContact.phone_ddi ?? phoneAndDdi.phone_ddi,
        photo: createdContact.photo ?? null,
        responsible_attendant: responsibleAttendant,
        ignore: ignoreStatus,
      };

      if (contactLabels) {
        inputChatMessage.label = contactLabels;
      }

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
  ): Promise<ICreateChatMessageResult> {
    try {
      await this.updateChatPhotoIfNeeded(getChat, data);

      const reactionResult = await this.handleReactionMessage(getChat, data);
      if (reactionResult !== null) {
        return {
          handled: reactionResult.handled,
          reactionInactivityInteraction: reactionResult.inactivityInteraction,
        };
      }

      const editResult = await this.handleEditMessage(getChat, data);
      if (editResult !== null) {
        return {
          handled: editResult,
          reactionInactivityInteraction: null,
        };
      }

      const deleteResult = await this.handleDeleteMessage(getChat, data);
      if (deleteResult !== null) {
        return {
          handled: deleteResult,
          reactionInactivityInteraction: null,
        };
      }

      await this.handlePinMessage(getChat, data);

      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);

      const content = this.buildMessageContent(data);
      if (this.isEmptyTextContent(content)) {
        return {
          handled: true,
          reactionInactivityInteraction: null,
        };
      }

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

      await this.handleMediaMessages(content, data);
      await this.handleLocationMessage(content, data);
      await this.handleContactMessage(content, data);
      await this.handleContactsMessage(content, data);

      (data as IUpsertMessage & { content?: IContent }).content = content;

      const isFromMe = data.message?.key?.fromMe ?? false;
      const { typeUser, summary } = this.buildTypeUserAndSummary(
        data.type,
        isFromMe,
        data
      );

      const inputChatMessage: IChatMessage = {
        message_id: this.buildDeterministicMessageId(getChat, data),
        chat_id: getChat.chat_id,
        message_key: {
          remote_jid: jid,
          remote_jid_alt: jidAlt,
          from_me: data.message?.key?.fromMe,
          id: data.message?.key?.id,
          participant: data.message?.key?.participant,
          participant_alt: data.message?.key?.participantAlt,
          addressing_mode: data.message?.key?.addressingMode,
          is_view_once:
            data.message?.key?.isViewOnce ??
            data.type === EMessageType.view_once,
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
        return {
          handled: false,
          reactionInactivityInteraction: null,
        };
      }

      const existingMessageByKey = await this.findMessageByKeyId(
        data.account_id,
        getChat.chat_id,
        messageId,
        data.message?.key
      );
      if (existingMessageByKey?.message_id) {
        await this.chatService.patchExistingMessageMissingFields(
          existingMessageByKey.message_id,
          inputChatMessage
        );
        return {
          handled: true,
          reactionInactivityInteraction: null,
        };
      }

      const createResult =
        await this.chatService.createMessageIdempotent(inputChatMessage);

      if (!createResult.created && !createResult.conflict) {
        return {
          handled: false,
          reactionInactivityInteraction: null,
        };
      }

      if (createResult.conflict) {
        await this.chatService.patchExistingMessageMissingFields(
          createResult.id,
          inputChatMessage
        );

        return {
          handled: true,
          reactionInactivityInteraction: null,
        };
      }

      await this.centrifugoChatPublish(inputChatMessage);

      if (!data.message?.key?.fromMe && data.message?.key) {
        const markAsRead = await this.shouldMarkAsRead(data.worker_id);

        if (markAsRead) {
          await this.markIncomingMessageAsRead(
            data.account_id,
            data.worker_id,
            data.message.key
          );
        }
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

          const [accountResult, queueResult] = await Promise.allSettled([
            this.centrifugoService.publishSub(
              chatAccountCentrifugo(channelAccountId),
              updatedChat
            ),
            this.centrifugoService.publishSub(
              chatQueueAccountCentrifugo(channelAccountId),
              updatedChat
            ),
          ]);

          if (accountResult.status === 'rejected') {
            logger.error({
              type: 'message_upsert_centrifugo_account_publish_failed',
              message: 'Failed to publish to account channel',
              channel: chatAccountCentrifugo(channelAccountId),
              error:
                accountResult.reason instanceof Error
                  ? accountResult.reason.message
                  : accountResult.reason,
            });
            incrementCounter('centrifugo_account_publish_failed');
          }

          if (queueResult.status === 'rejected') {
            logger.error({
              type: 'message_upsert_centrifugo_queue_publish_failed',
              message: 'Failed to publish to queue channel',
              channel: chatQueueAccountCentrifugo(channelAccountId),
              error:
                queueResult.reason instanceof Error
                  ? queueResult.reason.message
                  : queueResult.reason,
            });
            incrementCounter('centrifugo_queue_publish_failed');
          }

          if (inputChatMessage.type_user !== ETypeUserChat.operator) {
            const isFromMe = inputChatMessage.message_key?.from_me === true;

            if (!isFromMe) {
              await this.pushNotificationService
                .sendNotificationForChatMessage(updatedChat, inputChatMessage)
                .catch(() => {});
            }
          }
        },
        { ttlMs: 30000, retryMs: 50, maxWaitMs: 45000 }
      );

      return {
        handled: true,
        reactionInactivityInteraction: null,
      };
    } catch (error) {
      logger.error({
        type: 'message_upsert_create_chat_message_error',
        message: `Error in createChatMessage for chat ${getChat.chat_id}`,
        error: error instanceof Error ? error.message : error,
        chat_id: getChat.chat_id,
        account_id: data.account_id,
      });
      recordException(error, {
        type: 'message_upsert_create_chat_message_error',
        chat_id: getChat.chat_id,
      });
      incrementCounter('message_upsert_create_chat_message_error');
      throw error;
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

    try {
      const originalMessage = await this.findMessageByKeyId(
        accountId,
        chatId,
        messageQuotedId,
        quoted.key
      );

      if (!originalMessage?.content) return;

      this.enrichSticker(quoted, originalMessage.content);
      this.enrichImage(quoted, originalMessage.content);
      this.enrichVideo(quoted, originalMessage.content);
      this.enrichDocument(quoted, originalMessage.content);
      this.enrichAudio(quoted, originalMessage.content);
    } catch (error) {
      console.error(
        `[MessageUpsert] Failed to enrich quoted message content for ${messageQuotedId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  private nameChat(data: IUpsertMessage) {
    const isFromMe = data?.message?.key?.fromMe ?? false;
    if (isFromMe) {
      return null;
    }

    if (data.is_call_event) {
      const callCandidates: unknown[] = [
        data.call_name,
        data?.message?.pushName,
      ];

      for (const candidate of callCandidates) {
        const name = this.normalizeChatNameCandidate(candidate);
        if (!name) continue;
        if (this.isJidLikeName(name)) continue;
        return name;
      }

      return null;
    }

    return this.normalizeChatNameCandidate(data?.message?.pushName);
  }

  private getInnerMessage(
    data: IUpsertMessage
  ): Record<string, unknown> | null {
    const msg = data.message?.message;
    if (!msg) return null;

    const keepViewOnce = data.type === EMessageType.view_once;
    const unwrapped = unwrapMessage(
      msg as Parameters<typeof unwrapMessage>[0],
      { keepViewOnce }
    );
    return (unwrapped ?? msg) as Record<string, unknown>;
  }

  private getBaseMessage(data: IUpsertMessage): IUpsertMessageEnvelope | null {
    const raw = data.message;
    if (!raw) return null;

    const inner = this.getInnerMessage(data);
    if (!inner || inner === raw.message) return raw;

    return { ...raw, message: inner };
  }

  private buildDeterministicMessageId(
    getChat: IChat,
    data: IUpsertMessage
  ): string {
    const keyId = data.message?.key?.id;
    if (!keyId) {
      return uuidv7();
    }

    const fromMe = data.message?.key?.fromMe ? '1' : '0';
    const base = `${data.account_id}:${getChat.chat_id}:${fromMe}:${keyId}`;
    const hash = createHash('sha1').update(base).digest('hex');
    return `wa_${hash}`;
  }

  private shouldDiscardByMessageKeyJid(data: IUpsertMessage): boolean {
    const key = data.message?.key;
    if (!key) return false;

    const rawCandidates = [
      remoteJid(key),
      remoteJidAlt(key),
      key.participant,
      key.participantAlt,
    ];

    for (const candidate of rawCandidates) {
      const raw = this.toNonEmptyString(candidate);
      if (!raw) continue;

      const normalized = normalizeJid(raw) ?? raw;
      if (
        this.isSystemMessageJid(normalized) ||
        normalized === 'status@broadcast' ||
        normalized.endsWith('@broadcast') ||
        normalized.endsWith('@g.us')
      ) {
        return true;
      }
    }

    return false;
  }

  private shouldDiscardEmptyText(data: IUpsertMessage): boolean {
    if (data.type !== EMessageType.text) {
      return false;
    }

    if (this.isMessageEmpty(data)) {
      return true;
    }

    const content = this.buildMessageContent(data);
    return this.isEmptyTextContent(content);
  }

  private shouldDiscardUpsert(data: IUpsertMessage): boolean {
    if (this.shouldDiscardByMessageKeyJid(data)) {
      return true;
    }

    if (this.shouldDiscardEmptyText(data)) {
      return true;
    }

    if (data.type === EMessageType.set_disappearing_messages) {
      return false;
    }

    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    const protocolMsg = msg?.protocolMessage as { type?: number } | undefined;
    const pType = protocolMsg?.type;

    return (
      pType === MessageUpsertConsume.PROTOCOL_MESSAGE_TYPE_EPHEMERAL_SETTING ||
      pType ===
        MessageUpsertConsume.PROTOCOL_MESSAGE_TYPE_EPHEMERAL_SYNC_RESPONSE
    );
  }

  private isMessageEmpty(data: IUpsertMessage): boolean {
    if (data.type === EMessageType.set_disappearing_messages) {
      return false;
    }

    const msg = this.getInnerMessage(data) as Record<string, unknown> | null;
    const ext = msg?.extendedTextMessage as { text?: string } | undefined;
    const messageText = ext?.text ?? (msg?.conversation as string | undefined);
    return this.normalizeMessageTextForEmptyCheck(messageText).length === 0;
  }

  private isEmptyTextContent(content: IContent): boolean {
    if (content.type !== EMessageType.text) {
      return false;
    }

    const messageText = extractMessageTextFromContent(content);
    return this.normalizeMessageTextForEmptyCheck(messageText).length === 0;
  }

  private normalizeMessageTextForEmptyCheck(
    text: string | null | undefined
  ): string {
    if (!text) {
      return '';
    }

    return text.replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').trim();
  }

  private buildMessageContent(data: IUpsertMessage): IContent {
    const baseMessage = this.getBaseMessage(data);
    const msg = baseMessage?.message as Record<string, unknown> | undefined;
    const extended = msg?.extendedTextMessage as
      | Record<string, unknown>
      | undefined;
    const templateMessage = (msg as any)?.templateMessage?.hydratedTemplate;

    const linkPreview = extended
      ? ({
          'canonical-url': (extended?.matchedText as string) ?? '',
          'matched-text': (extended?.matchedText as string) ?? '',
          title: (extended?.title as string) ?? '',
          description: (extended?.description as string) ?? '',
          jpegThumbnail: extended?.jpegThumbnail,
        } as LinkPreview)
      : undefined;

    const extText = msg?.extendedTextMessage as { text?: string } | undefined;
    let messageText: string | undefined =
      extText?.text ?? (msg?.conversation as string | undefined) ?? undefined;

    if (!messageText && data.type === EMessageType.document) {
      const documentMsg = this.getDocumentMessage(data) as {
        caption?: string;
      } | null;
      if (documentMsg?.caption) {
        messageText = documentMsg.caption;
      }
    }

    if (!messageText && data.type === EMessageType.image) {
      const imageMsg = this.getImageMessage(data) as {
        caption?: string;
      } | null;
      if (imageMsg?.caption) {
        messageText = imageMsg.caption;
      }
    }

    if (
      !messageText &&
      (data.type === EMessageType.video ||
        data.type === EMessageType.video_note)
    ) {
      const videoMsg = this.getVideoMessage(data) as {
        caption?: string;
      } | null;
      if (videoMsg?.caption) {
        messageText = videoMsg.caption;
      }
    }

    let content: IContent = {
      type: data.type,
      message: messageText,
      link_preview: linkPreview,
      quoted: baseMessage
        ? buildQuotedTextFromExtended(
            baseMessage as Parameters<typeof buildQuotedTextFromExtended>[0]
          )
        : null,
      context_info: baseMessage
        ? buildContextInfoFromMessage(
            baseMessage as Parameters<typeof buildContextInfoFromMessage>[0]
          )
        : null,
    };

    if (data.content?.message && !content.message) {
      content.message = data.content.message;
    }

    if (data.content?.quoted) {
      content.quoted = data.content.quoted;
    }

    if (data.content?.context_info && !content.context_info) {
      content.context_info = data.content.context_info;
    }

    if (data.content?.message_quoted_id) {
      content.message_quoted_id = data.content.message_quoted_id;
    }

    if (data.content?.media_download_failed) {
      content.media_download_failed = true;
    }

    if (data.type === EMessageType.set_disappearing_messages) {
      const protocolMessage = (msg as any)?.protocolMessage;
      const expiration = protocolMessage?.ephemeralExpiration ?? 0;
      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);
      const phone = getPhoneFromJid(jid, jidAlt);
      const pushName = data.message?.pushName;

      let formattedPhone: string | null = null;
      if (phone) {
        const phoneWithPlus = `+${phone}`;
        const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);
        formattedPhone = phoneAndDdi
          ? `${phoneAndDdi.phone_ddi} ${phoneAndDdi.phone}`
          : phone;
      }

      content = {
        ...content,
        type: EMessageType.system,
        ephemeral: {
          enabled: expiration > 0,
          expiration_seconds: expiration > 0 ? expiration : null,
          user_name: pushName ?? null,
          user_phone: formattedPhone,
        },
      };
    }

    const messageQuotedId = content.quoted?.key.id ?? null;
    if (messageQuotedId) {
      content.message_quoted_id = messageQuotedId;
    }

    if (templateMessage) {
      const hydratedButtons = templateMessage.hydratedButtons
        ?.filter(
          (btn: Record<string, unknown>) =>
            (btn as { quickReplyButton?: unknown }).quickReplyButton
        )
        .map((btn: Record<string, unknown>) => {
          const quickReply = (
            btn as { quickReplyButton?: { displayText?: string; id?: string } }
          ).quickReplyButton;
          return {
            displayText: quickReply?.displayText ?? '',
            id: quickReply?.id ?? '',
          };
        });

      content.template = {
        hydratedTitleText: templateMessage.hydratedTitleText ?? null,
        hydratedContentText: templateMessage.hydratedContentText ?? null,
        hydratedButtons:
          hydratedButtons && hydratedButtons.length > 0
            ? hydratedButtons
            : null,
        templateId: (msg as any)?.templateMessage?.templateId ?? null,
        verifiedBizName: data.message?.verifiedBizName ?? null,
      };

      if (templateMessage.hydratedContentText) {
        content.message = templateMessage.hydratedContentText;
      }
    }

    if (data.type === EMessageType.system) {
      const pinMessage = (msg as any)?.pinInChatMessage;
      if (pinMessage) {
        const jid = remoteJid(data.message?.key);
        const jidAlt = remoteJidAlt(data.message?.key);
        const phone = getPhoneFromJid(jid, jidAlt);
        const pushName = data.message?.pushName;
        const pinType = pinMessage.type;

        let formattedPhone: string | null = null;
        if (phone) {
          const phoneWithPlus = `+${phone}`;
          const phoneAndDdi = extractPhoneAndDdi(phoneWithPlus);
          formattedPhone = phoneAndDdi
            ? `${phoneAndDdi.phone_ddi} ${phoneAndDdi.phone}`
            : phone;
        }

        content.pin = {
          pin_action: pinType ? String(pinType) : null,
          pin_user_name: pushName ?? null,
          pin_user_phone: formattedPhone,
        };

        if (!content.message) {
          content.message = '';
        }
      }
    }

    if (data.content?.album) {
      content.album = data.content.album;
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

    const isFromMe = data.message?.key?.fromMe ?? false;
    const chatId = uuidv7();
    const nameFromMessage = this.nameChat(data);
    const name =
      isFromMe &&
      this.isLikelyOwnAccountName(nameFromMessage, viewAccountName?.name)
        ? null
        : nameFromMessage;
    const messageDate = new Date().toISOString();

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

    const contactName = this.normalizeChatNameCandidate(
      inputChatMessage.contact?.name
    );
    if (contactName) {
      inputChatMessage.name = contactName;
    } else if (!inputChatMessage.name) {
      inputChatMessage.name = null;
    }

    if (data.photo) {
      try {
        const photoResult = await this.storageService.uploadFromUrl(
          data.photo,
          data.account_id,
          chatId
        );
        inputChatMessage.photo =
          inputChatMessage.contact?.photo ?? photoResult?.url ?? null;
      } catch (error) {
        console.error(
          `[MessageUpsert] Failed to upload photo for new chat ${chatId}:`,
          error instanceof Error ? error.message : error
        );
        inputChatMessage.photo = inputChatMessage.contact?.photo ?? null;
      }
    }

    if (
      inputChatMessage.status === EChatStatus.ura ||
      inputChatMessage.status === EChatStatus.ura_output ||
      inputChatMessage.status === EChatStatus.ura_schedule ||
      inputChatMessage.status === EChatStatus.ura_webhook
    ) {
      inputChatMessage.forward_to_output_chatbot = false;
    }

    if (
      inputChatMessage.status === EChatStatus.ura_webhook &&
      data.webhook_chatbot_id
    ) {
      inputChatMessage.chatbot_webhook_id = data.webhook_chatbot_id;
    }

    const chatWithProtocol =
      await this.chatService.ensureProtocolForNewChat(inputChatMessage);

    await this.saveChatWithCaches(chatWithProtocol);

    if (chatWithProtocol.status === EChatStatus.in_chat) {
      await this.attendanceInactivityService.startTrackingOnInChatEntry(
        chatWithProtocol
      );
    }

    return chatWithProtocol;
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
    chatbotId: string,
    options?: {
      beforeExecute?: (chat: IChat) => Promise<void>;
    }
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

    const canExecuteFlow = await this.acquireAutomationSendAttempt(
      data,
      'chatbot_flow'
    );
    if (!canExecuteFlow) {
      return;
    }

    if (options?.beforeExecute) {
      await options.beforeExecute(chat);
    }

    if (
      !getChat &&
      data.webhook_message_type === 'chatbot' &&
      data.webhook_chatbot_id
    ) {
      await this.chatbotFlowRunnerService.clearFlowCacheForChat(
        chat.account.id,
        chat.worker.id,
        chat.chat_id
      );
    }

    return this.chatbotFlowRunnerService.execute(t, data, chat, chatbotId);
  }

  private resolveInitialStatusForNewChat(
    fromHistorySync: boolean | undefined,
    isFromMe: boolean
  ): EChatStatus {
    if (fromHistorySync) {
      return EChatStatus.queue;
    }

    if (isFromMe) {
      return EChatStatus.in_chat;
    }

    return EChatStatus.queue;
  }

  private async createOrUpdateChatQueue(
    t: TFunction<'translation', undefined>,
    getChat: IChat | null,
    data: IUpsertMessage
  ): Promise<void> {
    if (!getChat) {
      const isFromMe = data.message?.key?.fromMe ?? false;
      const initialStatus = this.resolveInitialStatusForNewChat(
        data.from_history_sync,
        isFromMe
      );

      const createChat = await this.createChat(data, initialStatus);
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
          await this.attendanceInactivityService.cancelInactivityTracking(
            createChat
          );

          return;
        }
      }

      await this.processTransferIfNeeded(t, createChat, data);

      const shouldDiscardEmptyText = this.shouldDiscardEmptyText(data);
      const shouldSkipMessageCreation =
        shouldDiscardEmptyText && data.webhook_message_type === 'message';

      if (shouldSkipMessageCreation) {
        await this.saveChatWithCaches(createChat);
        await this.centrifugoChatQueuePublish(createChat);
        return;
      }

      return this.handleNewChatMessageAndPublish(createChat, data);
    }

    const shouldDiscardEmptyText = this.shouldDiscardEmptyText(data);
    const shouldSkipMessageCreation =
      shouldDiscardEmptyText && data.webhook_message_type === 'message';
    const isFromMe = data.message?.key?.fromMe ?? false;
    const typeUserForInactivity = this.buildTypeUserAndSummary(
      data.type,
      isFromMe,
      data
    ).typeUser;
    const wasInChat = getChat.status === EChatStatus.in_chat;
    const hasTransfer =
      Boolean(data.transfer_sector_id) || Boolean(data.transfer_user_id);

    await this.processTransferIfNeeded(t, getChat, data);

    let currentStatusAfterTransfer: IChat['status'] | null = getChat.status;
    if (wasInChat && hasTransfer) {
      const currentChat = await this.chatService.findChatByChatId(
        data.account_id,
        getChat.chat_id
      );
      currentStatusAfterTransfer = currentChat?.status ?? null;

      if (currentStatusAfterTransfer !== EChatStatus.in_chat) {
        await this.attendanceInactivityService.cancelInactivityTracking(
          getChat
        );
      }
    }

    let createMessageResult: ICreateChatMessageResult | null = null;
    if (!shouldSkipMessageCreation) {
      createMessageResult = await this.createChatMessage(getChat, data);
    }

    const reactionInactivityInteraction =
      data.type === EMessageType.react
        ? (createMessageResult?.reactionInactivityInteraction ?? null)
        : null;

    const canResetByStatus =
      !hasTransfer || currentStatusAfterTransfer === EChatStatus.in_chat;

    if (
      wasInChat &&
      canResetByStatus &&
      reactionInactivityInteraction?.actorTypeUser === ETypeUserChat.client &&
      reactionInactivityInteraction.targetTypeUser === ETypeUserChat.operator
    ) {
      await this.attendanceInactivityService.resetOnContactMessage(getChat);
    } else if (
      wasInChat &&
      canResetByStatus &&
      reactionInactivityInteraction?.actorTypeUser === ETypeUserChat.operator &&
      reactionInactivityInteraction.targetTypeUser === ETypeUserChat.client
    ) {
      await this.attendanceInactivityService.resetOnOperatorMessage(getChat);
    } else if (
      wasInChat &&
      typeUserForInactivity === ETypeUserChat.client &&
      data.type !== EMessageType.react &&
      canResetByStatus
    ) {
      await this.attendanceInactivityService.resetOnContactMessage(getChat);
    } else if (
      wasInChat &&
      typeUserForInactivity === ETypeUserChat.operator &&
      this.shouldResetOperatorAttendanceInactivity(
        data.type,
        shouldSkipMessageCreation
      ) &&
      canResetByStatus
    ) {
      await this.attendanceInactivityService.resetOnOperatorMessage(getChat);
    }
  }

  private async processTransferIfNeeded(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (data.transfer_sector_id) {
      await this.transferToSector(t, chat, data);
      return;
    }

    if (data.transfer_user_id) {
      await this.transferToUser(t, chat, data);
    }
  }

  private async transferToSector(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (!data.transfer_sector_id) {
      return;
    }

    const sectorData = await this.sectorService.viewSectorById(
      data.transfer_sector_id,
      chat.account.id
    );

    if (!sectorData) {
      return;
    }

    const sector: IChat['sector'] = {
      id: sectorData.sector_id,
      name: sectorData.name,
      color: sectorData.color,
    };

    let user: IChat['user'] | null = null;

    if (data.transfer_sector_user_id) {
      const userData = await this.userService.viewUserNamePhoto(
        data.transfer_sector_user_id
      );

      if (userData) {
        user = {
          id: userData.id,
          name: userData.name,
          photo: userData.photo ?? null,
        };
      }
    }

    await this.chatService.updateChatUserAndSector(chat.chat_id, user, sector);
  }

  private async transferToUser(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    data: IUpsertMessage
  ): Promise<void> {
    if (!data.transfer_user_id) {
      return;
    }

    const userData = await this.userService.viewUserNamePhoto(
      data.transfer_user_id
    );

    if (!userData) {
      return;
    }

    const user: IChat['user'] = {
      id: userData.id,
      name: userData.name,
      photo: userData.photo ?? null,
    };

    await this.chatService.updateChatUserAndSector(chat.chat_id, user, null);
  }

  private getEffectiveInputChatbotId(
    getChat: IChat | null,
    inputChatbotId: string | null
  ): string | null {
    if (
      getChat?.status === EChatStatus.ura_schedule &&
      getChat?.chatbot_schedule_id
    ) {
      return getChat.chatbot_schedule_id;
    }

    if (
      getChat?.status === EChatStatus.ura_webhook &&
      getChat?.chatbot_webhook_id
    ) {
      return getChat.chatbot_webhook_id;
    }

    return inputChatbotId;
  }

  private resolveInputChatbotIdByWorkingHours(
    chatbotsConfig: Awaited<ReturnType<WorkerConfigService['viewChatbots']>>,
    defaultInputChatbotId: string | null
  ): string | null {
    if (!chatbotsConfig.enabled) {
      return null;
    }

    if (!chatbotsConfig.chatbot_working_hours_enabled) {
      return defaultInputChatbotId;
    }

    const activeRule = getActiveChatbotWorkingHoursRule(
      chatbotsConfig.chatbot_working_hours_rules,
      chatbotsConfig.chatbot_working_hours_timezone
    );

    return activeRule?.chatbot_id || defaultInputChatbotId;
  }

  private shouldEvaluateAttendanceHours(data: IUpsertMessage): boolean {
    const isFromMe = data.message?.key?.fromMe ?? false;

    return !isFromMe && !data.from_history_sync && !data.webhook_message_type;
  }

  private resolveOutsideHoursContext(
    data: IUpsertMessage,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    >
  ): {
    attendance_hours: IAttendanceHoursConfig;
    outside_hours_message: string;
  } | null {
    if (!this.shouldEvaluateAttendanceHours(data)) {
      return null;
    }

    const rawAttendanceConfig = workerConfigFields?.attendance_hours;
    if (!rawAttendanceConfig) {
      return null;
    }

    const attendanceConfig = parseAttendanceHoursConfig(rawAttendanceConfig);
    if (!isAttendanceHoursConfigEnabledValid(attendanceConfig)) {
      console.warn(
        `[MessageUpsert] Invalid attendance_hours config for worker ${data.worker_id}. Skipping outside-hours gate.`
      );
      return null;
    }

    if (isNowWithinAttendanceHours(attendanceConfig)) {
      return null;
    }

    const configuredMessage = workerConfigFields?.outside_hours_message?.trim();

    return {
      attendance_hours: attendanceConfig,
      outside_hours_message:
        configuredMessage || this.OUTSIDE_HOURS_DEFAULT_MESSAGE,
    };
  }

  private getOutsideHoursDebounceKey(
    accountId: string,
    chatId: string
  ): string {
    return `underchat:attendance-hours:debounce:${accountId}:${chatId}`;
  }

  private getAutomationSourceMessageKey(data: IUpsertMessage): string | null {
    const messageId = this.toNonEmptyString(data.message?.key?.id);
    if (!messageId) {
      return null;
    }

    const rawJid =
      remoteJid(data.message?.key) || remoteJidAlt(data.message?.key);
    const normalizedJid = rawJid
      ? (normalizeJid(rawJid) ?? rawJid)
      : 'unknown_jid';
    const fromMeTag = data.message?.key?.fromMe === true ? '1' : '0';

    return `${fromMeTag}:${normalizedJid}:${messageId}`;
  }

  private getAutomationDedupeKey(
    data: IUpsertMessage,
    automationType: 'chatbot_flow' | 'outside_hours',
    sourceMessageKey: string
  ): string {
    return `${this.AUTOMATION_SEND_DEDUPE_PREFIX}:${data.account_id}:${data.worker_id}:${automationType}:${sourceMessageKey}`;
  }

  private async acquireAutomationSendAttempt(
    data: IUpsertMessage,
    automationType: 'chatbot_flow' | 'outside_hours'
  ): Promise<boolean> {
    const sourceMessageKey = this.getAutomationSourceMessageKey(data);
    if (!sourceMessageKey) {
      logger.warn({
        type: 'message_upsert_automation_dedupe_missing_source_key',
        automation_type: automationType,
        account_id: data.account_id,
        worker_id: data.worker_id,
      });
      return false;
    }

    const dedupeKey = this.getAutomationDedupeKey(
      data,
      automationType,
      sourceMessageKey
    );

    try {
      const acquired = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        this.AUTOMATION_SEND_DEDUPE_TTL_SECONDS,
        'NX'
      );
      return acquired === 'OK';
    } catch (error) {
      logger.error({
        type: 'message_upsert_automation_dedupe_error',
        automation_type: automationType,
        account_id: data.account_id,
        worker_id: data.worker_id,
        source_message_key: sourceMessageKey,
        error: error instanceof Error ? error.message : error,
      });
      recordException(error, {
        type: 'message_upsert_automation_dedupe_error',
        automation_type: automationType,
      });
      return false;
    }
  }

  private async sendOutsideHoursMessageWithDebounce(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    chat: IChat,
    message: string
  ): Promise<void> {
    if (
      chat.contact?.ignore === EContactIgnore.ignore_automation ||
      chat.contact?.ignore === EContactIgnore.ignore_totally
    ) {
      return;
    }

    const canSendOutsideHours = await this.acquireAutomationSendAttempt(
      data,
      'outside_hours'
    );
    if (!canSendOutsideHours) {
      return;
    }

    const debounceKey = this.getOutsideHoursDebounceKey(
      data.account_id,
      chat.chat_id
    );

    const lock = await this.redis.set(
      debounceKey,
      '1',
      'EX',
      this.OUTSIDE_HOURS_DEBOUNCE_SECONDS,
      'NX'
    );

    if (lock !== 'OK') {
      return;
    }

    let protocol: string | null = null;
    if (hasProtocolTag(message)) {
      protocol =
        (await this.chatService.getOrCreateChatProtocol(
          data.account_id,
          chat.chat_id,
          'protocol_start'
        )) || this.chatService.getLatestProtocolByType(chat, 'protocol_start');
    }

    const formattedMessage = replaceMessageTags({
      message,
      chat,
      t,
      protocol,
    }).trim();

    if (!formattedMessage) {
      return;
    }

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId: data.account_id,
      type: EMessageType.text,
      message: formattedMessage,
      typeUser: ETypeUserChat.system,
    });
  }

  private async handleOutsideHoursMessageOnly(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    getChat: IChat | null,
    phone: string,
    jid: string | null | undefined,
    jidAlt: string | null | undefined,
    outsideHoursContext: {
      attendance_hours: IAttendanceHoursConfig;
      outside_hours_message: string;
    }
  ): Promise<void> {
    await this.createOrUpdateChatQueue(t, getChat, data);

    const currentChat =
      getChat ||
      (await this.chatService.findChatByPhone(
        data.account_id,
        data.worker_id,
        phone,
        jid,
        jidAlt
      ));

    if (!currentChat) {
      return;
    }

    await this.sendOutsideHoursMessageWithDebounce(
      t,
      data,
      currentChat,
      outsideHoursContext.outside_hours_message
    );

    if (
      outsideHoursContext.attendance_hours.message_only_destination_status ===
      'closed'
    ) {
      await this.chatService.updateChatStatus(
        currentChat.chat_id,
        EChatStatus.closed,
        undefined,
        undefined,
        new Date().toISOString()
      );
    } else {
      let outsideHoursSector: IChat['sector'] | null = null;
      const outsideHoursSectorId =
        outsideHoursContext.attendance_hours.message_only_queue_sector_id;

      if (outsideHoursSectorId) {
        const sector = await this.sectorService.viewSectorById(
          outsideHoursSectorId,
          data.account_id
        );

        if (sector) {
          outsideHoursSector = {
            id: sector.sector_id,
            name: sector.name,
            color: sector.color ?? null,
          };
        } else {
          console.warn(
            `[MessageUpsert] Outside-hours sector ${outsideHoursSectorId} not found for account ${data.account_id}. Keeping chat in queue without sector.`
          );
        }
      }

      await this.chatService.updateChatStatus(
        currentChat.chat_id,
        EChatStatus.queue,
        null,
        undefined,
        null
      );

      await this.chatService.updateChatUserAndSector(
        currentChat.chat_id,
        null,
        outsideHoursSector
      );
    }

    const updatedChat = await this.chatService.findChatByChatId(
      data.account_id,
      currentChat.chat_id
    );

    if (updatedChat) {
      await this.centrifugoChatQueuePublish(updatedChat);
    }
  }

  private async createOrUpdateChat(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage,
    phone: string
  ): Promise<void> {
    if (this.shouldDiscardUpsert(data)) {
      return;
    }

    const normalizedPhone = this.normalizePhoneForLock(phone);
    const lockKey = `chat-create:${data.account_id}:${data.worker_id}:${normalizedPhone}`;

    await withLock(
      this.redis,
      lockKey,
      async () => {
        const jid = remoteJid(data.message?.key);
        const jidAlt = remoteJidAlt(data.message?.key);

        const [chatbotsConfig, getChat, workerConfigFields] = await Promise.all(
          [
            this.workerConfigService.viewChatbots(data.worker_id),
            this.chatService.findChatByPhone(
              data.account_id,
              data.worker_id,
              phone,
              jid,
              jidAlt
            ),
            this.workerService.viewWorkerConfigFieldsByWorkerId(data.worker_id),
          ]
        );

        const outsideHoursContext = this.resolveOutsideHoursContext(
          data,
          workerConfigFields
        );
        const isFirstOutsideHoursInteraction = !getChat;

        const defaultInputChatbotId =
          chatbotsConfig.enabled && chatbotsConfig.chatbot_id
            ? chatbotsConfig.chatbot_id
            : null;
        const inputChatbotId = this.resolveInputChatbotIdByWorkingHours(
          chatbotsConfig,
          defaultInputChatbotId
        );

        const outputChatbotId =
          chatbotsConfig.enabled && chatbotsConfig.output_chatbot_id
            ? chatbotsConfig.output_chatbot_id
            : null;

        const isFromMe = data.message?.key?.fromMe ?? false;

        if (
          outsideHoursContext &&
          outsideHoursContext.attendance_hours.outside_hours_action ===
            'message_only'
        ) {
          if (!isFirstOutsideHoursInteraction) {
            await this.createOrUpdateChatQueue(t, getChat, data);
            return;
          }

          await this.handleOutsideHoursMessageOnly(
            t,
            data,
            getChat,
            phone,
            jid,
            jidAlt,
            outsideHoursContext
          );
          return;
        }

        const shouldSendOutsideHoursAndContinue =
          isFirstOutsideHoursInteraction &&
          outsideHoursContext?.attendance_hours.outside_hours_action ===
            'continue_flow';

        if (data.from_history_sync) {
          await this.createOrUpdateChatQueue(t, getChat, data);
          return;
        }

        if (data.webhook_message_type === 'message') {
          await this.createOrUpdateChatQueue(t, getChat, data);
          return;
        }

        if (
          data.webhook_message_type === 'chatbot' &&
          data.webhook_chatbot_id
        ) {
          await this.createOrUpdateChatBotFlow(
            t,
            getChat,
            data,
            data.webhook_chatbot_id,
            shouldSendOutsideHoursAndContinue && outsideHoursContext
              ? {
                  beforeExecute: async (chat) => {
                    await this.sendOutsideHoursMessageWithDebounce(
                      t,
                      data,
                      chat,
                      outsideHoursContext.outside_hours_message
                    );
                  },
                }
              : undefined
          );

          return;
        }

        if (
          outputChatbotId &&
          getChat &&
          getChat.status === EChatStatus.ura_output &&
          !isFromMe
        ) {
          await this.createOrUpdateChatBotFlow(
            t,
            getChat,
            data,
            outputChatbotId,
            shouldSendOutsideHoursAndContinue && outsideHoursContext
              ? {
                  beforeExecute: async (chat) => {
                    await this.sendOutsideHoursMessageWithDebounce(
                      t,
                      data,
                      chat,
                      outsideHoursContext.outside_hours_message
                    );
                  },
                }
              : undefined
          );

          return;
        }

        const effectiveInputChatbotId = this.getEffectiveInputChatbotId(
          getChat,
          inputChatbotId
        );

        if (
          effectiveInputChatbotId &&
          (!getChat ||
            getChat.status === EChatStatus.ura ||
            getChat.status === EChatStatus.ura_schedule ||
            getChat.status === EChatStatus.ura_webhook) &&
          !isFromMe
        ) {
          await this.createOrUpdateChatBotFlow(
            t,
            getChat,
            data,
            effectiveInputChatbotId,
            shouldSendOutsideHoursAndContinue && outsideHoursContext
              ? {
                  beforeExecute: async (chat) => {
                    await this.sendOutsideHoursMessageWithDebounce(
                      t,
                      data,
                      chat,
                      outsideHoursContext.outside_hours_message
                    );
                  },
                }
              : undefined
          );

          return;
        }

        await this.createOrUpdateChatQueue(t, getChat, data);

        if (shouldSendOutsideHoursAndContinue && outsideHoursContext) {
          const currentChat =
            getChat ||
            (await this.chatService.findChatByPhone(
              data.account_id,
              data.worker_id,
              phone,
              jid,
              jidAlt
            ));

          if (currentChat) {
            await this.sendOutsideHoursMessageWithDebounce(
              t,
              data,
              currentChat,
              outsideHoursContext.outside_hours_message
            );
          }
        }
      },
      { ttlMs: 60000, retryMs: 100, maxWaitMs: 90000 }
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

      const currentChain = previousChain
        .then(async () => {
          const processMessage = async (): Promise<boolean> => {
            if (this.shouldDiscardUpsert(data)) {
              return true;
            }

            const jid = remoteJid(data.message?.key);
            const jidAlt = remoteJidAlt(data.message?.key);

            if (!jid && !jidAlt) {
              const dlqSent = await this.sendToDlq(
                data,
                new Error('Received message without remoteJid'),
                0
              );
              return dlqSent;
            }

            const phone = getPhoneFromJid(jid, jidAlt);

            if (!phone) {
              const dlqSent = await this.sendToDlq(
                data,
                new Error('Received message without valid phone'),
                0
              );
              return dlqSent;
            }

            await this.processWithRetry(t, data, phone);
            return true;
          };

          while (true) {
            let timeoutLogged = false;
            const timeout = setTimeout(() => {
              timeoutLogged = true;
              logger.error({
                type: 'message_upsert_timeout',
                message: `Message processing timeout after ${this.MESSAGE_PROCESSING_TIMEOUT_MS}ms. Offset will not be committed.`,
                partition,
                offset,
                account_id: data.account_id,
                worker_id: data.worker_id,
                message_key_id: data.message?.key?.id,
              });
              incrementCounter('message_upsert_timeout');
            }, this.MESSAGE_PROCESSING_TIMEOUT_MS);
            timeout.unref?.();

            try {
              const processed = await processMessage();
              clearTimeout(timeout);

              if (!processed) {
                throw new Error('Message processing returned false');
              }

              this.partitionFailureCounts.set(partition, 0);
              await this.commitNext(topic, partition, offset);
              return;
            } catch (error) {
              clearTimeout(timeout);

              if (
                this.elasticDatabaseService.isReadOnlyAllowDeleteBlockError(
                  error
                )
              ) {
                logger.error({
                  type: 'message_upsert_elastic_read_only_allow_delete',
                  message:
                    'Elasticsearch flood-stage read-only block detected. Offset not committed; retrying after backoff.',
                  partition,
                  offset,
                  account_id: data.account_id,
                  worker_id: data.worker_id,
                  message_key_id: data.message?.key?.id,
                });
                incrementCounter(
                  'message_upsert_elastic_read_only_allow_delete'
                );
                await delay(3000);
                continue;
              }

              logger.error({
                type: timeoutLogged
                  ? 'message_upsert_timeout_retry'
                  : 'message_upsert_processing_error',
                message:
                  'Error processing message. Offset will not be committed; retrying after backoff.',
                error: error instanceof Error ? error.message : error,
                partition,
                offset,
                account_id: data.account_id,
                worker_id: data.worker_id,
                message_key_id: data.message?.key?.id,
              });
              recordException(error, {
                type: 'message_upsert_processing_error',
                partition: String(partition),
              });
              incrementCounter(
                timeoutLogged
                  ? 'message_upsert_timeout_retry'
                  : 'message_upsert_processing_error'
              );

              this.incrementPartitionFailure(partition);
              await delay(timeoutLogged ? 5000 : 3000);
            }
          }
        })
        .catch((error) => {
          logger.error({
            type: 'message_upsert_unhandled_error',
            message: `Unhandled error in partition ${partition}, offset ${offset}`,
            error: error instanceof Error ? error.message : error,
            partition,
            offset,
          });
          recordException(error, {
            type: 'message_upsert_unhandled_error',
            partition: String(partition),
          });
          incrementCounter('message_upsert_unhandled_error');
          this.incrementPartitionFailure(partition);
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
    this.isRunning = false;

    const pendingChains = Array.from(this.partitionChains.values());
    if (pendingChains.length > 0) {
      const SHUTDOWN_TIMEOUT_MS = 30000;
      const chainsPromise = Promise.allSettled(pendingChains);
      const timeoutPromise = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS)
      );

      const result = await Promise.race([chainsPromise, timeoutPromise]);

      if (result === 'timeout') {
        console.warn(
          `[MessageUpsert] WARNING: Shutdown timeout after ${SHUTDOWN_TIMEOUT_MS}ms. Some messages may be reprocessed on restart.`
        );
      }
    }

    if (!this.consumer) {
      return;
    }

    try {
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
      this.partitionFailureCounts.clear();
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
}
