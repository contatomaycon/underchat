import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import { Message, type Client } from '@wwebjs/whatsapp-web.js';
import type { IMessageKeyLike } from '@core/common/interfaces/IMessageKeyLike';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import {
  MessageStatusService,
  MessageSummaryPatch,
} from '@core/services/messageStatus.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { wwebjsEnvironment } from '@core/config/environments';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import type { IWwebjsPinEventData } from '@core/common/interfaces/IWwebjsPinEventData';
import { wwebjsMessageToUpsert } from '../util/wwebjsMessageToUpsert';
import {
  buildCallUpsert,
  buildDeleteMessageUpsert,
  buildEditMessageUpsert,
  buildReactionUpsert,
  buildRevokeMeUpsert,
} from '../util/wwebjsUpsertBuilders';
import { WwebjsUpsertMediaEnricher } from './upsertMediaEnricher.service';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { BalanceWorkerStatusGrpcClientService } from '@core/services/balanceWorkerStatusGrpcClient.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { WwebjsDeliveryConfirmationService } from './deliveryConfirmation.service';
import { MessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';

const ACK_ERROR = -1;
const ACK_SERVER = 1;
const ACK_DEVICE = 2;
const ACK_READ = 3;
const ACK_PLAYED = 4;
const SYSTEM_MESSAGE_JID = '0@c.us';

interface WwebjsResolvedJids {
  remoteJid: string;
  remoteJidAlt?: string;
}

type WwebjsIncomingEventSource =
  | 'message'
  | 'message_create'
  | 'message_ciphertext';

interface WwebjsReactionEvent {
  id?: unknown;
  msgId?: unknown;
  msgKey?: unknown;
  parentMsgKey?: unknown;
  reactionParentKey?: unknown;
  reaction?: unknown;
  reactionText?: unknown;
  senderId?: unknown;
  senderUserJid?: unknown;
  timestamp?: unknown;
  reactionTimestamp?: unknown;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPhoneLikeName(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 8) return false;

  const nonPhoneChars = normalized.replace(/[0-9+\-().\s]/g, '');
  return nonPhoneChars.length === 0;
}

function normalizeNameCandidate(value: unknown): string | undefined {
  const name = getNonEmptyString(value);
  if (!name) return undefined;
  if (isPhoneLikeName(name)) return undefined;
  return name;
}

function getMessageIdSerialized(msg: { id?: unknown }): string | undefined {
  if (!msg?.id) return undefined;
  if (
    typeof msg.id === 'object' &&
    msg.id !== null &&
    '_serialized' in (msg.id as object)
  ) {
    return (msg.id as { _serialized: string })._serialized;
  }
  return String(msg.id);
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return undefined;
}

function getRemoteFromMessageKeyValue(
  value: Record<string, unknown>
): string | undefined {
  const direct =
    getNonEmptyString(value.remoteJid) ?? getNonEmptyString(value.remote_jid);
  if (direct) {
    return direct;
  }

  const remote = value.remote;
  if (typeof remote === 'string') {
    return getNonEmptyString(remote);
  }

  if (typeof remote === 'object' && remote !== null) {
    const remoteObj = remote as Record<string, unknown>;
    return (
      getNonEmptyString(remoteObj._serialized) ??
      getNonEmptyString(remoteObj.id)
    );
  }

  return undefined;
}

function extractSerializedMessageKey(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return getNonEmptyString(value);
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const keyObject = value as Record<string, unknown>;
  const serialized = getNonEmptyString(keyObject._serialized);
  if (serialized) {
    return serialized;
  }

  const keyId =
    getNonEmptyString(keyObject.id) ??
    getNonEmptyString(keyObject.stanzaId) ??
    getNonEmptyString(keyObject.stanzaID);
  const remoteJid = getRemoteFromMessageKeyValue(keyObject);
  const fromMe = parseBooleanLike(keyObject.fromMe ?? keyObject.from_me);

  if (fromMe !== undefined && remoteJid && keyId) {
    return `${fromMe}_${remoteJid}_${keyId}`;
  }

  return keyId;
}

function getReactionMsgIdSerialized(
  reaction: WwebjsReactionEvent
): string | undefined {
  return (
    extractSerializedMessageKey(reaction.msgId) ??
    extractSerializedMessageKey(reaction.parentMsgKey) ??
    extractSerializedMessageKey(reaction.reactionParentKey)
  );
}

function getReactionIdSerialized(reaction: WwebjsReactionEvent): string {
  const serialized =
    extractSerializedMessageKey(reaction.id) ??
    extractSerializedMessageKey(reaction.msgKey);
  if (serialized) {
    return serialized;
  }

  return `react_${Date.now()}`;
}

function getFromMeFromSerializedLike(value: unknown): boolean | undefined {
  if (typeof value === 'string') {
    const parsed = parseSerializedMessageId(value);
    return typeof parsed?.fromMe === 'boolean' ? parsed.fromMe : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const objectValue = value as Record<string, unknown>;
  const fromMe = parseBooleanLike(objectValue.fromMe ?? objectValue.from_me);
  if (fromMe !== undefined) {
    return fromMe;
  }

  const serialized =
    getNonEmptyString(objectValue._serialized) ??
    getNonEmptyString(objectValue.id);
  if (!serialized) {
    return undefined;
  }

  const parsed = parseSerializedMessageId(serialized);
  return typeof parsed?.fromMe === 'boolean' ? parsed.fromMe : undefined;
}

function getReactionFromMeHint(
  reaction: WwebjsReactionEvent
): boolean | undefined {
  return (
    getFromMeFromSerializedLike(reaction.id) ??
    getFromMeFromSerializedLike(reaction.msgKey)
  );
}

function getReactionSenderId(
  reaction: WwebjsReactionEvent
): string | undefined {
  const getJidLikeFromValue = (value: unknown): string | undefined => {
    if (!value) return undefined;

    if (typeof value === 'string') {
      return getNonEmptyString(value);
    }

    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    const objectValue = value as Record<string, unknown>;
    return (
      getNonEmptyString(objectValue._serialized) ??
      getNonEmptyString(objectValue.id)
    );
  };

  const getSenderFromMessageKey = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const keyObject = value as Record<string, unknown>;
    const directFields = [
      keyObject.participant,
      keyObject.participantAlt,
      keyObject.participant_alt,
      keyObject.sender,
      keyObject.senderId,
      keyObject.author,
      keyObject.from,
    ];

    for (const candidate of directFields) {
      const jid = getJidLikeFromValue(candidate);
      if (jid) {
        return jid;
      }
    }

    return undefined;
  };

  const direct =
    getNonEmptyString(reaction.senderId) ??
    getNonEmptyString(reaction.senderUserJid);
  if (direct) {
    return direct;
  }

  if (typeof reaction.senderId === 'object' && reaction.senderId !== null) {
    const senderIdObject = reaction.senderId as Record<string, unknown>;
    const objectSender =
      getNonEmptyString(senderIdObject._serialized) ??
      getNonEmptyString(senderIdObject.id);
    if (objectSender) {
      return objectSender;
    }
  }

  if (
    typeof reaction.senderUserJid === 'object' &&
    reaction.senderUserJid !== null
  ) {
    const senderUserObject = reaction.senderUserJid as Record<string, unknown>;
    const senderFromObject =
      getNonEmptyString(senderUserObject._serialized) ??
      getNonEmptyString(senderUserObject.id);
    if (senderFromObject) {
      return senderFromObject;
    }
  }

  return (
    getSenderFromMessageKey(reaction.id) ??
    getSenderFromMessageKey(reaction.msgKey)
  );
}

function getReactionEmoji(reaction: WwebjsReactionEvent): string {
  if (typeof reaction.reaction === 'string') {
    return reaction.reaction;
  }

  if (typeof reaction.reactionText === 'string') {
    return reaction.reactionText;
  }

  return '';
}

function parseNumberLike(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return undefined;
}

function normalizeTimestampSeconds(value: unknown): number | undefined {
  const numeric = parseNumberLike(value);
  if (numeric === undefined || numeric <= 0) {
    return undefined;
  }

  if (numeric > 10_000_000_000) {
    return Math.floor(numeric / 1000);
  }

  return Math.floor(numeric);
}

function getReactionTimestampSeconds(
  reaction: WwebjsReactionEvent
): number | undefined {
  return (
    normalizeTimestampSeconds(reaction.timestamp) ??
    normalizeTimestampSeconds(reaction.reactionTimestamp)
  );
}

function normalizeJidForComparison(
  value: string | undefined
): string | undefined {
  const normalizedValue = getNonEmptyString(value);
  if (!normalizedValue) {
    return undefined;
  }

  return normalizeJid(normalizedValue) ?? normalizedValue;
}

function getUserPartFromJid(value: string): string {
  const atIndex = value.indexOf('@');
  return (atIndex > 0 ? value.slice(0, atIndex) : value).trim();
}

function isSameJidAccount(
  first: string | undefined,
  second: string | undefined
): boolean {
  const normalizedFirst = normalizeJidForComparison(first);
  const normalizedSecond = normalizeJidForComparison(second);
  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }

  if (normalizedFirst === normalizedSecond) {
    return true;
  }

  return (
    getUserPartFromJid(normalizedFirst) === getUserPartFromJid(normalizedSecond)
  );
}

