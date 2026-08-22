import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { Buffer } from 'node:buffer';
import { inspect } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
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
import { unwrapMessage } from '@core/common/functions/unwrapMessage';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { baileysEnvironment } from '@core/config/environments';
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
import { resolveCallEventJidAndPhone } from '../util/callEventResolver';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import {
  IInboundMessageSpoolScope,
  InboundMessageSpoolService,
} from '@core/services/inboundMessageSpool.service';
import { IInboundMessageSpoolPayload } from '@core/common/interfaces/IInboundMessageSpoolPayload';
import type { IWhatsappRuntimeFenceConnectionAuthorization } from '@core/common/interfaces/IWhatsappRuntimeFenceConnectionAuthorization';
import { LidJidCacheService } from '@core/services/lidJidCache.service';
import { ensureInboundEventId } from '@core/common/functions/inboundEventIdentity';
import { ensureMessageStatusEventId } from '@core/common/functions/messageStatusIdentity';
import {
  IMessageSendAcquiredClaim,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';
import {
  IWhatsappRuntimeFence,
  IWhatsappRuntimeEffectLease,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';
import { resolveHistoryReconciliationConfig } from '@core/common/functions/historyReconciliationConfig';
import { resolveBaileysSendMessageTimeoutMs } from '../util/providerSendTimeout';
import { waitRuntimeFenceRetry } from '@core/common/functions/runtimeFenceRetry';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';
import {
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  isProviderAuxiliaryInvocationFenceError,
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';
import type { IProviderInvocationBoundary } from '@core/common/interfaces/IProviderInvocationBoundary';

const UNSUPPORTED_INCOMING_MESSAGE_TEXT =
  'Mensagem recebida não suportada pelo provedor. Verifique no WhatsApp.';

const SAFE_INCOMING_LOG_STRING_KEYS = new Set([
  'stage',
  'rawtype',
  'rawsubtype',
  'mappedtype',
  'providerupserttype',
  'status',
  'decision',
  'outcome',
  'reason',
]);

function normalizeIncomingLogKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function hashIncomingLogIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `sha256:${createHash('sha256').update(value.trim()).digest('hex')}`;
}

function safeIncomingLogFieldNames(value: Record<string, unknown>): string[] {
  return Object.keys(value)
    .map((key) =>
      /^[a-zA-Z0-9_.:-]{1,80}$/.test(key) ? key : '[invalid-field-name]'
    )
    .sort();
}

function isIncomingLogIdentifierKey(key: string): boolean {
  const normalized = normalizeIncomingLogKey(key);
  if (normalized === 'workerid' || normalized === 'accountid') return false;
  return (
    normalized === 'id' ||
    normalized.endsWith('id') ||
    normalized.endsWith('jid') ||
    normalized.endsWith('key') ||
    normalized === 'from' ||
    normalized === 'to' ||
    normalized === 'author' ||
    normalized === 'participant'
  );
}

function sanitizeIncomingLogValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;

  const normalizedKey = normalizeIncomingLogKey(key);
  if (isIncomingLogIdentifierKey(key)) {
    return hashIncomingLogIdentifier(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (
      normalizedKey === 'workerid' ||
      normalizedKey === 'accountid' ||
      SAFE_INCOMING_LOG_STRING_KEYS.has(normalizedKey)
    ) {
      return value;
    }
    return { kind: 'string', bytes: Buffer.byteLength(value) };
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return { kind: 'binary', bytes: value.byteLength };
  }
  if (Array.isArray(value)) {
    if (
      normalizedKey.endsWith('fields') &&
      value.every((item) => typeof item === 'string')
    ) {
      return value
        .map((item) =>
          /^[a-zA-Z0-9_.:-]{1,80}$/.test(item) ? item : '[invalid-field-name]'
        )
        .sort();
    }
    return { kind: 'array', count: value.length };
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      kind: 'object',
      field_count: Object.keys(record).length,
      fields: safeIncomingLogFieldNames(record),
    };
  }
  return { kind: typeof value };
}

function sanitizeIncomingLogPayload(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sanitizeIncomingLogValue(key, item),
    ])
  );
}

