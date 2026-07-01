import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import {
  AnyMessageContent,
  Contact,
  MessageUserReceiptUpdate,
  proto,
  WACallEvent,
  WAMessage,
  WAMessageKey,
  WAMessageUpdate,
  WASocket,
} from '@whiskeysockets/baileys';
import {
  mapIncomingToType,
  messageHasQuoted,
} from '@core/common/functions/mapIncomingToType';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import {
  baileysEnvironment,
  generalEnvironment,
} from '@core/config/environments';
import { getChatKind } from '@core/common/functions/getChatKind';
import { EChatKind } from '@core/common/enums/EChatKind';
import { EMessageUpsertType } from '@core/common/enums/EMessageUpsertType';
import { remoteJid } from '@core/common/functions/remoteJid';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import {
  MessageSummaryPatch,
  MessageStatusService,
} from '@core/services/messageStatus.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IBaileysPendingMessage } from '@core/common/interfaces/IBaileysPendingMessage';
import { BaileysUpsertMediaEnricher } from './upsertMediaEnricher.service';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { BaileysDeliveryConfirmationService } from './deliveryConfirmation.service';
import { MessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import { resolveCallEventJidAndPhone } from '../util/callEventResolver';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import { InboundMessageSpoolService } from '@core/services/inboundMessageSpool.service';
import { IInboundMessageSpoolPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';
import { LidJidCacheService } from '@core/services/lidJidCache.service';

const UNSUPPORTED_INCOMING_MESSAGE_TEXT =
  'Mensagem recebida não suportada pelo provedor. Verifique no WhatsApp.';

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

const HISTORY_RECONCILIATION_ENABLED =
  process.env.HISTORY_RECONCILIATION_ENABLED !== 'false';
const HISTORY_RECONCILIATION_MESSAGE_LIMIT = readPositiveIntEnv(
  'HISTORY_RECONCILIATION_MESSAGE_LIMIT',
  100
);
const HISTORY_RECONCILIATION_WINDOW_MS = 60 * 60 * 1000;

interface ProcessIncomingOptions {
  allowHistoricalUpsert?: boolean;
  fromHistorySync?: boolean;
}

function getWAMessageTimestampMs(message: WAMessage): number | null {
  const raw: unknown = message.messageTimestamp;
  if (raw === null || raw === undefined) {
    return null;
  }

  const value =
    typeof raw === 'object' && raw && 'toNumber' in raw
      ? (raw as { toNumber: () => number }).toNumber()
      : Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;
  private readonly processedMessages = new Map<string, number>();
  private readonly processedCalls = new Map<string, number>();
  private readonly contactNamesByJid = new Map<string, string>();
  private readonly contactJidAliasesByJid = new Map<string, Set<string>>();
  private readonly MAX_SIZE = 100000;
  private readonly DEDUP_WINDOW_MS = 3000;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private rejectCallConfig: boolean = false;

  private readonly pendingQueue: IBaileysPendingMessage[] = [];
  private isProcessingQueue = false;
  private readonly MAX_RETRIES = 100;
  private readonly RETRY_BASE_DELAY_MS = 50;
  private readonly MAX_RETRY_DELAY_MS = 5000;
  private readonly MAX_QUEUE_SIZE = 500000;
  private readonly DESTROY_TIMEOUT_MS = 30000;
  private queueProcessorInterval?: ReturnType<typeof setTimeout>;
  private isDestroying = false;

  private readonly PHOTO_CACHE_TTL = 86400;
  private readonly PHOTO_CACHE_NO_PHOTO_TTL = 300;
  private readonly PHOTO_CACHE_PREFIX = 'photo:jid:';
  private readonly PHOTO_NO_PHOTO_CACHE_PREFIX = 'photo:no-photo:baileys:jid:';
  private readonly PHOTO_CACHE_NO_PHOTO = '__no_photo__';
  private readonly PROFILE_PIC_TIMEOUT_MS = 3000;
  private readonly PROFILE_PIC_CACHE_VALIDATE_TIMEOUT_MS = 2000;
  private readonly MESSAGE_CACHE_TTL_SECONDS_DEFAULT = 60 * 60 * 8;
  private readonly MESSAGE_CACHE_TTL_SECONDS_POLL = 60 * 60 * 24 * 7;
  private readonly MESSAGE_CACHE_PREFIX = 'wa:msg:';
  private readonly SEND_CONFIRMATION_MAX_ATTEMPTS = 1;
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;
  private readonly CALL_AUTO_REPLY_DEDUPE_PREFIX = 'call:auto-reply';
  private readonly CALL_AUTO_REPLY_DEDUPE_TTL_SECONDS =
    generalEnvironment.automationSendDedupeTtlSeconds;
  private readonly FORWARDABLE_CACHE_TYPES = new Set<EMessageType>([
    EMessageType.text,
    EMessageType.image,
    EMessageType.document,
    EMessageType.audio,
    EMessageType.video,
    EMessageType.video_note,
    EMessageType.sticker,
    EMessageType.location,
    EMessageType.contact_card,
    EMessageType.contacts,
  ]);

  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis,
    @inject(BaileysUpsertMediaEnricher)
    private readonly upsertMediaEnricher: BaileysUpsertMediaEnricher,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(BaileysDeliveryConfirmationService)
    private readonly deliveryConfirmation: BaileysDeliveryConfirmationService,
    @inject(InboundMessageSpoolService)
    private readonly inboundMessageSpoolService: InboundMessageSpoolService = {
      startPublisher: () => undefined,
      publish: async (
        payload: IInboundMessageSpoolPayload,
        publisher: (payload: IInboundMessageSpoolPayload) => Promise<void>
      ) => {
        await publisher(payload);
        return true;
      },
      parkConsumerMessage: async () => undefined,
    } as unknown as InboundMessageSpoolService,
    @inject(LidJidCacheService)
    private readonly lidJidCacheService: LidJidCacheService = {
      isLidJid: (jid?: string | null) => jid?.trim().endsWith('@lid') === true,
      resolvePhoneJid: async () => null,
      remember: async () => null,
      rememberFromUpsert: async () => null,
      rememberFromChat: async () => null,
      extractPhoneJidFromChat: () => null,
    } as unknown as LidJidCacheService
  ) {
    this.startCleanupInterval();
    this.startQueueProcessor();
    this.inboundMessageSpoolService.startPublisher(
      'baileys',
      baileysEnvironment.baileysWorkerId,
      (payload) => this.publishSpoolPayload(payload)
    );
  }

  private getMessageKey(m: WAMessage): string | null {
    const jid = normalizeJid(remoteJid(m.key));
    const jidAlt = normalizeJid(remoteJidAlt(m.key));
    const id = m.key?.id;
    const fromMe = m.key?.fromMe ?? false;

    if (!id) return null;

    const jidToUse = jid || jidAlt;
    if (!jidToUse) return null;

    return `${jidToUse}:${id}:${fromMe}`;
  }

  private async rememberMessageKeyLidJidPair(
    key: WAMessageKey | null | undefined
  ): Promise<void> {
    try {
      await this.lidJidCacheService.remember(
        baileysEnvironment.baileysAccountId,
        baileysEnvironment.baileysWorkerId,
        remoteJid(key),
        remoteJidAlt(key)
      );
    } catch (error) {
      this.logLifecycle({ key } as WAMessage, {
        stage: 'baileys.lid_jid_cache.remember_error',
        decision: 'remember_lid_jid_pair',
        outcome: 'error',
        level: 'warn',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async hydrateMessageKeyFromLidCache(m: WAMessage): Promise<void> {
    const key = m.key as
      (WAMessageKey & { remoteJidAlt?: string | null }) | null | undefined;
    if (!key) {
      return;
    }

    await this.rememberMessageKeyLidJidPair(key);

    const jid = normalizeJid(remoteJid(key));
    const jidAlt = normalizeJid(remoteJidAlt(key));
    const lidJid = [jid, jidAlt].find((candidate): candidate is string =>
      this.lidJidCacheService.isLidJid(candidate)
    );
    if (!lidJid) {
      return;
    }

    let phoneJid: string | null = null;
    try {
      phoneJid = await this.lidJidCacheService.resolvePhoneJid(
        baileysEnvironment.baileysAccountId,
        baileysEnvironment.baileysWorkerId,
        lidJid
      );
    } catch (error) {
      this.logLifecycle(m, {
        stage: 'baileys.lid_jid_cache.resolve_error',
        decision: 'resolve_lid_jid_pair',
        outcome: 'error',
        level: 'warn',
        lid_jid: lidJid,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!phoneJid) {
      return;
    }

    if (jid === lidJid) {
      key.remoteJid = jid;
      key.remoteJidAlt = phoneJid;
      return;
    }

    if (jidAlt === lidJid && (!jid || this.lidJidCacheService.isLidJid(jid))) {
      key.remoteJid = phoneJid;
      key.remoteJidAlt = jidAlt;
    }
  }

  private logLifecycle(
    m: WAMessage | null | undefined,
    event: Record<string, unknown>
  ): void {
    void m;
    void event;
  }

  private inspectDebugPayload(value: unknown): string {
    return inspect(value, {
      depth: 12,
      maxArrayLength: 80,
      maxStringLength: 8000,
      breakLength: 180,
      compact: false,
      sorted: true,
    });
  }

  private hasDeepMessageField(
    value: unknown,
    field: string,
    depth = 0,
    seen = new WeakSet<object>()
  ): boolean {
    if (!value || typeof value !== 'object' || depth > 10) return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Object.prototype.hasOwnProperty.call(value, field)) return true;

    return Object.values(value as Record<string, unknown>).some((entry) =>
      this.hasDeepMessageField(entry, field, depth + 1, seen)
    );
  }

  private hasIncomingEditSignal(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;

    if (this.hasDeepMessageField(message, 'editedMessage')) return true;

    const protocolEditType = proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;
    const findProtocolEdit = (
      value: unknown,
      depth = 0,
      seen = new WeakSet<object>()
    ): boolean => {
      if (!value || typeof value !== 'object' || depth > 10) return false;
      if (seen.has(value)) return false;
      seen.add(value);

      const record = value as Record<string, unknown>;
      const protocolMessage = record.protocolMessage as
        Record<string, unknown> | undefined;
      if (protocolMessage?.type === protocolEditType) return true;

      return Object.values(record).some((entry) =>
        findProtocolEdit(entry, depth + 1, seen)
      );
    };

    return findProtocolEdit(message);
  }

  private logIncomingProviderPayloadDebug(
    stage: string,
    payload: unknown,
    meta: Record<string, unknown> = {}
  ): void {
    console.log(
      '[BAILEYS_INCOMING_DEBUG]',
      this.inspectDebugPayload({
        stage,
        worker_id: baileysEnvironment.baileysWorkerId,
        account_id: baileysEnvironment.baileysAccountId,
        ...meta,
        payload,
      })
    );
  }

  private isPhoneLikeName(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;

    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 8) return false;

    const nonPhoneChars = normalized.replace(/[0-9+\-().\s]/g, '');
    return nonPhoneChars.length === 0;
  }

  private normalizeNameCandidate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (this.isPhoneLikeName(trimmed)) return null;
    return trimmed;
  }

  private buildJidAliases(jid: string): string[] {
    const aliases = new Set<string>();
    const normalized = normalizeJid(jid) ?? jid;
    aliases.add(normalized);

    if (normalized.endsWith('@s.whatsapp.net')) {
      aliases.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
    }

    if (normalized.endsWith('@c.us')) {
      aliases.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
    }

    return Array.from(aliases);
  }

  private buildSelfJidAliases(socket?: WASocket): Set<string> {
    const aliases = new Set<string>();
    const user = socket?.user;
    if (!user) {
      return aliases;
    }

    const rawCandidates = [user.id, user.lid, user.phoneNumber].filter(
      (candidate): candidate is string => typeof candidate === 'string'
    );

    for (const rawCandidate of rawCandidates) {
      const normalized = normalizeJid(rawCandidate) ?? rawCandidate;
      for (const alias of this.buildJidAliases(normalized)) {
        aliases.add(alias);
      }
    }

    return aliases;
  }

  private resolvePeerJid(
    key?: WAMessageKey | null,
    socket?: WASocket,
    preferredJid?: string
  ): string | undefined {
    const rawCandidates = [
      preferredJid,
      remoteJid(key),
      remoteJidAlt(key),
    ].filter((candidate): candidate is string => !!candidate);

    if (!rawCandidates.length) {
      return undefined;
    }

    const candidates = Array.from(
      new Set(
        rawCandidates.map((candidate) => normalizeJid(candidate) ?? candidate)
      )
    );
    const selfAliases = this.buildSelfJidAliases(socket);

    for (const candidate of candidates) {
      const candidateAliases = this.buildJidAliases(candidate);
      const isSelf = candidateAliases.some((alias) => selfAliases.has(alias));
      if (!isSelf) {
        return candidate;
      }
    }

    return undefined;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private normalizePhotoCandidate(value: unknown): string | undefined {
    const raw = this.toNonEmptyString(value);
    if (!raw) return undefined;

    if (!raw.includes('@')) {
      const digits = raw.replaceAll(/\D/g, '');
      return digits.length >= 8 ? `${digits}@s.whatsapp.net` : undefined;
    }

    return normalizeJid(raw) ?? raw;
  }

  private cacheContactJidAliases(candidates: string[]): void {
    const expanded = new Set<string>();

    for (const candidate of candidates) {
      const normalized = this.normalizePhotoCandidate(candidate);
      if (!normalized) continue;

      for (const alias of this.buildJidAliases(normalized)) {
        expanded.add(alias);
      }
    }

    if (expanded.size < 2) return;

    for (const alias of expanded) {
      const existing = this.contactJidAliasesByJid.get(alias) ?? new Set();
      for (const linkedAlias of expanded) {
        existing.add(linkedAlias);
      }
      this.contactJidAliasesByJid.set(alias, existing);
    }
  }

  private resolveContactJidAliases(jid: string): string[] {
    const aliases = new Set(this.buildJidAliases(jid));

    for (const alias of Array.from(aliases)) {
      const cachedAliases = this.contactJidAliasesByJid.get(alias);
      if (!cachedAliases) continue;

      for (const cachedAlias of cachedAliases) {
        aliases.add(cachedAlias);
      }
    }

    return Array.from(aliases);
  }

  private cacheContactName(jid: string | undefined, name: string | null): void {
    if (!jid || !name) return;
    for (const alias of this.buildJidAliases(jid)) {
      this.contactNamesByJid.set(alias, name);
    }
  }

  private upsertContactNames(
    contacts: Array<Contact | Partial<Contact>>
  ): void {
    for (const contact of contacts) {
      const contactIds = [
        this.normalizePhotoCandidate(contact.id),
        this.normalizePhotoCandidate(contact.lid),
        this.normalizePhotoCandidate(contact.phoneNumber),
      ].filter((candidate): candidate is string => !!candidate);

      if (!contactIds.length) continue;
      this.cacheContactJidAliases(contactIds);

      const name =
        this.normalizeNameCandidate(contact.name) ??
        this.normalizeNameCandidate(contact.notify) ??
        this.normalizeNameCandidate(contact.verifiedName);

      if (!name) continue;
      for (const contactId of contactIds) {
        this.cacheContactName(contactId, name);
      }
    }
  }

  private resolveContactNameFromCache(jid: string | undefined): string | null {
    if (!jid) return null;

    for (const alias of this.buildJidAliases(jid)) {
      const cached = this.contactNamesByJid.get(alias);
      if (cached) {
        return cached;
      }
    }

    return null;
  }

  private resolveMessagePushName(m: WAMessage): string | null {
    const fromMe = m.key?.fromMe ?? false;
    const peerJid = this.resolvePeerJid(m.key, this.currentSocket);

    if (fromMe) {
      if (!peerJid) return null;
      return this.resolveContactNameFromCache(peerJid);
    }

    const currentPushName = this.normalizeNameCandidate(m.pushName);
    if (currentPushName) {
      return currentPushName;
    }

    return this.resolveContactNameFromCache(peerJid);
  }

  private buildMessageCacheKey(key?: WAMessageKey | null): string | null {
    return this.buildMessageCacheKeys(key)[0] ?? null;
  }

  private buildMessageCacheKeys(key?: WAMessageKey | null): string[] {
    if (!key?.id) return [];

    const jids = [remoteJid(key), remoteJidAlt(key)]
      .map((candidate) => normalizeJid(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));
    if (!jids.length) return [];

    const aliases = new Set<string>();
    for (const jid of jids) {
      for (const alias of this.resolveContactJidAliases(jid)) {
        aliases.add(alias);
      }
    }

    return Array.from(aliases).map(
      (jid) =>
        `${this.MESSAGE_CACHE_PREFIX}${baileysEnvironment.baileysAccountId}:${jid}:${key.id}`
    );
  }

  private hasPollCreationMessage(
    message: proto.IMessage | null | undefined
  ): boolean {
    if (!message) return false;

    return Boolean(
      message.pollCreationMessage ||
      message.pollCreationMessageV2 ||
      message.pollCreationMessageV3 ||
      message.pollCreationMessageV4 ||
      message.pollCreationMessageV5 ||
      message.pollCreationOptionImageMessage
    );
  }

  private shouldCacheMessage(m: WAMessage, isRetry = false): boolean {
    if (isRetry) return true;
    if (m.key?.fromMe) return true;
    if (this.hasPollCreationMessage(m.message)) return true;

    const messageType = mapIncomingToType(m);
    if (!messageType) return false;

    if (messageType === EMessageType.view_once) return false;

    return this.FORWARDABLE_CACHE_TYPES.has(messageType);
  }

  private async cacheMessage(
    m: WAMessage,
    opts?: { isRetry?: boolean }
  ): Promise<void> {
    if (!this.shouldCacheMessage(m, opts?.isRetry ?? false)) return;

    const cacheKeys = this.buildMessageCacheKeys(m.key);
    if (!cacheKeys.length || !m.message) return;

    try {
      const ttlSeconds = this.hasPollCreationMessage(m.message)
        ? this.MESSAGE_CACHE_TTL_SECONDS_POLL
        : this.MESSAGE_CACHE_TTL_SECONDS_DEFAULT;
      const encoded = proto.Message.encode(m.message).finish();
      const payload = Buffer.from(encoded).toString('base64');
      await Promise.all(
        cacheKeys.map((cacheKey) =>
          this.redis.set(cacheKey, payload, 'EX', ttlSeconds)
        )
      );
    } catch {}
  }

  async cacheOutgoingForwardableMessage(
    message: WAMessage | proto.WebMessageInfo
  ): Promise<void> {
    if (!message?.key || !message?.message) {
      return;
    }

    await this.cacheMessage(message as WAMessage, { isRetry: true });
  }

  async getCachedMessage(
    key: WAMessageKey
  ): Promise<proto.IMessage | undefined> {
    const cacheKeys = this.buildMessageCacheKeys(key);
    if (!cacheKeys.length) return undefined;

    try {
      for (const cacheKey of cacheKeys) {
        const payload = await this.redis.get(cacheKey);
        if (!payload) continue;

        const decoded = proto.Message.decode(Buffer.from(payload, 'base64'));
        return decoded as proto.IMessage;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private startCleanupInterval() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupOldEntries(this.processedMessages);
      this.cleanupOldEntries(this.processedCalls);
    }, 60000);
  }

  private cleanupOldEntries(processedMap: Map<string, number>): void {
    const now = Date.now();
    const expireThreshold = now - 30000;

    for (const [key, timestamp] of processedMap) {
      if (timestamp < expireThreshold) {
        processedMap.delete(key);
      }
    }

    if (processedMap.size > this.MAX_SIZE) {
      const excess = processedMap.size - this.MAX_SIZE;
      const iterator = processedMap.keys();
      for (let i = 0; i < excess; i++) {
        const key = iterator.next().value;
        if (key) processedMap.delete(key);
      }
    }
  }

  private stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  private startQueueProcessor() {
    if (this.queueProcessorInterval) return;

    const processLoop = () => {
      this.processRetryQueue().finally(() => {
        const delay = this.pendingQueue.length > 0 ? 50 : 500;
        this.queueProcessorInterval = setTimeout(processLoop, delay);
      });
    };

    this.queueProcessorInterval = setTimeout(processLoop, 100);
  }

  private stopQueueProcessor() {
    if (this.queueProcessorInterval) {
      clearTimeout(this.queueProcessorInterval);
      this.queueProcessorInterval = undefined;
    }
  }

  private async processRetryQueue(): Promise<void> {
    if (this.isProcessingQueue || this.pendingQueue.length === 0) return;

    this.isProcessingQueue = true;
    let batch: IBaileysPendingMessage[] = [];

    try {
      const batchSize = Math.min(50, this.pendingQueue.length);
      batch = this.pendingQueue.splice(0, batchSize);

      const results = await Promise.allSettled(
        batch.map((item) => this.sendToKafkaWithRetry(item))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          const item = batch[i];
          item.retries++;

          if (item.retries === 1) {
            void this.cacheMessage(item.inputUpsert.message as WAMessage, {
              isRetry: true,
            });
          }

          if (item.retries < this.MAX_RETRIES) {
            this.pendingQueue.push(item);
          } else {
            this.discardPendingMessage(item, 'retry_exhausted', result.reason);
          }
        }
      }

      batch = [];
    } catch (error) {
      console.error('[CRITICAL] Error in processRetryQueue:', error);

      if (batch.length > 0) {
        this.pendingQueue.unshift(...batch);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private discardPendingMessage(
    item: IBaileysPendingMessage,
    reason: string,
    error?: unknown
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = item.inputUpsert.message as WAMessage | undefined;

    this.logLifecycle(message, {
      stage: 'baileys.queue.discard',
      decision: 'discard_after_retry',
      outcome: 'discarded',
      reason,
      level: 'error',
      topic: item.topic,
      kafka_key: item.kafkaKey ?? item.messageKey,
      retry_count: item.retries,
      max_retries: this.MAX_RETRIES,
      queue_size: this.pendingQueue.length,
      error: error ? errorMessage : undefined,
    });

    console.error('[BaileysIncoming] Discarding pending message:', {
      reason,
      topic: item.topic,
      kafka_key: item.kafkaKey ?? item.messageKey,
      message_key: item.messageKey,
      account_id: item.inputUpsert.account_id,
      worker_id: item.inputUpsert.worker_id,
      message_key_id: item.inputUpsert.message?.key?.id,
      retries: item.retries,
      max_retries: this.MAX_RETRIES,
      error: error ? errorMessage : undefined,
    });
  }

  private async publishSpoolPayload(
    payload: IInboundMessageSpoolPayload
  ): Promise<void> {
    const item: IBaileysPendingMessage = {
      inputUpsert: payload.upsert,
      messageKey: payload.dedupe_key,
      kafkaKey: payload.kafka_key,
      topic: payload.kafka_topic,
      retries: payload.attempts,
      addedAt: Date.now(),
    };

    await this.sendToKafkaWithRetry(item);
  }

  private async sendToKafkaWithRetry(
    item: IBaileysPendingMessage
  ): Promise<void> {
    const kafkaKey =
      item.kafkaKey ??
      buildUpsertMessageKafkaKey(item.inputUpsert, item.messageKey);
    const delay = Math.min(
      this.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries),
      this.MAX_RETRY_DELAY_MS
    );

    if (item.retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      await this.ensurePhotoResolved(item);
    } catch (error) {
      this.logLifecycle(item.inputUpsert.message as WAMessage, {
        stage: 'baileys.photo.resolve_error',
        decision: 'photo_resolution',
        outcome: 'fallback',
        level: 'warn',
        topic: item.topic,
        kafka_key: kafkaKey,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    if (
      !item.inputUpsert.is_call_event &&
      item.inputUpsert.message &&
      (item.inputUpsert.message as WAMessage).message
    ) {
      try {
        await this.upsertMediaEnricher.enrich(
          item.inputUpsert,
          item.inputUpsert.message as WAMessage
        );
      } catch (error) {
        item.inputUpsert.content = {
          ...(item.inputUpsert.content ?? { type: item.inputUpsert.type }),
          type: item.inputUpsert.type,
          media_download_failed: true,
        };
        this.logLifecycle(item.inputUpsert.message as WAMessage, {
          stage: 'baileys.media.enrich_error',
          decision: 'media_enrichment',
          outcome: 'fallback',
          level: 'warn',
          topic: item.topic,
          kafka_key: kafkaKey,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logLifecycle(item.inputUpsert.message as WAMessage, {
      stage: 'baileys.kafka.publish.start',
      decision: 'publish_to_kafka',
      outcome: 'start',
      topic: item.topic,
      kafka_key: kafkaKey,
      retry_count: item.retries,
    });

    try {
      await this.streamProducerService.send(
        item.topic,
        item.inputUpsert,
        kafkaKey
      );

      this.logLifecycle(item.inputUpsert.message as WAMessage, {
        stage: 'baileys.kafka.publish.success',
        decision: 'publish_to_kafka',
        outcome: 'published',
        topic: item.topic,
        kafka_key: kafkaKey,
        retry_count: item.retries,
      });
    } catch (error) {
      this.logLifecycle(item.inputUpsert.message as WAMessage, {
        stage: 'baileys.kafka.publish.error',
        decision: 'publish_to_kafka',
        outcome: 'error',
        level: 'error',
        topic: item.topic,
        kafka_key: kafkaKey,
        retry_count: item.retries,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async enqueueMessage(
    inputUpsert: IUpsertMessage,
    messageKey: string,
    topic: string = this.kafkaServiceQueueService.upsertMessage()
  ): Promise<boolean> {
    if (this.isDestroying) {
      this.logLifecycle(inputUpsert.message as WAMessage, {
        stage: 'baileys.queue.enqueue',
        decision: 'enqueue',
        outcome: 'accepted',
        reason: 'destroying_but_spooled',
        topic,
        kafka_key: messageKey,
      });
    }

    const kafkaKey = buildUpsertMessageKafkaKey(inputUpsert, messageKey);
    const payload: IInboundMessageSpoolPayload = {
      provider: 'baileys',
      account_id: inputUpsert.account_id,
      worker_id: inputUpsert.worker_id,
      event_source: inputUpsert.from_history_sync
        ? 'history_reconciliation_upsert'
        : 'incoming_upsert',
      dedupe_key: messageKey,
      kafka_topic: topic,
      kafka_key: kafkaKey,
      upsert: inputUpsert,
      raw_meta: {
        message_key_id: inputUpsert.message?.key?.id,
        type: inputUpsert.type,
      },
      received_at: new Date().toISOString(),
      attempts: 0,
    };
    const published = await this.inboundMessageSpoolService.publish(
      payload,
      (spooledPayload) => this.publishSpoolPayload(spooledPayload)
    );
    this.logLifecycle(inputUpsert.message as WAMessage, {
      stage: 'baileys.queue.enqueue',
      decision: 'enqueue',
      outcome: published ? 'published' : 'spooled',
      topic,
      kafka_key: kafkaKey,
    });
    return published;
  }

  private isDuplicate(messageKey: string): boolean {
    const now = Date.now();
    const existingTimestamp = this.processedMessages.get(messageKey);

    if (existingTimestamp && now - existingTimestamp < this.DEDUP_WINDOW_MS) {
      return true;
    }

    this.processedMessages.set(messageKey, now);
    return false;
  }

  bindTo(socket: WASocket) {
    if (this.currentSocket === socket) return;

    this.unbind();
    this.currentSocket = socket;

    socket.ev.on('messages.upsert', (e) => {
      if (!e?.messages?.length) return;

      const isHistoryUpsert = e.type && e.type !== EMessageUpsertType.notify;

      const messages = isHistoryUpsert
        ? this.selectLatestHistoryMessages(e.messages)
        : e.messages;

      for (const m of messages) {
        this.logLifecycle(m, {
          stage: 'baileys.event.messages_upsert',
          decision: 'receive_provider_event',
          outcome: 'received',
          provider_upsert_type: e.type,
          raw_payload: e,
        });
        if (this.hasIncomingEditSignal(m.message)) {
          this.logIncomingProviderPayloadDebug(
            'messages.upsert.edit_signal',
            m,
            {
              provider_upsert_type: e.type,
              mapped_type: mapIncomingToType(m) ?? null,
              message_id: m.key?.id,
              remote_jid: m.key?.remoteJid,
              from_me: m.key?.fromMe,
            }
          );
        }
        void this.cacheMessage(m);
        if (isHistoryUpsert) {
          this.processHistoryMessage(socket, m, e.type);
        } else {
          this.processMessage(socket, m, e.type);
        }
      }
    });

    socket.ev.on('messaging-history.set', (event) => {
      if (!HISTORY_RECONCILIATION_ENABLED) {
        return;
      }
      if (!Array.isArray(event?.messages) || event.messages.length === 0) {
        return;
      }

      const messages = this.selectLatestHistoryMessages(event.messages);

      for (const message of messages) {
        void this.cacheMessage(message);
        this.processHistoryMessage(socket, message, 'messaging-history.set');
      }
    });

    socket.ev.on('contacts.upsert', (contacts) => {
      if (!Array.isArray(contacts) || contacts.length === 0) return;
      this.upsertContactNames(contacts);
    });

    socket.ev.on('contacts.update', (contacts) => {
      if (!Array.isArray(contacts) || contacts.length === 0) return;
      this.upsertContactNames(contacts as Array<Contact | Partial<Contact>>);
    });

    socket.ev.on('messages.update', (events) => {
      void this.handleMessagesUpdate(events);
    });

    socket.ev.on('message-receipt.update', (events) => {
      void this.handleMessageReceiptUpdate(events);
    });

    socket.ev.on('presence.update', (data) => {
      void this.handlePresenceUpdate(data);
    });

    socket.ev.on('call', (callEvents: WACallEvent[]) => {
      if (!callEvents) return;

      const eventsArray = Array.isArray(callEvents) ? callEvents : [callEvents];

      for (const callEvent of eventsArray) {
        void this.processCallEvent(socket, callEvent);
      }
    });
  }

  private processMessage(
    socket: WASocket,
    m: WAMessage,
    upsertType: string
  ): void {
    void this.processIncomingMessage(
      socket,
      m,
      upsertType,
      this.kafkaServiceQueueService.upsertMessage()
    );
  }

  private processHistoryMessage(
    socket: WASocket,
    m: WAMessage,
    upsertType: string | null
  ): void {
    if (!this.isHistoryMessageCandidate(m)) {
      this.logLifecycle(m, {
        stage: 'baileys.history.candidate',
        decision: 'history_candidate',
        outcome: 'skipped',
        reason: 'not_history_candidate',
        provider_upsert_type: upsertType ?? undefined,
      });
      return;
    }

    void this.processIncomingMessage(
      socket,
      m,
      upsertType,
      this.kafkaServiceQueueService.upsertMessageHistory(),
      {
        allowHistoricalUpsert: true,
        fromHistorySync: true,
      }
    );
  }

  private selectLatestHistoryMessages(messages: WAMessage[]): WAMessage[] {
    return messages
      .filter((message): message is WAMessage =>
        this.isHistoryMessageCandidate(message)
      )
      .sort(
        (a, b) =>
          (getWAMessageTimestampMs(b) ?? 0) - (getWAMessageTimestampMs(a) ?? 0)
      )
      .slice(0, HISTORY_RECONCILIATION_MESSAGE_LIMIT)
      .sort(
        (a, b) =>
          (getWAMessageTimestampMs(a) ?? 0) - (getWAMessageTimestampMs(b) ?? 0)
      );
  }

  private isHistoryMessageCandidate(m: WAMessage | null | undefined): boolean {
    if (!HISTORY_RECONCILIATION_ENABLED || !m) {
      return false;
    }

    if (m.category === 'peer' || m.key?.fromMe) {
      return false;
    }

    if (getChatKind(m) !== EChatKind.user) {
      return false;
    }

    const timestampMs = getWAMessageTimestampMs(m);
    if (
      !timestampMs ||
      Date.now() - timestampMs > HISTORY_RECONCILIATION_WINDOW_MS
    ) {
      return false;
    }

    return Boolean(mapIncomingToType(m) || m.message || m.key?.id);
  }

  private async processIncomingMessage(
    socket: WASocket,
    m: WAMessage,
    upsertType: string | null,
    topic: string,
    options: ProcessIncomingOptions = {}
  ): Promise<void> {
    try {
      this.logLifecycle(m, {
        stage: 'baileys.incoming.received',
        decision: 'receive',
        outcome: 'received',
        provider_upsert_type: upsertType ?? undefined,
        from_history_sync: options.fromHistorySync === true,
        raw_payload: m,
      });

      if (m.category === 'peer') {
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'category_filter',
          outcome: 'skipped',
          reason: 'peer_category',
        });
        return;
      }

      const chatKind = getChatKind(m);
      if (chatKind !== EChatKind.user) {
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'chat_kind_filter',
          outcome: 'skipped',
          reason: 'non_user_chat',
          chat_kind: chatKind,
        });
        return;
      }

      await this.hydrateMessageKeyFromLidCache(m);

      const messageKey = this.getMessageKey(m);
      if (!messageKey) {
        console.warn('[WARN] Message without key, skipping:', m.key?.id);
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'message_key',
          outcome: 'skipped',
          reason: 'missing_message_key',
        });
        return;
      }

      const localDuplicateKey = options.fromHistorySync
        ? `history:${messageKey}`
        : messageKey;
      if (this.isDuplicate(localDuplicateKey)) {
        this.logLifecycle(m, {
          stage: 'baileys.incoming.duplicate',
          decision: 'dedupe',
          outcome: 'continuing',
          reason: 'duplicate_seen',
          dedupe_key: localDuplicateKey,
        });
      }

      const mappedType = mapIncomingToType(m);
      const type = mappedType ?? EMessageType.system;
      const unsupportedFallback = !mappedType;
      if (unsupportedFallback) {
        console.warn(
          '[WARN] Unknown message type, publishing system fallback:',
          messageKey
        );
        this.logIncomingProviderPayloadDebug(
          'messages.upsert.unknown_message_type',
          m,
          {
            provider_upsert_type: upsertType ?? null,
            mapped_type: mappedType ?? null,
            message_key: messageKey,
            message_id: m.key?.id,
            remote_jid: m.key?.remoteJid,
            from_me: m.key?.fromMe,
            has_edit_signal: this.hasIncomingEditSignal(m.message),
          }
        );
        this.logLifecycle(m, {
          stage: 'baileys.incoming.fallback',
          decision: 'message_type_mapping',
          outcome: 'fallback_system_message',
          reason: 'unknown_message_type',
          kafka_key: messageKey,
        });
      }

      if (
        upsertType &&
        upsertType !== EMessageUpsertType.notify &&
        !options.allowHistoricalUpsert &&
        type !== EMessageType.view_once
      ) {
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'upsert_type_filter',
          outcome: 'skipped',
          reason: 'non_notify_upsert',
          provider_upsert_type: upsertType,
          message_type: type,
        });
        return;
      }

      const hasQuoted = messageHasQuoted(m);
      const resolvedPushName = this.resolveMessagePushName(m);
      if (m.key?.fromMe) {
        (m as WAMessage & { pushName?: string }).pushName =
          resolvedPushName ?? undefined;
      } else if (resolvedPushName && !m.pushName) {
        (m as WAMessage & { pushName?: string }).pushName = resolvedPushName;
      }

      const inputUpsert: IUpsertMessage = {
        worker_id: baileysEnvironment.baileysWorkerId,
        account_id: baileysEnvironment.baileysAccountId,
        source_provider: 'baileys',
        type,
        message: m as unknown as IUpsertMessage['message'],
        content: unsupportedFallback
          ? {
              type: EMessageType.system,
              message: UNSUPPORTED_INCOMING_MESSAGE_TEXT,
            }
          : undefined,
        photo: null,
        has_quoted: hasQuoted,
      };
      if (options.fromHistorySync) {
        inputUpsert.from_history_sync = true;
      }

      void this.enqueueMessage(inputUpsert, messageKey, topic).catch(
        (error) => {
          this.logLifecycle(m, {
            stage: 'baileys.inbound_spool.error',
            decision: 'persist_or_publish',
            outcome: 'error',
            level: 'error',
            reason: error instanceof Error ? error.message : String(error),
            topic,
            kafka_key: messageKey,
          });
          console.error('[BaileysIncoming] Failed to spool incoming message:', {
            topic,
            kafka_key: messageKey,
            account_id: inputUpsert.account_id,
            worker_id: inputUpsert.worker_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      );

      this.logLifecycle(m, {
        stage: 'baileys.incoming.mapped',
        decision: 'map_to_upsert',
        outcome: 'mapped',
        message_type: type,
        has_quoted: hasQuoted,
        topic,
        kafka_key: messageKey,
      });
    } catch (error) {
      console.error('[CRITICAL] Error processing message:', error, m.key?.id);
      this.logLifecycle(m, {
        stage: 'baileys.incoming.error',
        decision: 'process_incoming',
        outcome: 'error',
        level: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async ensurePhotoResolved(
    pendingItem: IBaileysPendingMessage
  ): Promise<void> {
    if (pendingItem.inputUpsert.photo) {
      return;
    }

    const socket = this.currentSocket;
    if (!socket) {
      return;
    }

    const photo = await this.resolvePhotoForUpsert(socket, pendingItem);
    if (photo) {
      pendingItem.inputUpsert.photo = photo;
    }
  }

  private buildPhotoCandidates(
    socket: WASocket,
    pendingItem: IBaileysPendingMessage,
    jid?: string
  ): string[] {
    const key = pendingItem.inputUpsert.message?.key;
    const resolvedPeerJid = this.resolvePeerJid(
      pendingItem.inputUpsert.message?.key,
      socket,
      jid
    );

    const callPhoneDigits = pendingItem.inputUpsert.call_phone?.replaceAll(
      /\D/g,
      ''
    );
    const callPhoneJid = callPhoneDigits
      ? `${callPhoneDigits}@s.whatsapp.net`
      : undefined;

    const rawCandidates = [
      callPhoneJid,
      resolvedPeerJid,
      jid,
      pendingItem.inputUpsert.call_jid,
      pendingItem.inputUpsert.call_jid_alt,
      remoteJid(key),
      remoteJidAlt(key),
    ];

    const candidates = new Set<string>();
    const selfAliases = this.buildSelfJidAliases(socket);

    for (const rawCandidate of rawCandidates) {
      const normalized = this.normalizePhotoCandidate(rawCandidate);
      if (!normalized) continue;

      for (const alias of this.resolveContactJidAliases(normalized)) {
        const fetchCandidate = this.normalizePhotoCandidate(alias);
        if (!fetchCandidate) continue;

        const isSelf = this.buildJidAliases(fetchCandidate).some(
          (candidateAlias) => selfAliases.has(candidateAlias)
        );
        if (!isSelf) {
          candidates.add(fetchCandidate);
        }
      }
    }

    const orderedCandidates = Array.from(candidates);
    const phoneCandidates = orderedCandidates.filter(
      (candidate) => !candidate.endsWith('@lid')
    );
    const lidCandidates = orderedCandidates.filter((candidate) =>
      candidate.endsWith('@lid')
    );

    return [...phoneCandidates, ...lidCandidates];
  }

  private async getCachedPhoto(
    candidates: string[]
  ): Promise<string | null | undefined> {
    for (const candidate of candidates) {
      try {
        const cached = await this.redis.get(
          `${this.PHOTO_CACHE_PREFIX}${candidate}`
        );
        if (!cached) {
          continue;
        }

        if (cached === this.PHOTO_CACHE_NO_PHOTO) {
          continue;
        }

        if (!(await this.isCachedPhotoUsable(cached))) {
          console.warn('[baileys] shared profile photo cache is not usable', {
            candidate,
            host: this.getUrlHost(cached),
          });
          continue;
        }

        return cached;
      } catch {
        continue;
      }
    }

    let hasNoPhotoCache = false;
    let hasMissingNoPhotoCache = false;

    for (const candidate of candidates) {
      try {
        const cached = await this.redis.get(
          `${this.PHOTO_NO_PHOTO_CACHE_PREFIX}${candidate}`
        );
        if (!cached) {
          hasMissingNoPhotoCache = true;
          continue;
        }

        if (cached === this.PHOTO_CACHE_NO_PHOTO) {
          hasNoPhotoCache = true;
          continue;
        }

        hasMissingNoPhotoCache = true;
      } catch {
        hasMissingNoPhotoCache = true;
      }
    }

    if (hasNoPhotoCache && !hasMissingNoPhotoCache) {
      return null;
    }

    return undefined;
  }

  private getUrlHost(value: string): string | undefined {
    try {
      return new URL(value).host;
    } catch {
      return undefined;
    }
  }

  private isLikelyTemporaryProfilePhotoUrl(value: string): boolean {
    const host = this.getUrlHost(value)?.toLowerCase();
    if (!host) {
      return false;
    }

    return host.includes('whatsapp.net') || host.includes('fbcdn.net');
  }

  private async isCachedPhotoUsable(photo: string): Promise<boolean> {
    if (!this.isLikelyTemporaryProfilePhotoUrl(photo)) {
      return true;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.PROFILE_PIC_CACHE_VALIDATE_TIMEOUT_MS
    );

    try {
      const response = await fetch(photo, {
        method: 'GET',
        headers: {
          Range: 'bytes=0-0',
        },
        signal: controller.signal,
      });
      await response.body?.cancel().catch(() => undefined);

      if (!response.ok) {
        return false;
      }

      const contentType = response.headers.get('content-type') ?? '';
      return !contentType || contentType.toLowerCase().startsWith('image/');
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private cachePhoto(candidates: string[], photo: string): void {
    const uniqueCandidates = new Set(candidates);
    for (const candidate of uniqueCandidates) {
      this.redis
        .set(
          `${this.PHOTO_CACHE_PREFIX}${candidate}`,
          photo,
          'EX',
          this.PHOTO_CACHE_TTL
        )
        .catch(() => {});
    }
  }

  private cacheNoPhoto(candidates: string[]): void {
    const uniqueCandidates = new Set(candidates);
    for (const candidate of uniqueCandidates) {
      this.redis
        .set(
          `${this.PHOTO_NO_PHOTO_CACHE_PREFIX}${candidate}`,
          this.PHOTO_CACHE_NO_PHOTO,
          'EX',
          this.PHOTO_CACHE_NO_PHOTO_TTL
        )
        .catch(() => {});
    }
  }

  private async withProfileTimeout(
    promise: Promise<string | undefined>
  ): Promise<string | undefined> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeout = new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(undefined),
          this.PROFILE_PIC_TIMEOUT_MS
        );
      });
      const result = await Promise.race([promise, timeout]);
      return this.toNonEmptyString(result);
    } catch {
      return undefined;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async fetchPhotoByCandidates(
    socket: WASocket,
    candidates: string[]
  ): Promise<string | undefined> {
    const results = await Promise.all(
      candidates.map((candidate) =>
        this.withProfileTimeout(socket.profilePictureUrl(candidate, 'image'))
      )
    );

    return results.find((photo): photo is string => !!photo);
  }

  private async resolvePhotoForUpsert(
    socket: WASocket,
    pendingItem: IBaileysPendingMessage,
    jid?: string
  ): Promise<string | undefined> {
    const candidates = this.buildPhotoCandidates(socket, pendingItem, jid);
    if (!candidates.length) {
      return undefined;
    }

    const cached = await this.getCachedPhoto(candidates);
    if (cached === null) {
      return undefined;
    }
    if (cached) {
      return cached;
    }

    const photo = await this.fetchPhotoByCandidates(socket, candidates);
    if (photo) {
      this.cachePhoto(candidates, photo);
      return photo;
    }

    this.cacheNoPhoto(candidates);
    return undefined;
  }

  private async handlePresenceUpdate(data: {
    id?: string;
    presences?: Record<string, { lastKnownPresence?: string }>;
  }): Promise<void> {
    if (!data?.id || !data?.presences) {
      return;
    }

    const chatJid = data.id;
    const presences = data.presences;

    for (const [, presence] of Object.entries(presences)) {
      if (!presence) continue;

      const state = this.mapPresenceToTypingState(presence.lastKnownPresence);
      if (!state) {
        continue;
      }

      const typingEvent: IChatTyping = {
        type: 'typing',
        jid: chatJid,
        is_typing: state.is_typing,
        is_recording: state.is_recording,
        typing_state: state.typing_state,
        account_id: baileysEnvironment.baileysAccountId,
        worker_id: baileysEnvironment.baileysWorkerId,
      };

      this.centrifugoService
        .publishSub(
          chatAccountCentrifugo(baileysEnvironment.baileysAccountId),
          typingEvent
        )
        .catch(() => {});
    }
  }

  private mapPresenceToTypingState(lastKnownPresence?: string): {
    is_typing: boolean;
    is_recording: boolean;
    typing_state: 'typing' | 'recording' | 'available';
  } | null {
    const normalizedPresence = lastKnownPresence?.toLowerCase();

    if (normalizedPresence === 'composing' || normalizedPresence === 'typing') {
      return {
        is_typing: true,
        is_recording: false,
        typing_state: 'typing',
      };
    }

    if (
      normalizedPresence === 'recording' ||
      normalizedPresence === 'recording_audio'
    ) {
      return {
        is_typing: false,
        is_recording: true,
        typing_state: 'recording',
      };
    }

    if (
      normalizedPresence === 'available' ||
      normalizedPresence === 'unavailable' ||
      normalizedPresence === 'paused'
    ) {
      return {
        is_typing: false,
        is_recording: false,
        typing_state: 'available',
      };
    }

    return null;
  }

  private getCallKey(
    callEvent: WACallEvent,
    fallbackJid?: string | null
  ): string | null {
    const jid = callEvent.chatId || callEvent.from || fallbackJid;
    if (!jid) return null;

    const callId = callEvent.id ?? Date.now().toString();

    return `${jid}:${callId}:${callEvent.status}`;
  }

  private getCallAutoReplyDedupeKey(callIdentity: string): string {
    return `${this.CALL_AUTO_REPLY_DEDUPE_PREFIX}:baileys:${baileysEnvironment.baileysAccountId}:${baileysEnvironment.baileysWorkerId}:${callIdentity}`;
  }

  private async acquireCallAutoReplySendAttempt(
    callIdentity: string
  ): Promise<boolean> {
    const dedupeKey = this.getCallAutoReplyDedupeKey(callIdentity);

    try {
      const acquired = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        this.CALL_AUTO_REPLY_DEDUPE_TTL_SECONDS,
        'NX'
      );

      return acquired === 'OK';
    } catch {
      return false;
    }
  }

  private getCallTimestampSeconds(callEvent: WACallEvent): number {
    const rawDate = (callEvent as { date?: unknown }).date;

    if (rawDate instanceof Date && Number.isFinite(rawDate.getTime())) {
      return Math.floor(rawDate.getTime() / 1000);
    }

    if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
      return rawDate > 1_000_000_000_000
        ? Math.floor(rawDate / 1000)
        : Math.floor(rawDate);
    }

    if (typeof rawDate === 'string') {
      const parsed = Date.parse(rawDate);
      if (!Number.isNaN(parsed)) {
        return Math.floor(parsed / 1000);
      }
    }

    return Math.floor(Date.now() / 1000);
  }

  private async processCallEvent(
    socket: WASocket,
    callEvent: WACallEvent | null
  ): Promise<void> {
    try {
      if (!callEvent) {
        return;
      }

      if (callEvent.status !== 'offer') {
        return;
      }

      const { callJid, callPhone } = resolveCallEventJidAndPhone({
        chatId: callEvent.chatId,
        from: callEvent.from,
        callerPn: callEvent.callerPn ?? null,
      });
      if (!callJid) {
        console.warn('[WARN] Call event without jid, skipping');
        return;
      }

      const callKey = this.getCallKey(callEvent, callJid);
      if (!callKey) {
        console.warn('[WARN] Call event without key, skipping');
        return;
      }

      if (this.processedCalls.has(callKey)) {
        return;
      }

      this.processedCalls.set(callKey, Date.now());

      const normalizedJid = normalizeJid(callJid) ?? callJid;
      const normalizedJidAlt = normalizedJid !== callJid ? callJid : null;
      const callId = callEvent.id ?? Date.now().toString();
      const isVideo = (callEvent as { isVideo?: boolean }).isVideo === true;
      const callText = isVideo
        ? 'Ligacão de vídeo recebida'
        : 'Ligacão recebida';
      let callPhoto: string | null = null;

      if (callPhone) {
        try {
          await this.lidJidCacheService.remember(
            baileysEnvironment.baileysAccountId,
            baileysEnvironment.baileysWorkerId,
            normalizedJid,
            `${callPhone}@s.whatsapp.net`
          );
        } catch (error) {
          this.logLifecycle(null, {
            stage: 'baileys.lid_jid_cache.remember_call_error',
            decision: 'remember_lid_jid_pair',
            outcome: 'error',
            level: 'warn',
            call_jid: normalizedJid,
            reason: error instanceof Error ? error.message : String(error),
          });
        }

        const callUpsert: IUpsertMessage = {
          worker_id: baileysEnvironment.baileysWorkerId,
          account_id: baileysEnvironment.baileysAccountId,
          type: EMessageType.system,
          message: {
            key: {
              id: `call_${callId}`,
              remoteJid: normalizedJid,
              remoteJidAlt: normalizedJidAlt ?? undefined,
              fromMe: false,
            },
            message: {
              conversation: callText,
            },
            messageTimestamp: this.getCallTimestampSeconds(callEvent),
            pushName: callEvent.callerPn ?? null,
          },
          photo: null,
          has_quoted: false,
          is_call_event: true,
          call_phone: callPhone,
          call_jid: normalizedJid,
          call_jid_alt: normalizedJidAlt,
          call_name: callEvent.callerPn ?? null,
        };

        const photo = await this.resolvePhotoForUpsert(
          socket,
          {
            inputUpsert: callUpsert,
            messageKey: callKey,
            topic: this.kafkaServiceQueueService.upsertMessage(),
            retries: 0,
            addedAt: Date.now(),
          },
          callJid
        );
        callPhoto = photo ?? null;
        callUpsert.photo = callPhoto;
        void this.enqueueMessage(callUpsert, callKey);
      } else {
        console.warn(
          '[WARN] Call event without phone, skipping call upsert only:',
          callJid
        );
      }

      const callAction =
        await this.balanceWorkerStatusGrpcClientService.resolveIncomingCallAction(
          {
            worker_id: baileysEnvironment.baileysWorkerId,
            account_id: baileysEnvironment.baileysAccountId,
            call_jid: callJid,
            call_phone: callPhone ?? '',
            is_video: isVideo,
          }
        );

      if (callAction.reject_call && callEvent.id) {
        socket.rejectCall(callEvent.id, callJid).catch(() => {});
      }

      const text = callAction.show_message_text?.trim();
      if (callAction.show_message_on_call && text) {
        const callIdentity = callEvent.id?.trim() || callKey;
        const canSendAutoReply =
          await this.acquireCallAutoReplySendAttempt(callIdentity);
        if (!canSendAutoReply) {
          return;
        }

        const sentMessage = await this.sendMessageWithConfirmation(
          socket,
          callJid,
          { text }
        );
        const sentMessageId =
          sentMessage && typeof sentMessage.key?.id === 'string'
            ? sentMessage.key.id
            : undefined;
        const systemMessageUpsert = this.buildCallAutoReplySystemUpsert(
          normalizedJid,
          normalizedJidAlt,
          text,
          sentMessageId
        );
        systemMessageUpsert.photo = callPhoto;

        const autoReplyKey = `${callKey}:auto_reply:${sentMessageId ?? Date.now().toString()}`;
        this.enqueueMessage(systemMessageUpsert, autoReplyKey);
      }
    } catch (error) {
      console.error('[CRITICAL] Error processing call event:', error);
    }
  }

  private buildCallAutoReplySystemUpsert(
    remoteJid: string,
    remoteJidAlt: string | null,
    messageText: string,
    sentMessageId?: string
  ): IUpsertMessage {
    const keyId = `call_auto_system_${sentMessageId ?? Date.now().toString()}`;

    return {
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      type: EMessageType.system,
      message: {
        key: {
          id: keyId,
          remoteJid,
          remoteJidAlt: remoteJidAlt ?? undefined,
          fromMe: true,
        },
        message: {
          conversation: messageText,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      photo: null,
      has_quoted: false,
    };
  }

  private async handleMessagesUpdate(events: WAMessageUpdate[]) {
    if (!events?.length) return;

    for (const event of events) {
      if (!event.update?.message) continue;

      const updateMessage = {
        key: event.key,
        message: event.update.message,
      } as WAMessage;
      this.logIncomingProviderPayloadDebug(
        'messages.update.with_message_payload',
        event,
        {
          mapped_type: mapIncomingToType(updateMessage) ?? null,
          message_id: event.key?.id,
          remote_jid: event.key?.remoteJid,
          from_me: event.key?.fromMe,
          status: event.update.status ?? null,
          has_edit_signal: this.hasIncomingEditSignal(event.update.message),
        }
      );
    }

    const statusPromises = events.map((event) => {
      this.trackDeliveryConfirmation(event.key, event.update?.status);
      const patch = this.mapStatusToPatch(event.update?.status);
      return this.applyStatusPatch(event.key, patch);
    });

    const incomingUpdatePromises = events
      .map((event) => this.buildIncomingMessageFromUpdate(event))
      .filter((message): message is WAMessage => Boolean(message))
      .map((message) => {
        const socket = this.currentSocket;
        if (!socket) return Promise.resolve();

        return this.processIncomingMessage(
          socket,
          message,
          EMessageUpsertType.notify,
          this.kafkaServiceQueueService.upsertMessage()
        );
      });

    await Promise.allSettled([...statusPromises, ...incomingUpdatePromises]);
  }

  private buildIncomingMessageFromUpdate(
    event: WAMessageUpdate
  ): WAMessage | null {
    const updateMessage = event.update?.message as proto.IMessage | undefined;
    if (!updateMessage || !event.key?.id) {
      return null;
    }

    const protocolMessage = this.ensureEditProtocolMessage(
      updateMessage,
      event.key
    );
    if (!protocolMessage) {
      return null;
    }

    const candidate: WAMessage = {
      key: {
        ...event.key,
        id: `edit_${event.key.id}_${Date.now()}`,
      },
      message: updateMessage,
      messageTimestamp: Math.floor(Date.now() / 1000),
    } as WAMessage;

    if (mapIncomingToType(candidate) !== EMessageType.edit_text) {
      return null;
    }

    this.logLifecycle(candidate, {
      stage: 'baileys.event.messages_update',
      decision: 'map_to_edit_upsert',
      outcome: 'mapped',
      message_type: EMessageType.edit_text,
      kafka_key: this.getMessageKey(candidate) ?? undefined,
    });

    return candidate;
  }

  private ensureEditProtocolMessage(
    message: proto.IMessage,
    key: WAMessageKey
  ): proto.Message.IProtocolMessage | null {
    const protocolMessage = this.findEditProtocolMessage(message);
    if (protocolMessage) {
      if (!protocolMessage.key) {
        protocolMessage.key = key as proto.IMessageKey;
      }
      return protocolMessage;
    }

    const editedMessage = this.findEditedMessageContent(message);
    const editedText = this.getEditedTextFromMessage(editedMessage);
    if (!editedMessage || !editedText) {
      return null;
    }

    message.protocolMessage = {
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      key: key as proto.IMessageKey,
      editedMessage: {
        conversation: editedText,
        extendedTextMessage: {
          text: editedText,
        },
      },
    };

    return message.protocolMessage;
  }

  private findEditProtocolMessage(
    message: proto.IMessage
  ): proto.Message.IProtocolMessage | null {
    if (
      message.protocolMessage?.type ===
      proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
    ) {
      return message.protocolMessage;
    }

    const editedMessage = this.getEditedMessageWrapper(message);
    const protocolMessage = editedMessage?.protocolMessage;
    if (
      protocolMessage?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
    ) {
      return protocolMessage;
    }

    return null;
  }

  private getEditedMessageWrapper(
    message: proto.IMessage
  ): proto.IMessage | undefined {
    const editedMessage = (
      message as unknown as {
        editedMessage?: { message?: proto.IMessage } | proto.IMessage;
      }
    ).editedMessage;
    if (!editedMessage) {
      return undefined;
    }

    if (
      typeof editedMessage === 'object' &&
      editedMessage !== null &&
      'message' in editedMessage
    ) {
      return editedMessage.message;
    }

    return editedMessage as proto.IMessage;
  }

  private findEditedMessageContent(
    message: proto.IMessage
  ): proto.IMessage | undefined {
    const protocolMessage = this.findEditProtocolMessage(message);
    if (protocolMessage?.editedMessage) {
      return protocolMessage.editedMessage;
    }

    return this.getEditedMessageWrapper(message);
  }

  private getEditedTextFromMessage(message?: proto.IMessage): string {
    return (
      message?.conversation?.trim() ||
      message?.extendedTextMessage?.text?.trim() ||
      ''
    );
  }

  private trackDeliveryConfirmation(
    key: WAMessageKey | undefined,
    status?: proto.WebMessageInfo.Status | null
  ): void {
    if (!key?.id || !key.fromMe || status === null || status === undefined) {
      return;
    }

    if (status === proto.WebMessageInfo.Status.ERROR) {
      this.deliveryConfirmation.markFailed(key.id);
      return;
    }

    if (status >= proto.WebMessageInfo.Status.SERVER_ACK) {
      this.deliveryConfirmation.markSent(key.id);
    }
  }

  private async handleMessageReceiptUpdate(events: MessageUserReceiptUpdate[]) {
    if (!events?.length) return;

    const promises = events.map((event) => {
      const patch = this.mapReceiptToPatch(event.receipt);
      if (patch && event.key?.id && event.key.fromMe) {
        this.deliveryConfirmation.markSent(event.key.id);
      }
      return this.applyStatusPatch(event.key, patch);
    });

    await Promise.allSettled(promises);
  }

  private mapStatusToPatch(
    status?: proto.WebMessageInfo.Status | null
  ): MessageSummaryPatch | null {
    if (status === null || status === undefined) {
      return null;
    }

    switch (status) {
      case proto.WebMessageInfo.Status.SERVER_ACK:
        return { is_sent: true };
      case proto.WebMessageInfo.Status.DELIVERY_ACK:
        return { is_sent: true, is_delivered: true };
      case proto.WebMessageInfo.Status.READ:
      case proto.WebMessageInfo.Status.PLAYED:
        return { is_sent: true, is_delivered: true, is_seen: true };
      default:
        return null;
    }
  }

  private mapReceiptToPatch(
    receipt?: MessageUserReceiptUpdate['receipt']
  ): MessageSummaryPatch | null {
    if (!receipt) return null;

    const patch: MessageSummaryPatch = {};

    if (receipt.readTimestamp || receipt.playedTimestamp) {
      patch.is_seen = true;
      patch.is_delivered = true;
    }

    if (receipt.receiptTimestamp) {
      patch.is_delivered = true;
    }

    if (!patch.is_seen && !patch.is_delivered) {
      return null;
    }

    patch.is_sent = true;
    return patch;
  }

  private async applyStatusPatch(
    key: WAMessageKey | undefined,
    patch: MessageSummaryPatch | null
  ) {
    if (!patch || !key?.id || !key.fromMe) {
      return;
    }

    try {
      const statusUpdate: IMessageStatusUpdate = {
        account_id: baileysEnvironment.baileysAccountId,
        message_id: key.id,
        patch,
        key,
      };

      const kafkaKey = MessageStatusService.statusKafkaKey(
        baileysEnvironment.baileysAccountId,
        key.id
      );
      const topic = this.kafkaServiceQueueService.updateMessageStatus();

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.streamProducerService.send(topic, statusUpdate, kafkaKey);
          return;
        } catch {
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
          }
        }
      }
    } catch {}
  }

  isBoundTo(socket?: WASocket): boolean {
    if (!this.currentSocket) {
      return false;
    }

    return socket ? this.currentSocket === socket : true;
  }

  unbind() {
    if (!this.currentSocket) return;
    try {
      this.currentSocket.ev.removeAllListeners('messages.upsert');
      this.currentSocket.ev.removeAllListeners('messaging-history.set');
      this.currentSocket.ev.removeAllListeners('messages.update');
      this.currentSocket.ev.removeAllListeners('message-receipt.update');
      this.currentSocket.ev.removeAllListeners('contacts.upsert');
      this.currentSocket.ev.removeAllListeners('contacts.update');
      this.currentSocket.ev.removeAllListeners('presence.update');
      this.currentSocket.ev.removeAllListeners('call');
    } catch {}
    this.currentSocket = undefined;
  }

  async destroy(): Promise<void> {
    this.isDestroying = true;
    this.unbind();
    this.stopCleanupInterval();

    if (this.pendingQueue.length > 0) {
      const startTime = Date.now();
      while (
        this.pendingQueue.length > 0 &&
        Date.now() - startTime < this.DESTROY_TIMEOUT_MS
      ) {
        await this.processRetryQueue();
        if (this.pendingQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    this.stopQueueProcessor();
    this.processedMessages.clear();
    this.processedCalls.clear();
    this.pendingQueue.length = 0;
  }

  getPendingQueueSize(): number {
    return this.pendingQueue.length;
  }

  async markRead(keys: WAMessageKey[]) {
    if (!this.currentSocket) {
      return;
    }

    await this.currentSocket.readMessages(keys);
  }

  async sendAckTyping(jid: string) {
    if (!this.currentSocket) {
      throw new Error('Socket not connected');
    }

    await this.currentSocket.sendPresenceUpdate('composing', jid);
  }

  async sendAckPaused(jid: string) {
    if (!this.currentSocket) {
      throw new Error('Socket not connected');
    }

    await this.currentSocket.sendPresenceUpdate('paused', jid);
  }

  private async sendMessageWithConfirmation(
    socket: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: {
      quoted?: WAMessage;
    }
  ): Promise<WAMessage> {
    const sentMessage = await socket.sendMessage(jid, content, options);
    const sentMessageId = sentMessage?.key?.id;
    if (!sentMessageId) {
      throw new Error('Baileys send returned message without key.id');
    }

    const outcome = await this.deliveryConfirmation.waitForOutcome(
      sentMessageId,
      this.SEND_CONFIRMATION_TIMEOUT_MS
    );

    if (outcome === 'sent') {
      return sentMessage;
    }

    const lastOutcome = outcome === 'failed' ? 'failed' : 'timeout';
    const confirmationError =
      outcome === 'failed'
        ? new Error(
            `Message delivery failed acknowledgement for ${sentMessageId}`
          )
        : new Error(
            `Message delivery confirmation timeout for ${sentMessageId}`
          );

    throw new MessageDeliveryConfirmationFailedError({
      maxAttempts: this.SEND_CONFIRMATION_MAX_ATTEMPTS,
      lastMessageId: sentMessageId,
      lastOutcome,
      cause: confirmationError,
    });
  }

  async reply(jid: string, quoted: WAMessage, content: AnyMessageContent) {
    if (!this.currentSocket) {
      throw new Error('Socket not connected');
    }

    return this.sendMessageWithConfirmation(this.currentSocket, jid, content, {
      quoted,
    });
  }

  updateRejectCallConfig(rejectCall: boolean): void {
    this.rejectCallConfig = rejectCall;
  }
}