function getRemoteFromSerializedMessageId(
  serializedMessageId: string
): string | undefined {
  const firstSeparator = serializedMessageId.indexOf('_');
  const lastSeparator = serializedMessageId.lastIndexOf('_');
  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return undefined;
  }

  return serializedMessageId.slice(firstSeparator + 1, lastSeparator);
}

function getStanzaIdFromMessageId(
  messageId: string | undefined
): string | undefined {
  const normalized = getNonEmptyString(messageId);
  if (!normalized) {
    return undefined;
  }

  const parsed = parseSerializedMessageId(normalized);
  if (parsed?.stanzaId) {
    return parsed.stanzaId;
  }

  return normalized;
}

function getMessageRemoteFromId(msg: Message): string | undefined {
  if (!msg?.id) {
    return undefined;
  }

  if (typeof msg.id === 'object' && msg.id !== null) {
    const value = msg.id as {
      remote?: unknown;
      _serialized?: unknown;
    };

    if (typeof value.remote === 'string' && value.remote) {
      return value.remote;
    }

    const remoteSerialized =
      typeof value.remote === 'object' &&
      value.remote !== null &&
      '_serialized' in (value.remote as object)
        ? (value.remote as { _serialized?: unknown })._serialized
        : undefined;
    if (typeof remoteSerialized === 'string' && remoteSerialized) {
      return remoteSerialized;
    }

    if (typeof value._serialized === 'string' && value._serialized) {
      return getRemoteFromSerializedMessageId(value._serialized);
    }
  }

  if (typeof msg.id === 'string') {
    return getRemoteFromSerializedMessageId(msg.id);
  }

  return undefined;
}

function buildScopedStanzaDedupeKey(msg: Message): string | undefined {
  const serializedMessageId = getMessageIdSerialized(msg);
  const parsedSerializedMessageId = serializedMessageId
    ? parseSerializedMessageId(serializedMessageId)
    : null;
  const stanzaId =
    parsedSerializedMessageId?.stanzaId ??
    getStanzaIdFromMessageId(serializedMessageId);
  if (!stanzaId) {
    return undefined;
  }

  const fromMe =
    parsedSerializedMessageId?.fromMe ??
    (msg.fromMe === true ||
      (msg as unknown as { id?: { fromMe?: unknown } }).id?.fromMe === true);
  const fromMeTag = fromMe ? '1' : '0';

  const remoteJid =
    parsedSerializedMessageId?.remoteJid ??
    getMessageRemoteFromId(msg) ??
    'unknown';

  return `stanza:${fromMeTag}:${remoteJid}:${stanzaId}`;
}