function readBooleanEnv(key: string): boolean {
  const raw = process.env[key];
  if (!raw) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function csvEnvIncludes(key: string, value: string): boolean {
  const raw = process.env[key];
  if (!raw?.trim()) {
    return true;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .some((item) => item === '*' || item === normalizedValue);
}

function isHistoryReconciliationEnabled(): boolean {
  return resolveHistoryReconciliationConfig().enabled;
}
const HISTORY_RECONCILIATION_CONFIG = resolveHistoryReconciliationConfig();
const HISTORY_RECONCILIATION_MESSAGE_LIMIT =
  HISTORY_RECONCILIATION_CONFIG.messageLimit;
const HISTORY_RECONCILIATION_WINDOW_MS = HISTORY_RECONCILIATION_CONFIG.windowMs;
const TERMINAL_RUNTIME_FENCE_GRPC_CODES = new Set([3, 7, 9, 16]);

function isTerminalRuntimeFenceActivationError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  const code =
    error && typeof error === 'object'
      ? Number((error as { code?: unknown }).code)
      : Number.NaN;
  return (
    Number.isSafeInteger(code) && TERMINAL_RUNTIME_FENCE_GRPC_CODES.has(code)
  );
}

interface ProcessIncomingOptions {
  allowHistoricalUpsert?: boolean;
  fromHistorySync?: boolean;
}

interface BaileysConnectionScope extends IInboundMessageSpoolScope {
  activatedAt: number;
  activationOrder: number;
  connectionSequence: number;
  connectionAttemptId?: string;
  activation: Promise<boolean>;
}

function getWAMessageTimestampMs(
  message: WAMessage | null | undefined
): number | null {
  if (!message) {
    return null;
  }

  const raw: unknown = message.messageTimestamp;
  if (raw === null || raw === undefined) {
    return null;
  }

  let value: number;
  if (
    typeof raw === 'object' &&
    raw &&
    'toNumber' in raw &&
    typeof (raw as { toNumber?: unknown }).toNumber === 'function'
  ) {
    value = (raw as { toNumber: () => number }).toNumber();
  } else if (typeof raw === 'object' && raw) {
    const serialized = raw as {
      low?: unknown;
      high?: unknown;
      unsigned?: unknown;
    };
    const low = Number(serialized.low);
    const high = Number(serialized.high);
    const isInt32Word = (word: number) =>
      Number.isInteger(word) && word >= -0x80000000 && word <= 0xffffffff;
    if (!isInt32Word(low) || !isInt32Word(high)) {
      return null;
    }
    value =
      (serialized.unsigned === true ? high >>> 0 : high | 0) * 0x100000000 +
      (low >>> 0);
  } else {
    value = Number(raw);
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;
  private currentConnectionAuthorization?: IWhatsappRuntimeFenceConnectionAuthorization;
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
  private activeConnectionScope: BaileysConnectionScope | undefined;
  private runtimeFenceTransition: Promise<void> = Promise.resolve();
  private readonly connectionScopeStorage =
    new AsyncLocalStorage<BaileysConnectionScope>();

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
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;
  private readonly SEND_MESSAGE_TIMEOUT_MS =
    resolveBaileysSendMessageTimeoutMs();
  private readonly AUXILIARY_PROVIDER_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();
  private readonly auxiliaryProviderInvocationFence =
    new ProviderInvocationSingleFlight();
  private auxiliaryProviderFailureRecovery:
    | ((
        socket: WASocket,
        error: unknown,
        options: { timedOut: boolean }
      ) => void)
    | undefined;
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
    @inject(MessageSendIdempotencyService)
    private readonly messageSendIdempotencyService: MessageSendIdempotencyService,
    @inject(InboundMessageSpoolService)
    private readonly inboundMessageSpoolService: InboundMessageSpoolService = {
      startPublisher: () => undefined,
      stopPublisher: async () => undefined,
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
    } as unknown as LidJidCacheService,
    @inject(WhatsappRuntimeFenceService)
    private readonly whatsappRuntimeFenceService: WhatsappRuntimeFenceService = new WhatsappRuntimeFenceService(
      redis
    )
  ) {
    this.startCleanupInterval();
    this.startQueueProcessor();
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

  private shouldLogIncomingRawDebug(): boolean {
    const enabled =
      readBooleanEnv('MESSAGE_DEBUG_ENABLED') ||
      readBooleanEnv('BAILEYS_INCOMING_DEBUG_RAW');

    return (
      enabled &&
      csvEnvIncludes(
        'MESSAGE_DEBUG_ACCOUNT_IDS',
        baileysEnvironment.baileysAccountId
      ) &&
      csvEnvIncludes(
        'MESSAGE_DEBUG_WORKER_IDS',
        baileysEnvironment.baileysWorkerId
      )
    );
  }

  private getIncomingMessageFieldNames(m: WAMessage): string[] {
    const message = m.message;
    if (!message || typeof message !== 'object') {
      return [];
    }

    return Object.keys(message).sort();
  }

  private getIncomingMessageTextByteLength(m: WAMessage): number | null {
    const message = m.message as proto.IMessage | undefined;
    if (!message) {
      return null;
    }

    const base = unwrapMessage(message, { keepViewOnce: true }) ?? message;
    const raw = base as Record<string, any>;
    const text =
      base.conversation ||
      base.extendedTextMessage?.text ||
      raw.buttonsMessage?.contentText ||
      raw.buttonsResponseMessage?.selectedDisplayText ||
      raw.listMessage?.description ||
      raw.listResponseMessage?.title ||
      raw.templateMessage?.hydratedTemplate?.hydratedContentText ||
      raw.interactiveMessage?.body?.text ||
      null;

    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }

    return Buffer.byteLength(text.trim());
  }

  private logIncomingMessageSummary(
    stage: string,
    m: WAMessage,
    meta: Record<string, unknown> = {}
  ): void {
    console.info(
      '[BAILEYS_INCOMING_SUMMARY]',
      this.inspectDebugPayload(
        sanitizeIncomingLogPayload({
          stage,
          worker_id: baileysEnvironment.baileysWorkerId,
          account_id: baileysEnvironment.baileysAccountId,
          message_id: m.key?.id ?? null,
          remote_jid: m.key?.remoteJid ?? null,
          remote_jid_alt: (
            m.key as { remoteJidAlt?: string | null } | undefined
          )?.remoteJidAlt,
          from_me: m.key?.fromMe ?? null,
          message_fields: this.getIncomingMessageFieldNames(m),
          text_bytes: this.getIncomingMessageTextByteLength(m),
          ...meta,
        })
      )
    );
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

  private isRawSecretEncryptedMessageEdit(m: WAMessage): boolean {
    const secretEncryptedMessage = m.message?.secretEncryptedMessage;
    return (
      secretEncryptedMessage?.secretEncType ===
      proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
    );
  }

  private logIncomingProviderPayloadDebug(
    stage: string,
    payload: unknown,
    meta: Record<string, unknown> = {}
  ): void {
    console.log(
      '[BAILEYS_INCOMING_DEBUG]',
      this.inspectDebugPayload(
        sanitizeIncomingLogPayload({
          stage,
          worker_id: baileysEnvironment.baileysWorkerId,
          account_id: baileysEnvironment.baileysAccountId,
          ...meta,
          payload,
        })
      )
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
      console.error(
        '[CRITICAL] Error in processRetryQueue:',
        workerErrorDiagnostics(error)
      );

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
    const message = item.inputUpsert.message as WAMessage | undefined;

    this.logLifecycle(message, {
      stage: 'baileys.queue.discard',
      decision: 'discard_after_retry',
      outcome: 'discarded',
      reason,
      level: 'error',
      topic: item.topic,
      kafka_key_hash: hashIncomingLogIdentifier(
        item.kafkaKey ?? item.messageKey
      ),
      retry_count: item.retries,
      max_retries: this.MAX_RETRIES,
      queue_size: this.pendingQueue.length,
      ...(error ? workerErrorDiagnostics(error) : {}),
    });

    console.error('[BaileysIncoming] Discarding pending message:', {
      reason,
      topic: item.topic,
      kafka_key_hash: hashIncomingLogIdentifier(
        item.kafkaKey ?? item.messageKey
      ),
      message_key_hash: hashIncomingLogIdentifier(item.messageKey),
      account_id: item.inputUpsert.account_id,
      worker_id: item.inputUpsert.worker_id,
      message_key_id_hash: hashIncomingLogIdentifier(
        item.inputUpsert.message?.key?.id
      ),
      retries: item.retries,
      max_retries: this.MAX_RETRIES,
      ...(error ? workerErrorDiagnostics(error) : {}),
    });
  }

  private activateConnectionScope(): BaileysConnectionScope {
    const runtimeGeneration = Number(baileysEnvironment.runtimeGeneration);
    const authorization = this.currentConnectionAuthorization;
    const scope = {
      runtimeGeneration,
      connectionEpoch: authorization?.connection_epoch ?? randomUUID(),
      connectionAttemptId: authorization?.connection_attempt_id,
      activationOrder: 0,
      connectionSequence: 0,
      activatedAt: Date.now(),
    } as BaileysConnectionScope;

    this.activeConnectionScope = scope;
    scope.activation =
      Number.isSafeInteger(runtimeGeneration) && runtimeGeneration > 0
        ? this.enqueueRuntimeFenceTransition(async () => {
            if (this.activeConnectionScope !== scope) {
              return false;
            }

            let retryDelayMs = 100;
            let durableActivation:
              | {
                  connection_sequence: number;
                }
              | undefined;
            while (this.activeConnectionScope === scope) {
              let begin;
              try {
                begin = await this.whatsappRuntimeFenceService.beginActivation({
                  worker_id: baileysEnvironment.baileysWorkerId,
                  runtime_generation: runtimeGeneration,
                  connection_epoch: scope.connectionEpoch,
                  source_provider: 'baileys',
                });
              } catch {
                await waitRuntimeFenceRetry(retryDelayMs);
                retryDelayMs = Math.min(retryDelayMs * 2, 2000);
                continue;
              }

              if (this.activeConnectionScope !== scope) {
                await this.whatsappRuntimeFenceService.deactivate(
                  baileysEnvironment.baileysWorkerId,
                  runtimeGeneration,
                  scope.connectionEpoch
                );
                return false;
              }
              if (begin.status === 'superseded') {
                return false;
              }
              scope.activationOrder = begin.activation_order;
              if (begin.activated_at > 0) {
                scope.activatedAt = begin.activated_at;
              }
              if (begin.status === 'active') {
                scope.connectionSequence = begin.connection_sequence;
                break;
              }
              if (begin.status === 'waiting' || begin.status === 'draining') {
                await waitRuntimeFenceRetry(retryDelayMs);
                retryDelayMs = Math.min(retryDelayMs * 2, 2000);
                continue;
              }

              if (!durableActivation) {
                try {
                  durableActivation =
                    await this.balanceWorkerStatusGrpcClientService.activateWhatsappRuntimeFence(
                      {
                        worker_id: baileysEnvironment.baileysWorkerId,
                        account_id: baileysEnvironment.baileysAccountId,
                        source_provider: 'baileys',
                        runtime_generation: runtimeGeneration,
                        connection_epoch: scope.connectionEpoch,
                        connection_attempt_id: scope.connectionAttemptId,
                      }
                    );
                  scope.connectionSequence =
                    durableActivation.connection_sequence;
                } catch (error) {
                  if (isTerminalRuntimeFenceActivationError(error)) {
                    await this.whatsappRuntimeFenceService.deactivate(
                      baileysEnvironment.baileysWorkerId,
                      runtimeGeneration,
                      scope.connectionEpoch
                    );
                    throw error;
                  }
                  await waitRuntimeFenceRetry(retryDelayMs);
                  retryDelayMs = Math.min(retryDelayMs * 2, 2000);
                  continue;
                }
              }

              if (this.activeConnectionScope !== scope) {
                await this.whatsappRuntimeFenceService.deactivate(
                  baileysEnvironment.baileysWorkerId,
                  runtimeGeneration,
                  scope.connectionEpoch
                );
                return false;
              }

              try {
                const finalized =
                  await this.whatsappRuntimeFenceService.finalizeActivation({
                    worker_id: baileysEnvironment.baileysWorkerId,
                    runtime_generation: runtimeGeneration,
                    connection_epoch: scope.connectionEpoch,
                    connection_sequence: scope.connectionSequence,
                    source_provider: 'baileys',
                    activation_order: scope.activationOrder,
                  });
                if (finalized) {
                  break;
                }
              } catch {
                // The exact epoch is retried. Until finalize succeeds, Redis
                // intentionally rejects every fenced side effect.
              }

              if (this.activeConnectionScope === scope) {
                await waitRuntimeFenceRetry(retryDelayMs);
                retryDelayMs = Math.min(retryDelayMs * 2, 2000);
              }
            }
            if (
              this.activeConnectionScope !== scope ||
              scope.connectionSequence <= 0 ||
              scope.activationOrder <= 0
            ) {
              return false;
            }

            const view = (
              this.whatsappRuntimeFenceService as unknown as {
                view?: (
                  workerId: string
                ) => Promise<IWhatsappRuntimeFence | null>;
              }
            ).view;
            if (!view) {
              return true;
            }

            const activeFence = await view.call(
              this.whatsappRuntimeFenceService,
              baileysEnvironment.baileysWorkerId
            );
            if (
              activeFence?.runtime_generation !== runtimeGeneration ||
              activeFence.connection_epoch !== scope.connectionEpoch ||
              activeFence.connection_sequence !== scope.connectionSequence ||
              activeFence.activation_order !== scope.activationOrder ||
              activeFence.state !== 'active' ||
              activeFence.source_provider !== 'baileys' ||
              this.activeConnectionScope !== scope
            ) {
              await this.whatsappRuntimeFenceService.deactivate(
                baileysEnvironment.baileysWorkerId,
                runtimeGeneration,
                scope.connectionEpoch
              );
              return false;
            }

            scope.activatedAt = activeFence.activated_at;
            return true;
          })
        : Promise.resolve(false);

    void scope.activation
      .then((accepted) => {
        if (accepted && this.activeConnectionScope === scope) {
          const fence: IWhatsappRuntimeFence = {
            worker_id: baileysEnvironment.baileysWorkerId,
            runtime_generation: scope.runtimeGeneration,
            connection_epoch: scope.connectionEpoch,
            connection_sequence: scope.connectionSequence,
            source_provider: 'baileys',
            activated_at: scope.activatedAt,
            state: 'active',
            activation_order: scope.activationOrder,
          };
          this.inboundMessageSpoolService.startPublisher(
            'baileys',
            baileysEnvironment.baileysWorkerId,
            scope,
            (payload) => this.publishSpoolPayload(payload),
            () => this.whatsappRuntimeFenceService.isCurrent(fence)
          );
        } else if (this.activeConnectionScope === scope) {
          void this.inboundMessageSpoolService.stopPublisher(
            'baileys',
            baileysEnvironment.baileysWorkerId,
            scope
          );
        }
      })
      .catch((error) => {
        console.error('[baileys] runtime fence activation failed:', {
          worker_id: baileysEnvironment.baileysWorkerId,
          runtime_generation: scope.runtimeGeneration,
          connection_epoch: scope.connectionEpoch,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.activeConnectionScope === scope) {
          void this.inboundMessageSpoolService.stopPublisher(
            'baileys',
            baileysEnvironment.baileysWorkerId,
            scope
          );
        }
      });
    return scope;
  }

  private stopActiveConnectionScope(): void {
    const scope = this.activeConnectionScope;
    if (!scope) {
      return;
    }
    this.activeConnectionScope = undefined;
    const deactivate = this.enqueueRuntimeFenceTransition(async () => {
      await this.whatsappRuntimeFenceService.deactivate(
        baileysEnvironment.baileysWorkerId,
        scope.runtimeGeneration,
        scope.connectionEpoch
      );
    });
    void Promise.allSettled([
      deactivate,
      this.inboundMessageSpoolService.stopPublisher(
        'baileys',
        baileysEnvironment.baileysWorkerId,
        scope
      ),
    ]);
  }

  private enqueueRuntimeFenceTransition<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const transition = this.runtimeFenceTransition.then(operation, operation);
    this.runtimeFenceTransition = transition.then(
      () => undefined,
      () => undefined
    );
    return transition;
  }

  private async prepareFencedPayload(
    payload: unknown,
    previouslyAcceptedSpoolPayload = false
  ): Promise<boolean> {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }

    const record = payload as Record<string, unknown>;
    const payloadGeneration = Number(record.runtime_generation);
    const payloadEpoch =
      typeof record.connection_epoch === 'string'
        ? record.connection_epoch.trim()
        : '';
    const contextualScope =
      this.connectionScopeStorage.getStore() ?? this.activeConnectionScope;
    const scope =
      Number.isSafeInteger(payloadGeneration) &&
      payloadGeneration > 0 &&
      payloadEpoch
        ? {
            runtimeGeneration: payloadGeneration,
            connectionEpoch: payloadEpoch,
          }
        : contextualScope;
    const active = this.activeConnectionScope;

    if (
      !scope ||
      !active ||
      scope.runtimeGeneration !== active.runtimeGeneration ||
      scope.connectionEpoch !== active.connectionEpoch
    ) {
      return false;
    }

    record.source_provider = 'baileys';
    record.runtime_generation = String(scope.runtimeGeneration);
    record.connection_epoch = scope.connectionEpoch;

    if (!(await active.activation)) {
      return false;
    }

    const envelope = record.message;
    if (
      !previouslyAcceptedSpoolPayload &&
      typeof envelope === 'object' &&
      envelope !== null
    ) {
      const timestampMs = getWAMessageTimestampMs(envelope as WAMessage) ?? 0;
      // WhatsApp timestamps frequently have only second precision. Discard the
      // complete activation second so a pre-connection event cannot be
      // rounded into the current connection.
      const connectionCutoffMs =
        (Math.floor(active.activatedAt / 1000) + 1) * 1000;
      if (record.from_history_sync === true) {
        if (
          timestampMs <= 0 ||
          timestampMs < Date.now() - HISTORY_RECONCILIATION_WINDOW_MS
        ) {
          return false;
        }
      } else if (timestampMs > 0 && timestampMs < connectionCutoffMs) {
        return false;
      }
    }

    return this.whatsappRuntimeFenceService.isCurrent({
      worker_id: baileysEnvironment.baileysWorkerId,
      runtime_generation: scope.runtimeGeneration,
      connection_epoch: scope.connectionEpoch,
      source_provider: 'baileys',
    });
  }

  private isConnectionScopeCurrent(): Promise<boolean> {
    return this.prepareFencedPayload({});
  }

  public async captureActiveConnectionScope(): Promise<IWhatsappRuntimeFence | null> {
    const active = this.activeConnectionScope;
    if (!active || !(await active.activation)) {
      return null;
    }
    const fence: IWhatsappRuntimeFence = {
      worker_id: baileysEnvironment.baileysWorkerId,
      runtime_generation: active.runtimeGeneration,
      connection_epoch: active.connectionEpoch,
      connection_sequence: active.connectionSequence,
      source_provider: 'baileys',
      activated_at: active.activatedAt,
    };
    return (await this.whatsappRuntimeFenceService.isCurrent(fence))
      ? fence
      : null;
  }

  /**
   * Returns the already-activated durable fence without performing I/O. Status
   * persistence uses this to bind the event to the exact provider connection.
   */
  public getActiveRuntimeFenceIdentity(): {
    connection_epoch: string;
    connection_sequence: number;
  } | null {
    const active = this.activeConnectionScope;
    if (!active || active.connectionSequence <= 0) {
      return null;
    }
    return {
      connection_epoch: active.connectionEpoch,
      connection_sequence: active.connectionSequence,
    };
  }

  public async acquireActiveRuntimeEffectLease(): Promise<IWhatsappRuntimeEffectLease | null> {
    const active = this.activeConnectionScope;
    if (!active || !(await active.activation)) {
      return null;
    }
    if (this.activeConnectionScope !== active) {
      return null;
    }
    return this.whatsappRuntimeFenceService.acquireEffectLease({
      worker_id: baileysEnvironment.baileysWorkerId,
      runtime_generation: active.runtimeGeneration,
      connection_epoch: active.connectionEpoch,
      source_provider: 'baileys',
    });
  }

  private async runWithRuntimeEffectLease<T>(
    payload: unknown,
    operation: () => Promise<T>,
    previouslyAcceptedSpoolPayload = false
  ): Promise<{ executed: boolean; value?: T }> {
    if (
      !(await this.prepareFencedPayload(
        payload,
        previouslyAcceptedSpoolPayload
      ))
    ) {
      return { executed: false };
    }
    const lease = await this.whatsappRuntimeFenceService.acquireEffectLease(
      payload as IWhatsappRuntimeFence
    );
    if (!lease) {
      return { executed: false };
    }
    try {
      lease.assertOwned();
      return { executed: true, value: await operation() };
    } finally {
      await lease.release().catch((error) => {
        console.error(
          '[baileys] Failed to release runtime effect lease; TTL cleanup will fence cutover',
          error
        );
      });
    }
  }

  private async publishSpoolPayload(
    payload: IInboundMessageSpoolPayload
  ): Promise<void> {
    const active = this.activeConnectionScope;
    if (
      !active ||
      !(await active.activation) ||
      this.activeConnectionScope !== active
    ) {
      throw new Error('baileys_inbound_spool_without_active_runtime');
    }

    const replayingPreviousRuntime =
      Number(payload.runtime_generation) !== active.runtimeGeneration ||
      payload.connection_epoch !== active.connectionEpoch ||
      payload.source_provider !== 'baileys';
    const upsert: IUpsertMessage = {
      ...payload.upsert,
      source_provider: 'baileys',
      runtime_generation: String(active.runtimeGeneration),
      connection_epoch: active.connectionEpoch,
      ...(replayingPreviousRuntime ? { from_history_sync: true } : {}),
    };
    ensureInboundEventId(upsert);

    const item: IBaileysPendingMessage = {
      inputUpsert: upsert,
      messageKey: payload.dedupe_key,
      kafkaKey: payload.kafka_key,
      topic: payload.kafka_topic,
      retries: payload.attempts,
      addedAt: Date.now(),
    };

    // Every durable spool record already passed the provider timestamp and
    // runtime checks before it was persisted. Reapplying the history window
    // after a long Kafka outage would turn at-least-once delivery into data
    // loss, so replay only revalidates the active runtime fence and effect
    // lease. The deterministic event id keeps the downstream replay
    // idempotent.
    if (!(await this.sendToKafkaWithRetry(item, true))) {
      throw new Error('baileys_inbound_spool_runtime_lease_revoked');
    }
  }

  private async sendToKafkaWithRetry(
    item: IBaileysPendingMessage,
    previouslyAcceptedSpoolPayload = false
  ): Promise<boolean> {
    if (
      !(await this.prepareFencedPayload(
        item.inputUpsert,
        previouslyAcceptedSpoolPayload
      ))
    ) {
      return false;
    }
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
      const publish = await this.runWithRuntimeEffectLease(
        item.inputUpsert,
        () =>
          this.streamProducerService.send(
            item.topic,
            item.inputUpsert,
            kafkaKey
          ),
        previouslyAcceptedSpoolPayload
      );
      if (!publish.executed) {
        return false;
      }

      this.logLifecycle(item.inputUpsert.message as WAMessage, {
        stage: 'baileys.kafka.publish.success',
        decision: 'publish_to_kafka',
        outcome: 'published',
        topic: item.topic,
        kafka_key: kafkaKey,
        retry_count: item.retries,
      });
      return true;
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
    if (!(await this.prepareFencedPayload(inputUpsert))) {
      return false;
    }
    const eventId = ensureInboundEventId(inputUpsert);
    if (this.isDestroying) {
      this.logLifecycle(inputUpsert.message as WAMessage, {
        stage: 'baileys.queue.enqueue',
        decision: 'enqueue',
        outcome: 'accepted',
        reason: 'destroying_but_spooled',
        topic,
        kafka_key_hash: hashIncomingLogIdentifier(messageKey),
      });
    }

    const kafkaKey = buildUpsertMessageKafkaKey(inputUpsert, messageKey);
    const connectionEpoch = inputUpsert.connection_epoch?.trim();
    if (!connectionEpoch) {
      throw new TypeError('Baileys upsert is missing a connection epoch');
    }
    const payload: IInboundMessageSpoolPayload = {
      provider: 'baileys',
      source_provider: 'baileys',
      account_id: inputUpsert.account_id,
      worker_id: inputUpsert.worker_id,
      runtime_generation: String(inputUpsert.runtime_generation),
      connection_epoch: connectionEpoch,
      event_source: inputUpsert.from_history_sync
        ? 'history_reconciliation_upsert'
        : 'incoming_upsert',
      dedupe_key: eventId ?? messageKey,
      kafka_topic: topic,
      kafka_key: kafkaKey,
      upsert: inputUpsert,
      raw_meta: {
        message_key_id: inputUpsert.message?.key?.id,
        event_id: eventId,
        type: inputUpsert.type,
      },
      received_at: new Date().toISOString(),
      attempts: 0,
    };
    const spool = await this.runWithRuntimeEffectLease(inputUpsert, () =>
      this.inboundMessageSpoolService.publish(payload, (spooledPayload) =>
        this.publishSpoolPayload(spooledPayload)
      )
    );
    const accepted = spool.executed && spool.value === true;
    this.logLifecycle(inputUpsert.message as WAMessage, {
      stage: 'baileys.queue.enqueue',
      decision: 'enqueue',
      outcome: accepted ? 'queued' : 'rejected',
      topic,
      kafka_key: kafkaKey,
    });
    return accepted;
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

  bindTo(
    socket: WASocket,
    authorization?: IWhatsappRuntimeFenceConnectionAuthorization
  ) {
    if (this.currentSocket === socket) return;

    this.unbind();
    const connectionEpoch = authorization?.connection_epoch.trim();
    const connectionAttemptId = authorization?.connection_attempt_id?.trim();
    if (authorization && !connectionEpoch) {
      throw new TypeError('baileys_runtime_fence_authorization_invalid');
    }
    this.currentConnectionAuthorization = connectionEpoch
      ? {
          connection_epoch: connectionEpoch,
          connection_attempt_id: connectionAttemptId || undefined,
        }
      : undefined;
    this.currentSocket = socket;
    const scoped = <TArgs extends unknown[]>(
      listener: (...args: TArgs) => void
    ): ((...args: TArgs) => void) => {
      return (...args: TArgs) => {
        const connectionScope = this.activeConnectionScope;
        if (!connectionScope || this.currentSocket !== socket) {
          return;
        }

        this.connectionScopeStorage.run(connectionScope, () =>
          listener(...args)
        );
      };
    };

    socket.ev.on(
      'messages.upsert',
      scoped((e) => {
        if (!e?.messages?.length) return;

        const isHistoryUpsert = e.type && e.type !== EMessageUpsertType.notify;

        const messages = isHistoryUpsert
          ? this.selectLatestHistoryMessages(e.messages)
          : e.messages;

        for (const m of messages) {
          const mappedType = mapIncomingToType(m) ?? null;
          this.logIncomingMessageSummary('messages.upsert.message', m, {
            provider_upsert_type: e.type ?? null,
            selected_from_history: Boolean(isHistoryUpsert),
            mapped_type: mappedType,
          });
          if (this.shouldLogIncomingRawDebug()) {
            this.logIncomingProviderPayloadDebug(
              'messages.upsert.message_raw',
              m,
              {
                provider_upsert_type: e.type ?? null,
                selected_from_history: Boolean(isHistoryUpsert),
                mapped_type: mappedType,
              }
            );
          }
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
      })
    );

    socket.ev.on(
      'messaging-history.set',
      scoped((event) => {
        if (!isHistoryReconciliationEnabled()) {
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
      })
    );

    socket.ev.on(
      'contacts.upsert',
      scoped((contacts) => {
        if (!Array.isArray(contacts) || contacts.length === 0) return;
        this.upsertContactNames(contacts);
      })
    );

    socket.ev.on(
      'contacts.update',
      scoped((contacts) => {
        if (!Array.isArray(contacts) || contacts.length === 0) return;
        this.upsertContactNames(contacts as Array<Contact | Partial<Contact>>);
      })
    );

    socket.ev.on(
      'messages.update',
      scoped((events) => {
        void this.handleMessagesUpdate(events);
      })
    );

    socket.ev.on(
      'message-receipt.update',
      scoped((events) => {
        void this.handleMessageReceiptUpdate(events);
      })
    );

    socket.ev.on(
      'presence.update',
      scoped((data) => {
        void this.handlePresenceUpdate(data);
      })
    );

    socket.ev.on(
      'call',
      scoped((callEvents: WACallEvent[]) => {
        if (!callEvents) return;

        const eventsArray = Array.isArray(callEvents)
          ? callEvents
          : [callEvents];

        for (const callEvent of eventsArray) {
          void this.processCallEvent(socket, callEvent);
        }
      })
    );
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
    if (!isHistoryReconciliationEnabled() || !m) {
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
      timestampMs < Date.now() - HISTORY_RECONCILIATION_WINDOW_MS
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
        console.warn('[WARN] Message without key, skipping', {
          message_id_hash: hashIncomingLogIdentifier(m.key?.id),
        });
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'message_key',
          outcome: 'skipped',
          reason: 'missing_message_key',
        });
        return;
      }

      if (this.isRawSecretEncryptedMessageEdit(m)) {
        this.logLifecycle(m, {
          stage: 'baileys.incoming.skip',
          decision: 'message_type_mapping',
          outcome: 'skipped',
          reason: 'raw_secret_encrypted_message_edit',
          kafka_key_hash: hashIncomingLogIdentifier(messageKey),
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
          '[WARN] Unknown message type, publishing system fallback',
          { message_key_hash: hashIncomingLogIdentifier(messageKey) }
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
          kafka_key_hash: hashIncomingLogIdentifier(messageKey),
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
            reason: 'inbound_spool_failed',
            ...workerErrorDiagnostics(error),
            topic,
            kafka_key_hash: hashIncomingLogIdentifier(messageKey),
          });
          console.error('[BaileysIncoming] Failed to spool incoming message:', {
            topic,
            kafka_key_hash: hashIncomingLogIdentifier(messageKey),
            account_id: inputUpsert.account_id,
            worker_id: inputUpsert.worker_id,
            ...workerErrorDiagnostics(error),
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
        kafka_key_hash: hashIncomingLogIdentifier(messageKey),
      });
    } catch (error) {
      console.error('[CRITICAL] Error processing message:', {
        message_id_hash: hashIncomingLogIdentifier(m.key?.id),
        ...workerErrorDiagnostics(error),
      });
      this.logLifecycle(m, {
        stage: 'baileys.incoming.error',
        decision: 'process_incoming',
        outcome: 'error',
        level: 'error',
        reason: 'incoming_processing_failed',
        ...workerErrorDiagnostics(error),
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
            candidate_hash: hashIncomingLogIdentifier(candidate),
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

  private async fetchPhotoByCandidates(
    socket: WASocket,
    candidates: string[]
  ): Promise<string | undefined> {
    const results = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          return this.toNonEmptyString(
            await this.invokeAuxiliaryProvider(
              socket,
              'incoming_profile_photo_lookup',
              () => socket.profilePictureUrl(candidate, 'image'),
              undefined,
              this.PROFILE_PIC_TIMEOUT_MS
            )
          );
        } catch (error) {
          if (isProviderAuxiliaryInvocationFenceError(error)) {
            throw error;
          }
          return undefined;
        }
      })
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
    const lease = await this.acquireActiveRuntimeEffectLease().catch(
      (error) => {
        console.error(
          '[baileys] Failed to acquire presence runtime effect lease',
          error
        );
        return null;
      }
    );
    if (!lease) {
      return;
    }

    try {
      lease.assertOwned();
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

        if (!(await this.isConnectionScopeCurrent())) {
          return;
        }

        await this.centrifugoService.publishSub(
          chatAccountCentrifugo(baileysEnvironment.baileysAccountId),
          typingEvent
        );
      }
    } catch {
      return;
    } finally {
      await lease.release().catch((error) => {
        console.error(
          '[baileys] Failed to release presence runtime effect lease',
          error
        );
      });
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

  private getCallAutoReplyOperationId(callId?: string | null): string | null {
    const normalizedCallId = callId?.trim();
    if (!normalizedCallId) {
      return null;
    }

    return `call-auto-reply:${baileysEnvironment.baileysWorkerId}:${normalizedCallId}`;
  }

  private getCallAutoReplyRecoveryResult(result: unknown): {
    upsert: IUpsertMessage;
    kafkaKey: string;
  } | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    const stored = result as {
      call_auto_reply_system_upsert?: unknown;
      kafka_key?: unknown;
    };
    const upsert = stored.call_auto_reply_system_upsert;
    if (
      !upsert ||
      typeof upsert !== 'object' ||
      !('worker_id' in upsert) ||
      !('account_id' in upsert) ||
      !('type' in upsert) ||
      !('message' in upsert)
    ) {
      return null;
    }

    const typedUpsert = upsert as IUpsertMessage;
    const storedKafkaKey =
      typeof stored.kafka_key === 'string' && stored.kafka_key.trim()
        ? stored.kafka_key.trim()
        : null;
    const messageKeyId = typedUpsert.message?.key?.id;
    const kafkaKey = storedKafkaKey ?? messageKeyId;
    if (!kafkaKey) {
      return null;
    }

    return { upsert: typedUpsert, kafkaKey };
  }

  private async recoverSucceededCallAutoReply(result: unknown): Promise<void> {
    const recovery = this.getCallAutoReplyRecoveryResult(result);
    if (!recovery) {
      return;
    }

    await this.enqueueMessage(recovery.upsert, recovery.kafkaKey);
  }

  private async releaseCallAutoReplyReservation(
    claim: IMessageSendAcquiredClaim
  ): Promise<void> {
    await this.messageSendIdempotencyService
      .releaseReservation(claim)
      .catch(() => undefined);
  }

  private async sendCallAutoReply(input: {
    socket: WASocket;
    callId?: string | null;
    callJid: string;
    normalizedJid: string;
    normalizedJidAlt: string | null;
    text: string;
    photo: string | null;
  }): Promise<void> {
    const lease = await this.acquireActiveRuntimeEffectLease();
    if (!lease) {
      return;
    }
    try {
      lease.assertOwned();
      await this.sendCallAutoReplyWithinLease(input, () => lease.assertOwned());
    } finally {
      await lease.release().catch((error) => {
        console.error(
          '[baileys] Failed to release call auto-reply runtime effect lease',
          error
        );
      });
    }
  }

  private async sendCallAutoReplyWithinLease(
    input: {
      socket: WASocket;
      callId?: string | null;
      callJid: string;
      normalizedJid: string;
      normalizedJidAlt: string | null;
      text: string;
      photo: string | null;
    },
    assertEffectLeaseOwned: () => void
  ): Promise<void> {
    const capturedScope =
      this.connectionScopeStorage.getStore() ?? this.activeConnectionScope;
    const assertProviderAuthorityRegistered = (): void => {
      assertEffectLeaseOwned();
      if (
        !capturedScope ||
        this.activeConnectionScope !== capturedScope ||
        this.currentSocket !== input.socket
      ) {
        throw new Error('call_auto_reply_connection_scope_revoked');
      }
    };
    assertProviderAuthorityRegistered();
    if (!(await this.isConnectionScopeCurrent())) {
      return;
    }
    assertProviderAuthorityRegistered();

    const operationId = this.getCallAutoReplyOperationId(input.callId);
    if (!operationId) {
      console.warn(
        '[WARN] Call event without stable call id, skipping auto-reply'
      );
      return;
    }

    const claim = await this.messageSendIdempotencyService.claimOperation({
      accountId: baileysEnvironment.baileysAccountId,
      operationType: 'direct',
      operationId,
      meta: {
        worker_id: baileysEnvironment.baileysWorkerId,
        call_id: input.callId?.trim(),
        source: 'incoming_call_auto_reply',
      },
    });
    if (claim.status === 'error') {
      throw new Error('call_auto_reply_idempotency_error');
    }

    if (claim.status === 'duplicate') {
      if (!(await this.isConnectionScopeCurrent())) {
        return;
      }
      if (claim.state === 'succeeded') {
        await this.recoverSucceededCallAutoReply(claim.result);
      }
      return;
    }

    let providerLifecycleStarted = false;
    let providerInvocationTransitionUncertain = false;
    let providerStartRejected: unknown | null = null;
    let providerInvocationPromise: Promise<void> | null = null;
    let succeeded = false;
    const beforeProviderInvoke: IProviderInvocationBoundary =
      (): Promise<void> => {
        if (providerStartRejected !== null) {
          return Promise.reject(providerStartRejected);
        }
        if (providerLifecycleStarted) {
          return Promise.resolve();
        }
        if (!providerInvocationPromise) {
          providerInvocationPromise = (async () => {
            assertProviderAuthorityRegistered();
            if (!(await this.isConnectionScopeCurrent())) {
              throw new Error('call_auto_reply_connection_scope_revoked');
            }
            assertProviderAuthorityRegistered();
            providerInvocationTransitionUncertain = true;
            const invoked =
              await this.messageSendIdempotencyService.markProviderInvoked(
                claim
              );
            if (invoked !== 'transitioned') {
              throw new Error(`call_auto_reply_idempotency_${invoked}`);
            }
            providerInvocationTransitionUncertain = false;
            providerLifecycleStarted = true;
          })();
        }
        return providerInvocationPromise;
      };
    beforeProviderInvoke.assertActive = (): void => {
      if (providerStartRejected !== null) {
        throw providerStartRejected;
      }
      assertProviderAuthorityRegistered();
      if (!providerLifecycleStarted) {
        throw new Error('call_auto_reply_provider_boundary_not_started');
      }
    };
    beforeProviderInvoke.onStartRejected = async (
      error: unknown
    ): Promise<void> => {
      if (!providerLifecycleStarted) {
        return;
      }
      providerStartRejected = error;
      const reverted =
        await this.messageSendIdempotencyService.revertProviderInvocationBeforeStart(
          claim
        );
      if (reverted !== 'transitioned') {
        throw new Error(
          `call_auto_reply_idempotency_provider_start_revert_${reverted}`
        );
      }
      providerLifecycleStarted = false;
    };

    try {
      const sentMessage = await this.sendMessageWithConfirmation(
        input.socket,
        input.callJid,
        { text: input.text },
        undefined,
        beforeProviderInvoke
      );
      const sentMessageId =
        sentMessage && typeof sentMessage.key?.id === 'string'
          ? sentMessage.key.id
          : undefined;
      const systemMessageUpsert = this.buildCallAutoReplySystemUpsert(
        input.normalizedJid,
        input.normalizedJidAlt,
        input.text,
        sentMessageId
      );
      systemMessageUpsert.photo = input.photo;
      const kafkaKey = systemMessageUpsert.message.key.id;
      if (!kafkaKey) {
        throw new Error('call_auto_reply_missing_system_message_id');
      }

      if (!(await this.prepareFencedPayload(systemMessageUpsert))) {
        throw new Error('call_auto_reply_connection_scope_revoked');
      }

      const persisted = await this.messageSendIdempotencyService.markSucceeded(
        claim,
        {
          schema_version: 'call_auto_reply_system_upsert_recovery_v1',
          provider: 'baileys',
          account_id: baileysEnvironment.baileysAccountId,
          worker_id: baileysEnvironment.baileysWorkerId,
          operation_id: operationId,
          call_auto_reply_system_upsert: systemMessageUpsert,
          kafka_key: kafkaKey,
        }
      );
      if (persisted !== 'transitioned') {
        throw new Error(`call_auto_reply_idempotency_${persisted}`);
      }
      succeeded = true;

      await this.enqueueMessage(systemMessageUpsert, kafkaKey);
    } catch (error) {
      if (providerInvocationTransitionUncertain) {
        // A timeout/disconnect while persisting `provider_invoked` has an
        // unknown durable outcome. Never reopen this operation for replay.
      } else if (!providerLifecycleStarted) {
        await this.releaseCallAutoReplyReservation(claim);
      } else if (!succeeded) {
        await this.messageSendIdempotencyService
          .markAmbiguous(claim, error)
          .catch(() => undefined);
      }
      throw error;
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
    const lease = await this.acquireActiveRuntimeEffectLease().catch(
      (error) => {
        console.error(
          '[baileys] Failed to acquire call-event runtime effect lease',
          error
        );
        return null;
      }
    );
    if (!lease) {
      return;
    }
    try {
      lease.assertOwned();
      await this.processCallEventWithinLease(socket, callEvent);
    } finally {
      await lease.release().catch((error) => {
        console.error(
          '[baileys] Failed to release call-event runtime effect lease',
          error
        );
      });
    }
  }

  private async processCallEventWithinLease(
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
      const stableCallId = callEvent.id?.trim() || null;
      const callId = stableCallId ?? Date.now().toString();
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
          event_revision: stableCallId ?? undefined,
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
          '[WARN] Call event without phone, skipping call upsert only',
          { call_jid_hash: hashIncomingLogIdentifier(callJid) }
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

      const providerCallId = callEvent.id;
      if (callAction.reject_call && providerCallId) {
        if (!(await this.isConnectionScopeCurrent())) {
          return;
        }
        void this.invokeAuxiliaryProvider(socket, 'reject_call', () =>
          socket.rejectCall(providerCallId, callJid)
        ).catch((error) => {
          console.warn('[baileys] reject call provider operation failed', {
            call_id_hash: hashIncomingLogIdentifier(providerCallId),
            call_jid_hash: hashIncomingLogIdentifier(callJid),
            ...workerErrorDiagnostics(error),
          });
        });
      }

      const text = callAction.show_message_text?.trim();
      if (callAction.show_message_on_call && text) {
        if (!(await this.isConnectionScopeCurrent())) {
          return;
        }
        await this.sendCallAutoReply({
          socket,
          callId: callEvent.id,
          callJid,
          normalizedJid,
          normalizedJidAlt,
          text,
          photo: callPhoto,
        });
      }
    } catch (error) {
      console.error('[CRITICAL] Error processing call event', {
        ...workerErrorDiagnostics(error),
      });
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
      },
      message: updateMessage,
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
      void this.applyFailureStatusUpdate(key);
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
        worker_id: baileysEnvironment.baileysWorkerId,
        source_provider: 'baileys',
        message_id: key.id,
        patch,
        key,
      };
      ensureMessageStatusEventId(statusUpdate);

      const kafkaKey = MessageStatusService.statusKafkaKey(
        baileysEnvironment.baileysAccountId,
        key.id,
        baileysEnvironment.baileysWorkerId
      );
      const topic = this.kafkaServiceQueueService.updateMessageStatus();

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const publish = await this.runWithRuntimeEffectLease(
            statusUpdate,
            () => this.streamProducerService.send(topic, statusUpdate, kafkaKey)
          );
          if (!publish.executed) {
            return;
          }
          return;
        } catch {
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
          }
        }
      }
    } catch {}
  }

  private async applyFailureStatusUpdate(
    key: WAMessageKey | undefined
  ): Promise<void> {
    if (!key?.id || !key.fromMe) return;

    const statusUpdate: IMessageStatusUpdate = {
      account_id: baileysEnvironment.baileysAccountId,
      worker_id: baileysEnvironment.baileysWorkerId,
      source_provider: 'baileys',
      message_id: key.id,
      patch: {},
      failed: true,
      key,
    };
    ensureMessageStatusEventId(statusUpdate);
    const kafkaKey = MessageStatusService.statusKafkaKey(
      baileysEnvironment.baileysAccountId,
      key.id,
      baileysEnvironment.baileysWorkerId
    );
    const topic = this.kafkaServiceQueueService.updateMessageStatus();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const publish = await this.runWithRuntimeEffectLease(statusUpdate, () =>
          this.streamProducerService.send(topic, statusUpdate, kafkaKey)
        );
        if (!publish.executed) {
          return;
        }
        return;
      } catch {
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }
  }

  isBoundTo(socket?: WASocket): boolean {
    if (!this.currentSocket) {
      return false;
    }

    return socket ? this.currentSocket === socket : true;
  }

  public markConnectionReady(socket?: WASocket): Promise<boolean> {
    const currentSocket = this.currentSocket;
    if (!currentSocket || (socket && currentSocket !== socket)) {
      return Promise.resolve(false);
    }

    const existingScope = this.activeConnectionScope;
    if (existingScope) {
      return existingScope.activation.then(
        (accepted) =>
          accepted &&
          this.currentSocket === currentSocket &&
          this.activeConnectionScope === existingScope,
        () => false
      );
    }

    const connectionScope = this.activateConnectionScope();
    return connectionScope.activation.then(
      (accepted) => {
        if (
          !accepted ||
          this.currentSocket !== currentSocket ||
          this.activeConnectionScope !== connectionScope
        ) {
          if (this.activeConnectionScope === connectionScope) {
            this.markConnectionUnavailable();
          }
          return false;
        }
        return true;
      },
      () => {
        if (this.activeConnectionScope === connectionScope) {
          this.markConnectionUnavailable();
        }
        return false;
      }
    );
  }

  public markConnectionUnavailable(socket?: WASocket): void {
    if (socket && this.currentSocket !== socket) {
      return;
    }

    this.stopActiveConnectionScope();
    this.pendingQueue.length = 0;
  }

  public configureAuxiliaryProviderFailureRecovery(
    recover: (
      socket: WASocket,
      error: unknown,
      options: { timedOut: boolean }
    ) => void
  ): void {
    this.auxiliaryProviderFailureRecovery = recover;
  }

  unbind() {
    this.markConnectionUnavailable(this.currentSocket);
    if (this.currentSocket) {
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
    }
    this.currentSocket = undefined;
    this.currentConnectionAuthorization = undefined;
    this.pendingQueue.length = 0;
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

  private async invokeAuxiliaryProvider<T>(
    socket: WASocket,
    operation: string,
    invoke: () => Promise<T>,
    beforeProviderInvoke?: IProviderInvocationBoundary,
    timeoutMs = this.AUXILIARY_PROVIDER_TIMEOUT_MS
  ): Promise<T> {
    const providerLease = this.auxiliaryProviderInvocationFence.acquire(socket);
    if (!providerLease) {
      const stalled = this.auxiliaryProviderInvocationFence.isStalled(socket);
      const error = new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
      if (stalled) {
        this.markConnectionUnavailable(socket);
        this.auxiliaryProviderFailureRecovery?.(socket, error, {
          timedOut: true,
        });
      }
      throw error;
    }
    try {
      await beforeProviderInvoke?.();
    } catch (error) {
      providerLease.releaseBeforeStart();
      throw error;
    }

    try {
      beforeProviderInvoke?.assertActive?.();
    } catch (error) {
      providerLease.releaseBeforeStart();
      await beforeProviderInvoke?.onStartRejected?.(error);
      throw error;
    }

    const providerCall = providerLease.start(invoke);
    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'baileys',
        operation,
        timeoutMs,
        invoke: () => providerCall,
      });
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        providerLease.markStalled();
        this.markConnectionUnavailable(socket);
        this.auxiliaryProviderFailureRecovery?.(socket, error, {
          timedOut: true,
        });
      } else {
        this.auxiliaryProviderFailureRecovery?.(socket, error, {
          timedOut: false,
        });
      }
      throw error;
    }
  }

  async markRead(keys: WAMessageKey[]) {
    const socket = this.currentSocket;
    if (!socket) {
      return;
    }

    await this.invokeAuxiliaryProvider(socket, 'mark_read', () =>
      socket.readMessages(keys)
    );
  }

  async sendAckTyping(jid: string) {
    const socket = this.currentSocket;
    if (!socket) {
      throw new Error('Socket not connected');
    }

    await this.invokeAuxiliaryProvider(socket, 'manual_presence', () =>
      socket.sendPresenceUpdate('composing', jid)
    );
  }

  async sendAckPaused(jid: string) {
    const socket = this.currentSocket;
    if (!socket) {
      throw new Error('Socket not connected');
    }

    await this.invokeAuxiliaryProvider(socket, 'manual_presence', () =>
      socket.sendPresenceUpdate('paused', jid)
    );
  }

  private async sendMessageWithConfirmation(
    socket: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: {
      quoted?: WAMessage;
    },
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<WAMessage> {
    const sentMessage = await this.invokeAuxiliaryProvider(
      socket,
      'auto_reply_send',
      () => socket.sendMessage(jid, content, options),
      beforeProviderInvoke,
      this.SEND_MESSAGE_TIMEOUT_MS
    );
    const sentMessageId = sentMessage?.key?.id;
    if (!sentMessageId) {
      throw new Error('Baileys send returned message without key.id');
    }

    void this.observeAutoReplyDeliveryConfirmation(sentMessageId);
    return sentMessage;
  }

  private async observeAutoReplyDeliveryConfirmation(
    sentMessageId: string
  ): Promise<void> {
    try {
      const outcome = await this.deliveryConfirmation.waitForOutcome(
        sentMessageId,
        this.SEND_CONFIRMATION_TIMEOUT_MS
      );
      if (outcome !== 'sent') {
        console.warn(
          '[BaileysSend][auto_reply] delivery_confirmation_unconfirmed_after_provider_accept',
          {
            message_id_hash: hashIncomingLogIdentifier(sentMessageId),
            outcome: outcome === 'failed' ? 'failed' : 'timeout',
          }
        );
      }
    } catch (error) {
      console.warn(
        '[BaileysSend][auto_reply] delivery_confirmation_observation_failed_after_provider_accept',
        {
          message_id_hash: hashIncomingLogIdentifier(sentMessageId),
          ...workerErrorDiagnostics(error),
        }
      );
    }
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
