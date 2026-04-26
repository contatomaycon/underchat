import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { Buffer } from 'node:buffer';
import { logger } from '@core/plugins/telemetry/logger';
import {
  incrementCounter,
  recordException,
} from '@core/plugins/telemetry/observability';
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

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;
  private readonly processedMessages = new Map<string, number>();
  private readonly processedCalls = new Map<string, number>();
  private readonly contactNamesByJid = new Map<string, string>();
  private readonly contactJidAliasesByJid = new Map<string, Set<string>>();
  private readonly MAX_SIZE = 100000;
  private readonly DEDUP_WINDOW_MS = 3000;
  private cleanupInterval?: NodeJS.Timeout;
  private rejectCallConfig: boolean = false;

  private readonly pendingQueue: IBaileysPendingMessage[] = [];
  private isProcessingQueue = false;
  private readonly MAX_RETRIES = 100;
  private readonly RETRY_BASE_DELAY_MS = 50;
  private readonly MAX_RETRY_DELAY_MS = 5000;
  private readonly MAX_QUEUE_SIZE = 500000;
  private readonly DESTROY_TIMEOUT_MS = 30000;
  private queueProcessorInterval?: NodeJS.Timeout;
  private isDestroying = false;

  private readonly PHOTO_CACHE_TTL = 86400;
  private readonly PHOTO_CACHE_NO_PHOTO_TTL = 300;
  private readonly PHOTO_CACHE_PREFIX = 'photo:jid:';
  private readonly PHOTO_CACHE_NO_PHOTO = '__no_photo__';
  private readonly PROFILE_PIC_TIMEOUT_MS = 3000;
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
    private readonly deliveryConfirmation: BaileysDeliveryConfirmationService
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
    if (!key?.id) return null;

    const jid = normalizeJid(remoteJid(key)) || normalizeJid(remoteJidAlt(key));
    if (!jid) return null;

    return `${this.MESSAGE_CACHE_PREFIX}${baileysEnvironment.baileysAccountId}:${jid}:${key.id}`;
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

    const cacheKey = this.buildMessageCacheKey(m.key);
    if (!cacheKey || !m.message) return;

    try {
      const ttlSeconds = this.hasPollCreationMessage(m.message)
        ? this.MESSAGE_CACHE_TTL_SECONDS_POLL
        : this.MESSAGE_CACHE_TTL_SECONDS_DEFAULT;
      const encoded = proto.Message.encode(m.message).finish();
      const payload = Buffer.from(encoded).toString('base64');
      await this.redis.set(cacheKey, payload, 'EX', ttlSeconds);
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
    const cacheKey = this.buildMessageCacheKey(key);
    if (!cacheKey) return undefined;

    try {
      const payload = await this.redis.get(cacheKey);
      if (!payload) return undefined;

      const decoded = proto.Message.decode(Buffer.from(payload, 'base64'));
      return decoded as proto.IMessage;
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
            console.error(
              `[CRITICAL] Message lost after ${this.MAX_RETRIES} retries:`,
              item.messageKey
            );
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

  private async sendToKafkaWithRetry(
    item: IBaileysPendingMessage
  ): Promise<void> {
    const delay = Math.min(
      this.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries),
      this.MAX_RETRY_DELAY_MS
    );

    if (item.retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (
      !item.inputUpsert.is_call_event &&
      item.inputUpsert.message &&
      (item.inputUpsert.message as WAMessage).message
    ) {
      await this.ensurePhotoResolved(item);
      await this.upsertMediaEnricher.enrich(
        item.inputUpsert,
        item.inputUpsert.message as WAMessage
      );
    } else {
      await this.ensurePhotoResolved(item);
    }

    await this.streamProducerService.send(
      item.topic,
      item.inputUpsert,
      item.messageKey
    );
  }

  private enqueueMessage(
    inputUpsert: IUpsertMessage,
    messageKey: string,
    topic: string = this.kafkaServiceQueueService.upsertMessage()
  ): IBaileysPendingMessage | null {
    if (this.isDestroying) {
      return null;
    }

    if (this.pendingQueue.length >= this.MAX_QUEUE_SIZE) {
      console.error(
        `[CRITICAL] Queue full (${this.MAX_QUEUE_SIZE}), dropping oldest messages`
      );
      const dropCount = Math.floor(this.MAX_QUEUE_SIZE * 0.1);
      this.pendingQueue.splice(0, dropCount);
    }

    const item: IBaileysPendingMessage = {
      inputUpsert,
      messageKey,
      topic,
      retries: 0,
      addedAt: Date.now(),
    };
    this.pendingQueue.push(item);
    return item;
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
      console.log('Messages upsert');
      console.dir(e, { depth: null, colors: true });

      if (!e?.messages?.length) return;

      for (const m of e.messages) {
        void this.cacheMessage(m);
        this.processMessage(socket, m, e.type);
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
    this.processIncomingMessage(
      socket,
      m,
      upsertType,
      this.kafkaServiceQueueService.upsertMessage()
    );
  }

  private processIncomingMessage(
    socket: WASocket,
    m: WAMessage,
    upsertType: string | null,
    topic: string
  ): void {
    try {
      if (m.category === 'peer') return;

      const chatKind = getChatKind(m);
      if (chatKind !== EChatKind.user) {
        return;
      }

      const messageKey = this.getMessageKey(m);
      if (!messageKey) {
        console.warn('[WARN] Message without key, skipping:', m.key?.id);
        return;
      }

      if (this.isDuplicate(messageKey)) {
        return;
      }

      const type = mapIncomingToType(m);
      if (!type) {
        console.warn('[WARN] Unknown message type, skipping:', messageKey);
        return;
      }

      if (
        upsertType &&
        upsertType !== EMessageUpsertType.notify &&
        type !== EMessageType.view_once
      ) {
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
        type,
        message: m as unknown as IUpsertMessage['message'],
        photo: null,
        has_quoted: hasQuoted,
      };

      const pendingItem = this.enqueueMessage(inputUpsert, messageKey, topic);
      if (!pendingItem) return;
    } catch (error) {
      console.error('[CRITICAL] Error processing message:', error, m.key?.id);
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
    let hasNoPhotoCache = false;
    let hasMissingCache = false;

    for (const candidate of candidates) {
      try {
        const cached = await this.redis.get(
          `${this.PHOTO_CACHE_PREFIX}${candidate}`
        );
        if (!cached) {
          hasMissingCache = true;
          continue;
        }

        if (cached === this.PHOTO_CACHE_NO_PHOTO) {
          hasNoPhotoCache = true;
          continue;
        }

        return cached;
      } catch {
        hasMissingCache = true;
      }
    }

    if (hasNoPhotoCache && !hasMissingCache) {
      return null;
    }

    return undefined;
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
          `${this.PHOTO_CACHE_PREFIX}${candidate}`,
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
    let timeoutId: NodeJS.Timeout | undefined;

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
    } catch (error) {
      logger.error(
        {
          err: error,
          type: 'baileys_call_auto_reply_dedupe_error',
          dedupe_key: dedupeKey,
          account_id: baileysEnvironment.baileysAccountId,
          worker_id: baileysEnvironment.baileysWorkerId,
        },
        'Failed to acquire call auto-reply dedupe key'
      );
      recordException(error, {
        level: 'error',
        baileys: {
          type: 'call_auto_reply_dedupe_error',
          account_id: baileysEnvironment.baileysAccountId,
          worker_id: baileysEnvironment.baileysWorkerId,
        },
      });
      incrementCounter('baileys_call_auto_reply_dedupe_error', 1, {
        account_id: baileysEnvironment.baileysAccountId,
      });
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

      let pendingItem: IBaileysPendingMessage | null = null;
      if (callPhone) {
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

        pendingItem = this.enqueueMessage(callUpsert, callKey);
        if (pendingItem) {
          const photo = await this.resolvePhotoForUpsert(
            socket,
            pendingItem,
            callJid
          );
          pendingItem.inputUpsert.photo = photo ?? null;
        }
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
        systemMessageUpsert.photo = pendingItem?.inputUpsert.photo ?? null;

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

    const promises = events.map((event) => {
      this.trackDeliveryConfirmation(event.key, event.update?.status);
      const patch = this.mapStatusToPatch(event.update?.status);
      return this.applyStatusPatch(event.key, patch);
    });

    await Promise.allSettled(promises);
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

      const kafkaKey = `${baileysEnvironment.baileysAccountId}:${key.id}:${MessageStatusService.hashPatch(patch)}`;
      const topic = this.kafkaServiceQueueService.updateMessageStatus();

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.streamProducerService.send(topic, statusUpdate, kafkaKey);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
          }
        }
      }

      logger.error(
        {
          err: lastError,
          account_id: statusUpdate.account_id,
          message_id: statusUpdate.message_id,
          patch: statusUpdate.patch,
          type: 'baileys_status_enqueue_error',
        },
        'Failed to enqueue message status update to Kafka after 3 attempts'
      );
      incrementCounter('baileys_status_enqueue_error', 1, {
        account_id: statusUpdate.account_id,
      });
      recordException(lastError, {
        level: 'error',
        baileys: {
          type: 'status_enqueue_error',
          account_id: statusUpdate.account_id,
          message_id: statusUpdate.message_id,
        },
      });
    } catch {}
  }

  unbind() {
    if (!this.currentSocket) return;
    try {
      this.currentSocket.ev.removeAllListeners('messages.upsert');
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