@singleton()
export class WwebjsIncomingMessageService {
  private currentClient: Client | undefined;
  private rejectCallConfig = false;
  private readonly processedCalls = new Map<string, number>();
  private readonly processedPinMessages = new Map<string, number>();
  private readonly processedIncomingMessages = new Map<string, number>();
  private readonly PIN_MESSAGE_CACHE_TTL_MS = 15000;
  private readonly INCOMING_MESSAGE_CACHE_TTL_MS = 30000;
  private readonly INCOMING_MESSAGE_CACHE_MAX_SIZE = 100000;
  private readonly PHOTO_CACHE_TTL = 86400;
  private readonly PHOTO_CACHE_NO_PHOTO_TTL = 300;
  private readonly PHOTO_CACHE_PREFIX = 'photo:jid:';
  private readonly PHOTO_CACHE_NO_PHOTO = '__no_photo__';
  private readonly NAME_CACHE_TTL = 86400;
  private readonly NAME_CACHE_NO_NAME_TTL = 300;
  private readonly NAME_CACHE_PREFIX = 'name:jid:';
  private readonly NAME_CACHE_NO_NAME = '__no_name__';
  private readonly PROFILE_PIC_TIMEOUT_MS = 3000;
  private readonly SEND_CONFIRMATION_MAX_ATTEMPTS = 3;
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;
  private readonly SEND_CONFIRMATION_BACKOFF_MS = [500, 1000];
  private readonly E2E_NOTIFICATION_DEDUPE_PREFIX = 'wwebjs:e2e:';
  private readonly E2E_NOTIFICATION_DEDUPE_TTL = 31536000;
  private readonly CIPHERTEXT_FANOUT_DEDUPE_PREFIX = 'wwebjs:ciphertext:';
  private readonly CIPHERTEXT_FANOUT_DEDUPE_TTL = 31536000;
  private readonly LID_PHONE_CACHE = new Map<
    string,
    { phone: string | null; ts: number }
  >();
  private readonly LID_PHONE_CACHE_TTL_MS = 86_400_000;
  private readonly LID_PHONE_CACHE_NO_PHONE_TTL_MS = 300_000;

  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject('Redis') private readonly redis: Redis,
    @inject(WwebjsUpsertMediaEnricher)
    private readonly upsertMediaEnricher: WwebjsUpsertMediaEnricher,
    @inject(BalanceWorkerStatusGrpcClientService)
    private readonly balanceWorkerStatusGrpcClientService: BalanceWorkerStatusGrpcClientService,
    @inject(WwebjsDeliveryConfirmationService)
    private readonly deliveryConfirmation: WwebjsDeliveryConfirmationService
  ) {}

  private logEvent(eventName: string, payload: Record<string, unknown>): void {
    console.log(`[wwebjs] event:${eventName}`, payload);
  }

  bindTo(client: Client): void {
    this.currentClient = client;
    client.on('message', (msg: Message) => {
      this.logEvent('message', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
      });

      if (this.shouldSkipIncomingMessage(msg, 'message')) {
        return;
      }

      console.log('Messages upsert');
      console.dir(msg, { depth: null, colors: true });

      void this.handleIncomingMessage(msg);
    });
    client.on('message_ciphertext', (msg: Message) => {
      this.logEvent('message_ciphertext', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
      });

      if (!this.shouldHandleCiphertextMessage(msg)) {
        return;
      }

      if (this.shouldSkipIncomingMessage(msg, 'message_ciphertext')) {
        return;
      }

      void this.handleIncomingMessage(msg);
    });
    client.on('message_ciphertext_failed', (msg: Message) => {
      this.logEvent('message_ciphertext_failed', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
      });
      this.handleCiphertextFailed(msg);
    });
    client.on('message_create', (msg: Message) => {
      this.logEvent('message_create', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
      });

      if (!this.shouldHandleFromMeCreatedMessage(msg)) {
        return;
      }

      if (this.shouldSkipIncomingMessage(msg, 'message_create')) {
        return;
      }

      console.log('Messages upsert (fromMe external)');
      console.dir(msg, { depth: null, colors: true });

      void this.handleIncomingMessage(msg);
    });
    client.on('message_revoke_everyone', (after: Message, before?: Message) => {
      this.logEvent('message_revoke_everyone', {
        afterId: getMessageIdSerialized(after),
        beforeId: before ? getMessageIdSerialized(before) : undefined,
        fromMe: after.fromMe,
        from: after.from,
        to: after.to,
        type: after.type,
      });

      if (this.isStatusOrBroadcastMessage(after)) {
        return;
      }

      void this.handleRevokeEveryone(after, before);
    });
    client.on('message_revoke_me', (msg: Message) => {
      this.logEvent('message_revoke_me', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
      });

      if (this.isStatusOrBroadcastMessage(msg)) {
        return;
      }

      void this.handleRevokeMe(msg);
    });
    client.on(
      'message_edit',
      (message: Message, newBody: string, prevBody: string) => {
        this.logEvent('message_edit', {
          id: getMessageIdSerialized(message),
          fromMe: message.fromMe,
          from: message.from,
          to: message.to,
          type: message.type,
          hasNewBody: Boolean(getNonEmptyString(newBody)),
          hasPrevBody: Boolean(getNonEmptyString(prevBody)),
        });

        if (this.isStatusOrBroadcastMessage(message)) {
          return;
        }

        void this.handleMessageEdit(message, newBody, prevBody);
      }
    );
    client.on('message_reaction', (reaction: WwebjsReactionEvent) => {
      this.logEvent('message_reaction', {
        reactionId: getReactionIdSerialized(reaction),
        parentMsgId: getReactionMsgIdSerialized(reaction),
        senderId: getReactionSenderId(reaction),
        emoji: getReactionEmoji(reaction),
      });

      void this.handleMessageReaction(client, reaction);
    });
    client.on(
      'call',
      (call: {
        id?: string;
        from?: string;
        fromMe?: boolean;
        timestamp?: number;
        isVideo?: boolean;
        reject?: () => Promise<void>;
      }) => {
        this.logEvent('call', {
          id: call.id,
          from: call.from,
          fromMe: call.fromMe,
          timestamp: call.timestamp,
          isVideo: call.isVideo,
        });

        void this.handleCall(call);
      }
    );
    client.on('message_ack', (msg: Message, ack: number) => {
      this.logEvent('message_ack', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        ack,
      });

      if (this.isStatusOrBroadcastMessage(msg)) {
        return;
      }

      void this.handleMessageAck(msg, ack);
    });
    client.on(
      'message_pinned',
      (message: Message, pinData?: IWwebjsPinEventData) => {
        this.logEvent('message_pinned', {
          id: getMessageIdSerialized(message),
          fromMe: message.fromMe,
          from: message.from,
          to: message.to,
          type: message.type,
          pinType: pinData?.pinType,
          isPinned: pinData?.isPinned,
          chatId: pinData?.chatId,
          parentMessageId: pinData?.parentMessageId,
        });

        if (this.isStatusOrBroadcastMessage(message)) {
          return;
        }

        void this.handlePinnedMessage(message, pinData);
      }
    );
  }

  private shouldSkipChat(remoteJid: string): boolean {
    if (!remoteJid) return true;
    if (remoteJid === SYSTEM_MESSAGE_JID) return true;
    if (remoteJid === 'status@broadcast') return true;
    if (remoteJid.endsWith('@broadcast')) return true;
    if (remoteJid.endsWith('@newsletter')) return true;
    return false;
  }

  private getMessageAuthor(msg: Message): string | undefined {
    const raw = msg as unknown as {
      author?: unknown;
      _data?: {
        author?: unknown;
      };
    };

    return (
      getNonEmptyString(raw.author) ?? getNonEmptyString(raw._data?.author)
    );
  }

  private cleanupProcessedIncomingMessages(now: number): void {
    for (const [key, timestamp] of this.processedIncomingMessages.entries()) {
      if (now - timestamp > this.INCOMING_MESSAGE_CACHE_TTL_MS) {
        this.processedIncomingMessages.delete(key);
      }
    }

    if (
      this.processedIncomingMessages.size <=
      this.INCOMING_MESSAGE_CACHE_MAX_SIZE
    ) {
      return;
    }

    const excess =
      this.processedIncomingMessages.size -
      this.INCOMING_MESSAGE_CACHE_MAX_SIZE;
    const iterator = this.processedIncomingMessages.keys();
    for (let i = 0; i < excess; i++) {
      const key = iterator.next().value;
      if (!key) {
        break;
      }

      this.processedIncomingMessages.delete(key);
    }
  }

  private cleanupProcessedPinMessages(now: number): void {
    for (const [key, timestamp] of this.processedPinMessages.entries()) {
      if (now - timestamp > this.PIN_MESSAGE_CACHE_TTL_MS) {
        this.processedPinMessages.delete(key);
      }
    }
  }

  private buildIncomingDedupeKeys(
    msg: Message,
    source: WwebjsIncomingEventSource
  ): string[] {
    const namespace =
      source === 'message_ciphertext' ? 'ciphertext' : 'default';
    const messageId = getNonEmptyString(getMessageIdSerialized(msg));
    const scopedStanzaDedupeKey = buildScopedStanzaDedupeKey(msg);

    return [messageId, scopedStanzaDedupeKey]
      .filter((key): key is string => !!key)
      .map((key) => `${namespace}:${key}`);
  }

  private getPinActionState(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): string {
    const rawData = (
      msg as unknown as {
        _data?: {
          pinMessageType?: unknown;
          pinType?: unknown;
          pinActionType?: unknown;
          pinAction?: unknown;
        };
      }
    )._data;

    const pinTypeCandidate =
      pinData?.pinType ??
      rawData?.pinMessageType ??
      rawData?.pinType ??
      rawData?.pinActionType ??
      rawData?.pinAction;

    if (
      typeof pinTypeCandidate === 'number' &&
      Number.isFinite(pinTypeCandidate)
    ) {
      return `type:${pinTypeCandidate}`;
    }

    if (typeof pinTypeCandidate === 'string') {
      const normalizedType = pinTypeCandidate.trim().toLowerCase();
      if (normalizedType) {
        return `type:${normalizedType}`;
      }
    }

    if (pinData?.isPinned === true) {
      return 'state:pinned';
    }

    if (pinData?.isPinned === false) {
      return 'state:unpinned';
    }

    const rawType = getNonEmptyString(msg.type)?.toLowerCase();
    if (rawType === 'pinned_message') {
      return 'state:pinned';
    }

    return 'state:unknown';
  }

  private getSerializedId(value: unknown): string | undefined {
    if (!value) return undefined;

    if (typeof value === 'string') {
      return getNonEmptyString(value);
    }

    if (typeof value !== 'object') {
      return undefined;
    }

    const objectValue = value as Record<string, unknown>;
    const directKeys = ['_serialized', 'id', 'stanzaId', 'stanzaID'];
    for (const key of directKeys) {
      const normalized = getNonEmptyString(objectValue[key]);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private getPinParentMessageId(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): string | undefined {
    if (pinData?.parentMessageId) {
      return getNonEmptyString(pinData.parentMessageId) ?? undefined;
    }

    const rawData = (
      msg as unknown as {
        _data?: {
          pinParentKey?: unknown;
          targetMsgKey?: unknown;
          parentMsgKey?: unknown;
        };
      }
    )._data;

    return (
      this.getSerializedId(rawData?.pinParentKey) ??
      this.getSerializedId(rawData?.targetMsgKey) ??
      this.getSerializedId(rawData?.parentMsgKey)
    );
  }

  private getPinChatId(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): string | undefined {
    const idRemote =
      typeof msg.id === 'object' && msg.id !== null
        ? getNonEmptyString((msg.id as { remote?: unknown }).remote)
        : undefined;

    const candidates = [
      pinData?.chatId,
      msg.fromMe ? msg.to || msg.from : msg.from || msg.to,
      getMessageRemoteFromId(msg),
      idRemote,
      msg.from,
      msg.to,
    ];

    for (const candidate of candidates) {
      const normalizedCandidate = getNonEmptyString(candidate);
      if (!normalizedCandidate) {
        continue;
      }

      const normalizedJid =
        normalizeJid(normalizedCandidate) ?? normalizedCandidate;
      if (!normalizedJid) {
        continue;
      }

      return normalizedJid;
    }

    return undefined;
  }

  private getPinDedupeKeys(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): string[] {
    const rawData = (
      msg as unknown as {
        _data?: {
          pinMessageType?: unknown;
          pinType?: unknown;
          pinActionType?: unknown;
          pinAction?: unknown;
          pinParentKey?: unknown;
          targetMsgKey?: unknown;
        };
      }
    )._data;

    const hasPinSignals =
      getNonEmptyString(msg.type)?.toLowerCase() === 'pin_message' ||
      getNonEmptyString(msg.type)?.toLowerCase() === 'pinned_message' ||
      pinData !== undefined ||
      rawData?.pinMessageType !== undefined ||
      rawData?.pinType !== undefined ||
      rawData?.pinActionType !== undefined ||
      rawData?.pinAction !== undefined ||
      rawData?.pinParentKey !== undefined ||
      rawData?.targetMsgKey !== undefined;

    if (!hasPinSignals) {
      return [];
    }

    const keys = new Set<string>();
    const actionState = this.getPinActionState(msg, pinData);
    const parentMessageId = this.getPinParentMessageId(msg, pinData);
    const chatId = this.getPinChatId(msg, pinData);

    if (chatId && parentMessageId) {
      keys.add(`pin:action:${chatId}:${parentMessageId}:${actionState}`);
    }

    const messageId = getNonEmptyString(getMessageIdSerialized(msg));
    if (messageId) {
      keys.add(`pin:message:${messageId}:${actionState}`);
    }

    const scopedStanzaDedupeKey = buildScopedStanzaDedupeKey(msg);
    if (scopedStanzaDedupeKey) {
      keys.add(`pin:stanza:${scopedStanzaDedupeKey}:${actionState}`);
    }

    return Array.from(keys);
  }

  private shouldSkipPinMessage(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): boolean {
    const dedupeKeys = this.getPinDedupeKeys(msg, pinData);
    if (dedupeKeys.length === 0) {
      return false;
    }

    const now = Date.now();
    this.cleanupProcessedPinMessages(now);

    for (const dedupeKey of dedupeKeys) {
      if (this.processedPinMessages.has(dedupeKey)) {
        return true;
      }
    }

    for (const dedupeKey of dedupeKeys) {
      this.processedPinMessages.set(dedupeKey, now);
    }

    return false;
  }

  private shouldSkipIncomingMessage(
    msg: Message,
    source: WwebjsIncomingEventSource
  ): boolean {
    if (this.isUnsupportedSystemNotification(msg)) {
      return true;
    }

    if (this.isGroupMessage(msg)) {
      return true;
    }

    if (this.isStatusOrBroadcastMessage(msg)) {
      return true;
    }

    if (source !== 'message_ciphertext' && this.shouldSkipPinMessage(msg)) {
      return true;
    }

    const dedupeKeys = this.buildIncomingDedupeKeys(msg, source);
    if (dedupeKeys.length === 0) {
      return false;
    }

    const now = Date.now();
    this.cleanupProcessedIncomingMessages(now);

    for (const dedupeKey of dedupeKeys) {
      if (this.processedIncomingMessages.has(dedupeKey)) {
        return true;
      }
    }

    for (const dedupeKey of dedupeKeys) {
      this.processedIncomingMessages.set(dedupeKey, now);
    }

    return false;
  }

  private isUnsupportedSystemNotification(msg: Message): boolean {
    const { type } = this.getMessageTypeAndSubtype(msg);

    if (type === 'notification_template' || type === 'e2e_notification') {
      return true;
    }

    return false;
  }

  private getMessageTypeAndSubtype(msg: Message): {
    type?: string;
    subtype?: string;
  } {
    const raw = msg as unknown as {
      _data?: { type?: unknown; subtype?: unknown };
    };

    const type =
      getNonEmptyString(msg.type)?.toLowerCase() ??
      getNonEmptyString(raw._data?.type)?.toLowerCase();
    const subtype = getNonEmptyString(raw._data?.subtype)?.toLowerCase();

    return { type, subtype };
  }

  private isE2EEncryptNotification(msg: Message): boolean {
    const { type, subtype } = this.getMessageTypeAndSubtype(msg);
    if (type !== 'e2e_notification') {
      return false;
    }

    return !subtype || subtype === 'encrypt';
  }

  private isCiphertextFanoutNotification(msg: Message): boolean {
    const { type, subtype } = this.getMessageTypeAndSubtype(msg);
    return type === 'ciphertext' && subtype === 'fanout';
  }

  private getE2ENotificationDedupeKey(
    msg: Message,
    resolvedJids: WwebjsResolvedJids
  ): string | undefined {
    const { subtype } = this.getMessageTypeAndSubtype(msg);
    const chatJidRaw = resolvedJids.remoteJid || msg.from || msg.to || '';
    const chatJid = normalizeJid(chatJidRaw) ?? chatJidRaw;
    if (!chatJid) {
      return undefined;
    }

    const normalizedSubtype = subtype || 'encrypt';
    return `${this.E2E_NOTIFICATION_DEDUPE_PREFIX}${wwebjsEnvironment.wwebjsAccountId}:${chatJid}:${normalizedSubtype}`;
  }

  private async shouldSkipE2ENotification(
    msg: Message,
    resolvedJids: WwebjsResolvedJids
  ): Promise<boolean> {
    if (!this.isE2EEncryptNotification(msg)) {
      return false;
    }

    const dedupeKey = this.getE2ENotificationDedupeKey(msg, resolvedJids);
    if (!dedupeKey) {
      return false;
    }

    try {
      const inserted = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        this.E2E_NOTIFICATION_DEDUPE_TTL,
        'NX'
      );

      return inserted !== 'OK';
    } catch {
      return false;
    }
  }

  private getCiphertextFanoutDedupeKey(msg: Message): string | undefined {
    const messageId = getMessageIdSerialized(msg);
    if (!messageId) {
      return undefined;
    }

    return `${this.CIPHERTEXT_FANOUT_DEDUPE_PREFIX}${wwebjsEnvironment.wwebjsAccountId}:${messageId}`;
  }

  private async shouldSkipCiphertextFanout(msg: Message): Promise<boolean> {
    if (!this.isCiphertextFanoutNotification(msg)) {
      return false;
    }

    const dedupeKey = this.getCiphertextFanoutDedupeKey(msg);
    if (!dedupeKey) {
      return false;
    }

    try {
      const inserted = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        this.CIPHERTEXT_FANOUT_DEDUPE_TTL,
        'NX'
      );
      return inserted !== 'OK';
    } catch {
      return false;
    }
  }

  private isStatusOrBroadcastMessage(msg: Message): boolean {
    const rawCandidates = this.getMessageJidCandidates(msg);

    for (const rawCandidate of rawCandidates) {
      const normalized = normalizeJid(rawCandidate) ?? rawCandidate;
      if (this.shouldSkipChat(normalized)) {
        return true;
      }
    }

    return false;
  }

  private isGroupMessage(msg: Message): boolean {
    const rawCandidates = this.getMessageJidCandidates(msg);

    for (const rawCandidate of rawCandidates) {
      const normalized = normalizeJid(rawCandidate) ?? rawCandidate;
      if (normalized.endsWith('@g.us')) {
        return true;
      }
    }

    return false;
  }

  private getMessageJidCandidates(msg: Message): string[] {
    const idRemote =
      typeof msg.id === 'object' && msg.id !== null
        ? getNonEmptyString((msg.id as { remote?: unknown }).remote)
        : undefined;

    return [msg.from, msg.to, getMessageRemoteFromId(msg), idRemote].filter(
      (value): value is string => !!value
    );
  }

  private shouldHandleFromMeCreatedMessage(msg: Message): boolean {
    if (!msg.fromMe) {
      return false;
    }

    const rawData = (
      msg as unknown as {
        _data?: {
          associationType?: unknown;
          viewMode?: unknown;
        };
      }
    )._data;
    const associationType = getNonEmptyString(rawData?.associationType)
      ?.toUpperCase()
      ?.trim();
    const viewMode = getNonEmptyString(rawData?.viewMode)
      ?.toUpperCase()
      ?.trim();
    if (associationType === 'MEDIA_ALBUM' || viewMode === 'MEDIA_ALBUM') {
      return false;
    }

    const ackRaw =
      msg.ack ?? (msg as unknown as { _data?: { ack?: number } })._data?.ack;
    if (typeof ackRaw === 'number' && ackRaw < 1) {
      return false;
    }

    return !!this.getMessageAuthor(msg);
  }

  private shouldHandleCiphertextMessage(msg: Message): boolean {
    const messageType = getNonEmptyString(msg.type)?.toLowerCase();
    if (messageType !== 'ciphertext') {
      return false;
    }

    const rawSubtype = getNonEmptyString(
      (msg as unknown as { _data?: { subtype?: unknown } })._data?.subtype
    )?.toLowerCase();
    if (!rawSubtype) {
      return false;
    }

    return (
      rawSubtype === 'fanout' ||
      rawSubtype === 'view_once_unavailable_fanout' ||
      rawSubtype.startsWith('view_once_unavailable_')
    );
  }

  private shouldSkipPinnedMessage(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): boolean {
    return this.shouldSkipPinMessage(msg, pinData);
  }

  private isGroupOrBroadcastJid(jid: string): boolean {
    return (
      jid.endsWith('@g.us') ||
      jid.endsWith('@broadcast') ||
      jid.endsWith('@newsletter')
    );
  }

  private shouldSkipResolvedJids(resolvedJids: WwebjsResolvedJids): boolean {
    const candidates = [
      resolvedJids.remoteJid,
      resolvedJids.remoteJidAlt,
    ].filter((jid): jid is string => !!jid);

    for (const candidate of candidates) {
      const normalized = normalizeJid(candidate) ?? candidate;
      if (
        this.shouldSkipChat(normalized) ||
        this.isGroupOrBroadcastJid(normalized)
      ) {
        return true;
      }
    }

    return false;
  }

  private isLidJid(jid: string | undefined): boolean {
    return !!jid && jid.endsWith('@lid');
  }

  private async resolvePhoneFromLid(
    client: Client,
    lidJid: string
  ): Promise<string | undefined> {
    const cached = this.LID_PHONE_CACHE.get(lidJid);
    if (cached) {
      const ttl = cached.phone
        ? this.LID_PHONE_CACHE_TTL_MS
        : this.LID_PHONE_CACHE_NO_PHONE_TTL_MS;
      if (Date.now() - cached.ts < ttl) {
        return cached.phone ?? undefined;
      }
    }

    const resolved =
      (await this.resolvePhoneFromLidViaContact(client, lidJid)) ??
      (await this.resolvePhoneFromLidViaPupPage(client, lidJid));

    this.LID_PHONE_CACHE.set(lidJid, {
      phone: resolved ?? null,
      ts: Date.now(),
    });
    return resolved;
  }

  private async resolvePhoneFromLidViaContact(
    client: Client,
    lidJid: string
  ): Promise<string | undefined> {
    const getContactById = (
      client as unknown as {
        getContactById?: (id: string) => Promise<{
          number?: string;
          id?: { _serialized?: string };
        } | null>;
      }
    ).getContactById;

    if (typeof getContactById !== 'function') {
      return undefined;
    }

    try {
      const contact = await getContactById.call(client, lidJid);
      if (!contact) return undefined;

      const phone = contact.number?.replaceAll(/\D/g, '');
      if (phone && phone.length >= 8) {
        return phone;
      }

      const contactJid = contact.id?._serialized;
      if (
        contactJid &&
        !contactJid.endsWith('@lid') &&
        contactJid.includes('@')
      ) {
        const phoneFromJid = contactJid.split('@')[0].replaceAll(/\D/g, '');
        if (phoneFromJid && phoneFromJid.length >= 8) {
          return phoneFromJid;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private async resolvePhoneFromLidViaPupPage(
    client: Client,
    lidJid: string
  ): Promise<string | undefined> {
    const pupPage = (client as unknown as { pupPage?: unknown }).pupPage;
    if (
      !pupPage ||
      typeof (pupPage as { evaluate?: unknown }).evaluate !== 'function'
    ) {
      return undefined;
    }

    try {
      const result: string | null = await (
        pupPage as {
          evaluate: (
            fn: (jid: string) => Promise<string | null>,
            jid: string
          ) => Promise<string | null>;
        }
      ).evaluate(async (jid: string) => {
        try {
          const win = globalThis as any;
          const { lid, phone } = await win.WWebJS.enforceLidAndPnRetrieval(jid);
          if (phone?._serialized) {
            return phone._serialized as string;
          }
          if (lid?._serialized && !lid._serialized.endsWith('@lid')) {
            return lid._serialized as string;
          }
          const phoneWid = win
            .require('WAWebApiContact')
            .getPhoneNumber(win.require('WAWebWidFactory').createWid(jid));
          return (phoneWid?._serialized as string) ?? null;
        } catch {
          return null;
        }
      }, lidJid);

      if (!result || result.endsWith('@lid')) {
        return undefined;
      }

      const phone = result.split('@')[0].replaceAll(/\D/g, '');
      return phone && phone.length >= 8 ? phone : undefined;
    } catch {
      return undefined;
    }
  }

  private async resolveRemoteJids(
    client: Client,
    msg: Message
  ): Promise<WwebjsResolvedJids | null> {
    const idRemote =
      typeof msg.id === 'object' && msg.id !== null
        ? getNonEmptyString((msg.id as { remote?: unknown }).remote)
        : undefined;

    const normalizeCandidate = (value: unknown): string | undefined => {
      const raw = getNonEmptyString(value);
      if (!raw) {
        return undefined;
      }
      const normalized = normalizeJid(raw) ?? raw;
      if (this.shouldSkipChat(normalized)) {
        return undefined;
      }
      return normalized;
    };

    const normalizedIdRemote = normalizeCandidate(idRemote);
    const serializedRemote = normalizeCandidate(getMessageRemoteFromId(msg));

    const preferredRaw = msg.fromMe
      ? msg.to || msg.from || ''
      : msg.from || msg.to || '';
    const preferredJid = normalizeCandidate(preferredRaw);

    const authorJid = normalizeCandidate(msg.author);

    const orderedCandidates = [
      preferredJid,
      normalizedIdRemote,
      authorJid,
      serializedRemote,
    ].filter((candidate): candidate is string => !!candidate);

    if (!orderedCandidates.length) {
      return null;
    }

    const uniqueCandidates = this.removeSelfPhotoCandidates(
      client,
      Array.from(new Set(orderedCandidates))
    );
    if (!uniqueCandidates.length) {
      return null;
    }
    const nonLidCandidate = uniqueCandidates.find(
      (candidate) => !this.isLidJid(candidate)
    );
    const primaryJid = msg.fromMe
      ? (nonLidCandidate ?? uniqueCandidates[0])
      : preferredJid && uniqueCandidates.includes(preferredJid)
        ? preferredJid
        : (nonLidCandidate ?? uniqueCandidates[0]);

    if (this.isGroupOrBroadcastJid(primaryJid)) {
      return { remoteJid: primaryJid };
    }

    const lidAlternative = uniqueCandidates.find(
      (candidate) => candidate !== primaryJid && this.isLidJid(candidate)
    );
    const alternativeJid =
      lidAlternative ??
      uniqueCandidates.find((candidate) => candidate !== primaryJid);

    // If primary is LID and no non-LID alternative, resolve phone via Contact API
    if (this.isLidJid(primaryJid)) {
      const resolvedPhone = await this.resolvePhoneFromLid(client, primaryJid);
      if (resolvedPhone) {
        const phoneJid = `${resolvedPhone}@s.whatsapp.net`;
        return { remoteJid: phoneJid, remoteJidAlt: primaryJid };
      }
    }

    return alternativeJid
      ? { remoteJid: primaryJid, remoteJidAlt: alternativeJid }
      : { remoteJid: primaryJid };
  }

  private async handleIncomingMessage(msg: Message): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    try {
      const resolvedJids = await this.resolveRemoteJids(client, msg);
      if (!resolvedJids) return;
      if (this.shouldSkipResolvedJids(resolvedJids)) return;
      if (this.isUnsupportedSystemNotification(msg)) return;
      if (await this.shouldSkipE2ENotification(msg, resolvedJids)) return;
      if (await this.shouldSkipCiphertextFanout(msg)) return;

      const [pushName, photo] = await Promise.all([
        this.resolvePushName(client, msg, resolvedJids),
        this.resolvePhotoForMessage(client, msg, resolvedJids),
      ]);

      const upsert = await wwebjsMessageToUpsert(msg, resolvedJids, pushName);
      if (!upsert) return;
      upsert.photo = photo ?? null;

      await this.upsertMediaEnricher.enrich(upsert, msg);

      const topic = this.kafkaServiceQueueService.upsertMessage();
      await this.streamProducerService.send(topic, upsert);
    } catch (error) {
      console.error('[wwebjs] handleIncomingMessage failed:', {
        id: getMessageIdSerialized(msg),
        fromMe: msg.fromMe,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleCiphertextFailed(msg: Message): void {
    const rawData = (
      msg as unknown as {
        _data?: {
          subtype?: unknown;
        };
      }
    )._data;

    const subtype = getNonEmptyString(rawData?.subtype);

    console.warn('[wwebjs] message_ciphertext_failed', {
      id: getMessageIdSerialized(msg),
      from: msg.from,
      to: msg.to,
      type: msg.type,
      subtype,
      fromMe: msg.fromMe,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
    });
  }

  private async handlePinnedMessage(
    msg: Message,
    pinData?: IWwebjsPinEventData
  ): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    if (this.shouldSkipPinnedMessage(msg, pinData)) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, msg);
    if (!resolvedJids) return;
    if (this.shouldSkipResolvedJids(resolvedJids)) return;

    const [pushName, photo] = await Promise.all([
      this.resolvePushName(client, msg, resolvedJids),
      this.resolvePhotoForMessage(client, msg, resolvedJids),
    ]);

    const upsert = await wwebjsMessageToUpsert(
      msg,
      resolvedJids,
      pushName,
      pinData
    );
    if (!upsert) return;
    upsert.photo = photo ?? null;

    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private extractNameFromContact(contact: unknown): string | undefined {
    const contactPushName = normalizeNameCandidate(
      (contact as { pushname?: unknown } | undefined)?.pushname
    );
    if (contactPushName) {
      return contactPushName;
    }

    const contactShortName = normalizeNameCandidate(
      (contact as { shortName?: unknown } | undefined)?.shortName
    );
    if (contactShortName) {
      return contactShortName;
    }

    return normalizeNameCandidate(
      (contact as { name?: unknown } | undefined)?.name
    );
  }

  private async getContactNameById(
    getContactById: (contactId: string) => Promise<unknown>,
    contactId: string
  ): Promise<string | undefined> {
    try {
      const contact = await getContactById(contactId);
      if (
        typeof (contact as { isMe?: unknown } | undefined)?.isMe ===
          'boolean' &&
        (contact as { isMe?: boolean }).isMe
      ) {
        return undefined;
      }
      return this.extractNameFromContact(contact);
    } catch {
      return undefined;
    }
  }

  private async removeSelfContactCandidates(
    getContactById: (contactId: string) => Promise<unknown>,
    candidates: string[]
  ): Promise<string[]> {
    if (!candidates.length) {
      return candidates;
    }

    const filtered: string[] = [];

    for (const candidate of candidates) {
      try {
        const contact = await getContactById(candidate);
        const isMe =
          typeof (contact as { isMe?: unknown } | undefined)?.isMe ===
            'boolean' && (contact as { isMe?: boolean }).isMe;

        if (isMe) {
          continue;
        }
      } catch {}

      filtered.push(candidate);
    }

    return filtered;
  }

  private async resolveNameFromContactCandidates(
    getContactById: (contactId: string) => Promise<unknown>,
    candidates: string[]
  ): Promise<string | undefined> {
    for (const candidate of candidates) {
      const name = await this.getContactNameById(getContactById, candidate);
      if (name) {
        return name;
      }
    }

    return undefined;
  }

  private async getCachedName(
    candidates: string[]
  ): Promise<string | null | undefined> {
    let hasNoNameCache = false;

    for (const candidate of candidates) {
      try {
        const cached = await this.redis.get(
          `${this.NAME_CACHE_PREFIX}${candidate}`
        );
        if (!cached) {
          continue;
        }

        if (cached === this.NAME_CACHE_NO_NAME) {
          hasNoNameCache = true;
          continue;
        }

        return cached;
      } catch {}
    }

    return hasNoNameCache ? null : undefined;
  }

  private cacheName(candidates: string[], name: string): void {
    const unique = new Set(candidates);
    for (const candidate of unique) {
      this.redis
        .set(
          `${this.NAME_CACHE_PREFIX}${candidate}`,
          name,
          'EX',
          this.NAME_CACHE_TTL
        )
        .catch(() => {});
    }
  }

  private cacheNoName(candidates: string[]): void {
    const unique = new Set(candidates);
    for (const candidate of unique) {
      this.redis
        .set(
          `${this.NAME_CACHE_PREFIX}${candidate}`,
          this.NAME_CACHE_NO_NAME,
          'EX',
          this.NAME_CACHE_NO_NAME_TTL
        )
        .catch(() => {});
    }
  }

  private async resolvePushName(
    client: Client,
    msg: Message,
    resolvedJids: WwebjsResolvedJids
  ): Promise<string | undefined> {
    const raw = msg as unknown as {
      _data?: {
        notifyName?: unknown;
      };
    };

    const rawNotifyName = normalizeNameCandidate(raw._data?.notifyName);

    if (msg.fromMe) {
      let contactCandidates = this.removeSelfPhotoCandidates(
        client,
        await this.buildPhotoCandidates(client, [
          msg.to,
          resolvedJids.remoteJid,
          resolvedJids.remoteJidAlt,
          getMessageRemoteFromId(msg),
        ])
      );
      if (!contactCandidates.length) {
        return undefined;
      }

      const cachedName = await this.getCachedName(contactCandidates);
      if (cachedName === null) {
        return undefined;
      }
      if (cachedName) {
        return cachedName;
      }

      const getContactById = (
        client as unknown as {
          getContactById?: (contactId: string) => Promise<unknown>;
        }
      ).getContactById;

      if (typeof getContactById === 'function') {
        contactCandidates = await this.removeSelfContactCandidates(
          (contactId) => getContactById.call(client, contactId),
          contactCandidates
        );
      }

      if (!contactCandidates.length) {
        return undefined;
      }

      if (typeof getContactById === 'function') {
        const contactName = await this.resolveNameFromContactCandidates(
          (contactId) => getContactById.call(client, contactId),
          contactCandidates
        );
        if (contactName) {
          this.cacheName(contactCandidates, contactName);
          return contactName;
        }
      }

      this.cacheNoName(contactCandidates);
      return undefined;
    }

    if (rawNotifyName) {
      return rawNotifyName;
    }

    try {
      const contact = await msg.getContact();
      const contactName = this.extractNameFromContact(contact);
      if (contactName) {
        return contactName;
      }
    } catch {}

    try {
      const chat = await msg.getChat();
      const chatName = normalizeNameCandidate(
        (chat as { name?: unknown } | undefined)?.name
      );
      if (chatName) {
        return chatName;
      }
    } catch {}

    return undefined;
  }

  private async buildPhotoCandidates(
    client: Client,
    rawJids: Array<string | undefined>
  ): Promise<string[]> {
    const candidates = new Set<string>();

    for (const raw of rawJids) {
      if (!raw) continue;

      const normalized = normalizeJid(raw) ?? raw;
      if (!normalized) continue;
      if (this.shouldSkipChat(normalized)) continue;
      if (this.isGroupOrBroadcastJid(normalized)) continue;

      if (this.isLidJid(normalized)) {
        const resolvedPhone = await this.resolvePhoneFromLid(
          client,
          normalized
        );
        if (resolvedPhone) {
          candidates.add(`${resolvedPhone}@c.us`);
          candidates.add(`${resolvedPhone}@s.whatsapp.net`);
        }
        continue;
      }

      candidates.add(normalized);

      const phone = getPhoneFromJid(normalized, null);
      if (!phone) continue;

      candidates.add(`${phone}@c.us`);
      candidates.add(`${phone}@s.whatsapp.net`);
    }

    return Array.from(candidates);
  }

  private buildSelfPhotoCandidates(client: Client): Set<string> {
    const selfCandidates = new Set<string>();

    const infoWidSerialized = (
      client.info?.wid as { _serialized?: string } | undefined
    )?._serialized;
    const selfJidRaw = getNonEmptyString(infoWidSerialized);
    if (!selfJidRaw) {
      return selfCandidates;
    }

    const normalizedSelf = normalizeJid(selfJidRaw) ?? selfJidRaw;
    selfCandidates.add(normalizedSelf);

    const selfPhone = getPhoneFromJid(normalizedSelf, null);
    if (!selfPhone) {
      return selfCandidates;
    }

    selfCandidates.add(`${selfPhone}@c.us`);
    selfCandidates.add(`${selfPhone}@s.whatsapp.net`);

    return selfCandidates;
  }

  private removeSelfPhotoCandidates(
    client: Client,
    candidates: string[]
  ): string[] {
    if (!candidates.length) return candidates;

    const selfCandidates = this.buildSelfPhotoCandidates(client);
    if (!selfCandidates.size) return candidates;

    return candidates.filter((candidate) => !selfCandidates.has(candidate));
  }

  private async withProfileTimeout(
    promise: Promise<string>
  ): Promise<string | undefined> {
    try {
      const timeout = new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), this.PROFILE_PIC_TIMEOUT_MS)
      );
      const result = await Promise.race([promise, timeout]);
      return getNonEmptyString(result);
    } catch {
      return undefined;
    }
  }

  private async getCachedPhoto(
    candidates: string[]
  ): Promise<string | null | undefined> {
    let hasNoPhotoCache = false;

    for (const candidate of candidates) {
      try {
        const cached = await this.redis.get(
          `${this.PHOTO_CACHE_PREFIX}${candidate}`
        );
        if (!cached) {
          continue;
        }

        if (cached === this.PHOTO_CACHE_NO_PHOTO) {
          hasNoPhotoCache = true;
          continue;
        }

        return cached;
      } catch {}
    }

    return hasNoPhotoCache ? null : undefined;
  }

  private cachePhoto(candidates: string[], photo: string): void {
    const unique = new Set(candidates);
    for (const candidate of unique) {
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
    const unique = new Set(candidates);
    for (const candidate of unique) {
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

  private async fetchPhotoByCandidates(
    client: Client,
    candidates: string[]
  ): Promise<string | undefined> {
    for (const candidate of candidates) {
      const photo = await this.withProfileTimeout(
        client.getProfilePicUrl(candidate)
      );
      if (photo) {
        return photo;
      }
    }

    return undefined;
  }

  private async resolvePhotoForMessage(
    client: Client,
    msg: Message,
    resolvedJids: WwebjsResolvedJids
  ): Promise<string | undefined> {
    const directPeerJid = msg.fromMe ? msg.to : msg.from;
    let candidates = this.removeSelfPhotoCandidates(
      client,
      await this.buildPhotoCandidates(client, [
        resolvedJids.remoteJid,
        resolvedJids.remoteJidAlt,
        directPeerJid,
        getMessageRemoteFromId(msg),
      ])
    );
    if (msg.fromMe) {
      const getContactById = (
        client as unknown as {
          getContactById?: (contactId: string) => Promise<unknown>;
        }
      ).getContactById;

      if (typeof getContactById === 'function') {
        candidates = await this.removeSelfContactCandidates(
          (contactId) => getContactById.call(client, contactId),
          candidates
        );
      }
    }

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

    if (!msg.fromMe) {
      try {
        const contact = await msg.getContact();
        const photoFromContact = await this.withProfileTimeout(
          contact.getProfilePicUrl()
        );
        if (photoFromContact) {
          this.cachePhoto(candidates, photoFromContact);
          return photoFromContact;
        }
      } catch {}
    }

    const photoFromClient = await this.fetchPhotoByCandidates(
      client,
      candidates
    );
    if (photoFromClient) {
      this.cachePhoto(candidates, photoFromClient);
      return photoFromClient;
    }

    this.cacheNoPhoto(candidates);
    return undefined;
  }

  private async resolvePhotoForCall(
    client: Client,
    jid: string
  ): Promise<string | undefined> {
    const candidates = await this.buildPhotoCandidates(client, [jid]);
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

    const photo = await this.fetchPhotoByCandidates(client, candidates);
    if (photo) {
      this.cachePhoto(candidates, photo);
      return photo;
    }

    this.cacheNoPhoto(candidates);
    return undefined;
  }

  private async handleRevokeEveryone(
    after: Message,
    before: Message | undefined
  ): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, after);
    if (!resolvedJids) return;
    if (this.shouldSkipResolvedJids(resolvedJids)) return;

    const upsert = buildDeleteMessageUpsert(after, before, resolvedJids);
    if (!upsert) return;
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handleRevokeMe(msg: Message): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const rawFromMe = (
      msg as unknown as {
        _data?: { id?: { fromMe?: unknown } };
      }
    )._data?.id?.fromMe;
    const isFromMeMessage =
      typeof msg.fromMe === 'boolean'
        ? msg.fromMe
        : typeof rawFromMe === 'boolean'
          ? rawFromMe
          : false;

    if (isFromMeMessage) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, msg);
    if (!resolvedJids) return;
    if (this.shouldSkipResolvedJids(resolvedJids)) return;

    const upsert = buildRevokeMeUpsert(msg, resolvedJids);
    if (!upsert) return;
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handleMessageEdit(
    message: Message,
    newBody: string,
    prevBody?: string
  ): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const normalizedNewBody =
      getNonEmptyString(newBody) ?? getNonEmptyString(message.body);
    if (!normalizedNewBody) {
      return;
    }

    const normalizedPrevBody = getNonEmptyString(prevBody);
    if (normalizedPrevBody && normalizedPrevBody === normalizedNewBody) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, message);
    if (!resolvedJids) return;
    if (this.shouldSkipResolvedJids(resolvedJids)) return;

    const upsert = buildEditMessageUpsert(
      message,
      normalizedNewBody,
      resolvedJids
    );
    if (!upsert) return;
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handleMessageReaction(
    client: Client,
    reaction: WwebjsReactionEvent
  ): Promise<void> {
    const parentMsgId = getReactionMsgIdSerialized(reaction);
    if (!parentMsgId) return;

    let remoteJid = '';
    let remoteJidAlt: string | undefined;
    try {
      const parentMsg = await client.getMessageById(parentMsgId);
      if (parentMsg) {
        const resolvedJids = await this.resolveRemoteJids(client, parentMsg);
        remoteJid = resolvedJids?.remoteJid ?? '';
        remoteJidAlt = resolvedJids?.remoteJidAlt;
      }
    } catch {}

    if (!remoteJid) {
      const fallbackRemote = getRemoteFromSerializedMessageId(parentMsgId);
      const normalizedFallback = fallbackRemote
        ? (normalizeJid(fallbackRemote) ?? fallbackRemote)
        : undefined;
      remoteJid = normalizedFallback ?? '';
    }

    if (!remoteJid) {
      return;
    }
    if (
      this.shouldSkipChat(remoteJid) ||
      this.isGroupOrBroadcastJid(remoteJid)
    ) {
      return;
    }

    const reactionId = getReactionIdSerialized(reaction);
    const emoji = getReactionEmoji(reaction);
    const senderId = getReactionSenderId(reaction);
    const normalizedSenderId = normalizeJidForComparison(senderId);
    const myJid =
      (this.currentClient?.info?.wid as { _serialized?: string } | undefined)
        ?._serialized ?? '';
    const fromMeBySender =
      (normalizedSenderId || senderId) && myJid
        ? isSameJidAccount(normalizedSenderId ?? senderId, myJid)
        : undefined;
    const fromMe = fromMeBySender ?? getReactionFromMeHint(reaction) ?? false;
    const participant =
      normalizedSenderId ??
      senderId ??
      (fromMe ? (normalizeJidForComparison(myJid) ?? myJid) : undefined);
    const timestamp =
      getReactionTimestampSeconds(reaction) ?? Math.floor(Date.now() / 1000);

    const upsert = buildReactionUpsert(
      remoteJid,
      remoteJidAlt,
      reactionId,
      parentMsgId,
      emoji,
      fromMe,
      participant,
      timestamp
    );
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handleCall(call: {
    id?: string;
    from?: string;
    fromMe?: boolean;
    timestamp?: number;
    isVideo?: boolean;
    reject?: () => Promise<void>;
  }): Promise<void> {
    const client = this.currentClient;
    if (!client) return;

    const jid = call.from;
    if (!jid) return;
    if (call.fromMe) return;
    if (this.shouldSkipChat(jid)) return;

    const callKey = `${jid}:${call.id ?? ''}:offer`;
    if (this.processedCalls.has(callKey)) return;
    this.processedCalls.set(callKey, Date.now());

    let phone = getPhoneFromJid(jid, null);
    if (!phone && this.isLidJid(jid)) {
      const resolved = await this.resolvePhoneFromLid(client, jid);
      phone = resolved ?? null;
    }
    if (!phone) return;

    const upsert = buildCallUpsert(
      jid,
      null,
      phone,
      call.id,
      call.timestamp,
      Boolean(call.isVideo)
    );
    const photo = await this.resolvePhotoForCall(client, jid);
    upsert.photo = photo ?? null;
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);

    try {
      const callAction =
        await this.balanceWorkerStatusGrpcClientService.resolveIncomingCallAction(
          {
            worker_id: wwebjsEnvironment.wwebjsWorkerId,
            account_id: wwebjsEnvironment.wwebjsAccountId,
            call_jid: jid,
            call_phone: phone,
            is_video: Boolean(call.isVideo),
          }
        );

      if (callAction.reject_call && call.reject) {
        call.reject().catch(() => {});
      }

      const text = callAction.show_message_text?.trim();
      if (callAction.show_message_on_call && text) {
        const sentMessage = await this.sendMessageWithConfirmation(
          client,
          jid,
          text
        );
        const systemMessageUpsert = this.buildCallAutoReplySystemUpsert(
          jid,
          text,
          getMessageIdSerialized(sentMessage),
          sentMessage.timestamp
        );
        systemMessageUpsert.photo = photo ?? null;
        await this.streamProducerService.send(topic, systemMessageUpsert);
      }
    } catch (error) {
      console.error('[wwebjs] resolveIncomingCallAction failed:', error);
    }
  }

  private buildCallAutoReplySystemUpsert(
    jid: string,
    messageText: string,
    sentMessageId?: string,
    sentTimestamp?: number
  ): IUpsertMessage {
    const normalizedJid = normalizeJid(jid) ?? jid;
    const normalizedJidAlt = normalizedJid !== jid ? jid : undefined;
    const timestamp =
      typeof sentTimestamp === 'number' && sentTimestamp > 0
        ? sentTimestamp > 1_000_000_000_000
          ? Math.floor(sentTimestamp / 1000)
          : Math.floor(sentTimestamp)
        : Math.floor(Date.now() / 1000);
    const keyId = `call_auto_system_${sentMessageId ?? Date.now().toString()}`;

    return {
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      type: EMessageType.system,
      message: {
        key: {
          id: keyId,
          remoteJid: normalizedJid,
          remoteJidAlt: normalizedJidAlt,
          fromMe: true,
        },
        message: {
          conversation: messageText,
        },
        messageTimestamp: timestamp,
      },
      has_quoted: false,
      photo: null,
    };
  }

  private mapAckToPatch(ack: number): MessageSummaryPatch | null {
    if (ack < ACK_SERVER) return null;
    const patch: MessageSummaryPatch = { is_sent: true };
    if (ack >= ACK_DEVICE) {
      patch.is_delivered = true;
    }
    if (ack >= ACK_READ || ack === ACK_PLAYED) {
      patch.is_seen = true;
      patch.is_delivered = true;
    }
    return patch;
  }

  private async handleMessageAck(msg: Message, ack: number): Promise<void> {
    if (!msg.fromMe) return;

    const messageId = getMessageIdSerialized(msg);
    if (!messageId) return;

    if (ack === ACK_ERROR) {
      this.deliveryConfirmation.markFailed(messageId);
      return;
    }

    if (ack >= ACK_SERVER) {
      this.deliveryConfirmation.markSent(messageId);
    }

    const remoteJidRaw =
      getMessageRemoteFromId(msg) ||
      (msg.fromMe ? msg.to || msg.from || '' : msg.from || msg.to || '');
    const remoteJid = remoteJidRaw
      ? (normalizeJid(remoteJidRaw) ?? remoteJidRaw)
      : undefined;

    if (remoteJid && this.shouldSkipChat(remoteJid)) return;

    const patch = this.mapAckToPatch(ack);
    if (!patch) return;

    const statusUpdate: IMessageStatusUpdate = {
      account_id: wwebjsEnvironment.wwebjsAccountId,
      message_id: messageId,
      patch,
      key: {
        id: messageId,
        remoteJid,
        fromMe: true,
      },
    };

    const topic = this.kafkaServiceQueueService.updateMessageStatus();
    const kafkaKey = `${wwebjsEnvironment.wwebjsAccountId}:${messageId}:${MessageStatusService.hashPatch(patch)}`;
    await this.streamProducerService.send(topic, statusUpdate, kafkaKey);
  }

  private async sendMessageWithConfirmation(
    client: Client,
    jid: string,
    text: string
  ): Promise<Message> {
    let lastError: unknown = null;
    let lastMessageId: string | undefined;
    let lastOutcome: 'failed' | 'timeout' = 'timeout';
    let hadConfirmationFailure = false;

    for (
      let attempt = 1;
      attempt <= this.SEND_CONFIRMATION_MAX_ATTEMPTS;
      attempt++
    ) {
      try {
        const sentMessage = await client.sendMessage(jid, text, {
          waitUntilMsgSent: true,
        });
        const sentMessageId = getMessageIdSerialized(sentMessage);
        if (!sentMessageId) {
          throw new Error(
            'Wwebjs call auto-reply send returned message without id'
          );
        }

        lastMessageId = sentMessageId;
        const outcome = await this.deliveryConfirmation.waitForOutcome(
          sentMessageId,
          this.SEND_CONFIRMATION_TIMEOUT_MS
        );

        if (outcome === 'sent') {
          return sentMessage;
        }

        hadConfirmationFailure = true;
        lastOutcome = outcome === 'failed' ? 'failed' : 'timeout';
        lastError =
          outcome === 'failed'
            ? new Error(
                `Message delivery failed acknowledgement for ${sentMessageId}`
              )
            : new Error(
                `Message delivery confirmation timeout for ${sentMessageId}`
              );
      } catch (error) {
        lastError = error;
      }

      if (attempt < this.SEND_CONFIRMATION_MAX_ATTEMPTS) {
        const backoffIndex = Math.min(
          attempt - 1,
          this.SEND_CONFIRMATION_BACKOFF_MS.length - 1
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.SEND_CONFIRMATION_BACKOFF_MS[backoffIndex])
        );
      }
    }

    if (hadConfirmationFailure) {
      throw new MessageDeliveryConfirmationFailedError({
        maxAttempts: this.SEND_CONFIRMATION_MAX_ATTEMPTS,
        lastMessageId,
        lastOutcome,
        cause: lastError,
      });
    }

    throw (
      (lastError as Error) ?? new Error('Wwebjs call auto-reply send failed')
    );
  }

  unbind(): void {
    this.currentClient = undefined;
    this.processedCalls.clear();
    this.processedPinMessages.clear();
    this.processedIncomingMessages.clear();
  }

  async markRead(keys: IMessageKeyLike[]): Promise<void> {
    if (!this.currentClient) {
      return;
    }

    const chatIds = new Set<string>();

    for (let i = 0; i < keys.length; i++) {
      const jid = keys[i].remoteJid ?? keys[i].remote_jid;
      if (jid) {
        chatIds.add(jid);
      }
    }

    const client = this.currentClient;
    const promises: Promise<unknown>[] = [];
    for (const chatId of chatIds) {
      promises.push(client.sendSeen(chatId));
    }

    await Promise.all(promises);
  }

  updateRejectCallConfig(reject: boolean): void {
    this.rejectCallConfig = reject;
  }

  getRejectCallConfig(): boolean {
    return this.rejectCallConfig;
  }
}
