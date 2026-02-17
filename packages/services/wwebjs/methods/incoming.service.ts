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
import {
  type WwebjsPinEventData,
  wwebjsMessageToUpsert,
} from '../util/wwebjsMessageToUpsert';
import {
  buildCallUpsert,
  buildDeleteMessageUpsert,
  buildEditMessageUpsert,
  buildReactionUpsert,
  buildRevokeMeUpsert,
} from '../util/wwebjsUpsertBuilders';
import { WwebjsUpsertMediaEnricher } from './upsertMediaEnricher.service';
import { normalizeJid } from '@core/common/functions/normalizeJid';

const ACK_DEVICE = 2;
const ACK_READ = 3;
const ACK_PLAYED = 4;

interface WwebjsResolvedJids {
  remoteJid: string;
  remoteJidAlt?: string;
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

function getReactionMsgIdSerialized(reaction: {
  msgId?: { _serialized?: string; id?: string };
}): string | undefined {
  const m = reaction.msgId;
  if (!m) return undefined;
  if (typeof m === 'object' && m !== null && '_serialized' in m) {
    return (m as { _serialized: string })._serialized;
  }
  return undefined;
}

function getReactionIdSerialized(reaction: {
  id?: { _serialized?: string };
}): string {
  const m = reaction.id;
  if (typeof m === 'object' && m !== null && '_serialized' in (m ?? {})) {
    return (m as { _serialized: string })._serialized;
  }
  return `react_${Date.now()}`;
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

@singleton()
export class WwebjsIncomingMessageService {
  private currentClient: Client | undefined;
  private rejectCallConfig = false;
  private readonly processedCalls = new Map<string, number>();
  private readonly processedPinMessages = new Map<string, number>();
  private readonly PIN_MESSAGE_CACHE_TTL_MS = 15000;
  private readonly PHOTO_CACHE_TTL = 86400;
  private readonly PHOTO_CACHE_NO_PHOTO_TTL = 300;
  private readonly PHOTO_CACHE_PREFIX = 'photo:jid:';
  private readonly PHOTO_CACHE_NO_PHOTO = '__no_photo__';
  private readonly PROFILE_PIC_TIMEOUT_MS = 3000;

  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject('Redis') private readonly redis: Redis,
    @inject(WwebjsUpsertMediaEnricher)
    private readonly upsertMediaEnricher: WwebjsUpsertMediaEnricher
  ) {}

  bindTo(client: Client): void {
    this.currentClient = client;
    client.on('message', (msg: Message) => {
      console.log('Messages upsert');
      console.dir(msg, { depth: null, colors: true });

      void this.handleIncomingMessage(msg);
    });
    client.on('message_revoke_everyone', (after: Message, before?: Message) => {
      void this.handleRevokeEveryone(after, before);
    });
    client.on('message_revoke_me', (msg: Message) => {
      void this.handleRevokeMe(msg);
    });
    client.on(
      'message_edit',
      (message: Message, newBody: string, prevBody: string) => {
        void this.handleMessageEdit(message, newBody, prevBody);
      }
    );
    client.on(
      'message_reaction',
      (reaction: {
        id?: { _serialized?: string };
        msgId?: { _serialized?: string };
        reaction?: string;
        senderId?: string;
        timestamp?: number;
      }) => {
        void this.handleMessageReaction(client, reaction);
      }
    );
    client.on(
      'call',
      (call: {
        id?: string;
        from?: string;
        fromMe?: boolean;
        reject?: () => Promise<void>;
      }) => {
        void this.handleCall(call);
      }
    );
    client.on('message_ack', (msg: Message, ack: number) => {
      void this.handleMessageAck(msg, ack);
    });
    client.on('message_pinned', (message: Message, pinData) => {
      void this.handlePinnedMessage(message, pinData);
    });
  }

  private shouldSkipChat(remoteJid: string): boolean {
    if (!remoteJid) return true;
    if (remoteJid === 'status@broadcast') return true;
    if (remoteJid.endsWith('@broadcast')) return true;
    return false;
  }

  private shouldSkipPinnedMessage(msg: Message): boolean {
    const messageId = getMessageIdSerialized(msg);
    if (!messageId) {
      return false;
    }

    const now = Date.now();
    for (const [key, timestamp] of this.processedPinMessages.entries()) {
      if (now - timestamp > this.PIN_MESSAGE_CACHE_TTL_MS) {
        this.processedPinMessages.delete(key);
      }
    }

    if (this.processedPinMessages.has(messageId)) {
      return true;
    }

    this.processedPinMessages.set(messageId, now);
    return false;
  }

  private isGroupOrBroadcastJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@broadcast');
  }

  private async resolveRemoteJids(
    client: Client,
    msg: Message
  ): Promise<WwebjsResolvedJids | null> {
    const messageIdRemoteRaw = getMessageRemoteFromId(msg);
    const messageIdRemote = messageIdRemoteRaw
      ? (normalizeJid(messageIdRemoteRaw) ?? messageIdRemoteRaw)
      : undefined;

    const fallbackRaw = msg.fromMe
      ? msg.to || msg.from || ''
      : msg.from || msg.to || '';
    const fallbackJid = normalizeJid(fallbackRaw) ?? fallbackRaw;

    const primaryJid = fallbackJid || messageIdRemote || '';

    if (!primaryJid || this.shouldSkipChat(primaryJid)) {
      return null;
    }

    if (this.isGroupOrBroadcastJid(primaryJid)) {
      return { remoteJid: primaryJid };
    }

    const userIds = Array.from(
      new Set([primaryJid, messageIdRemote].filter(Boolean))
    ) as string[];

    if (!userIds.length) {
      return { remoteJid: primaryJid };
    }

    try {
      const mappings = await client.getContactLidAndPhone(userIds);
      const first = mappings.find((entry) => entry?.lid || entry?.pn);
      const lid = first?.lid
        ? (normalizeJid(first.lid) ?? first.lid)
        : undefined;
      const pn = first?.pn ? (normalizeJid(first.pn) ?? first.pn) : undefined;

      if (pn && lid && pn !== lid) {
        return {
          remoteJid: pn,
          remoteJidAlt: lid,
        };
      }

      if (pn && pn !== primaryJid) {
        return {
          remoteJid: pn,
          remoteJidAlt: primaryJid,
        };
      }

      if (lid && lid !== primaryJid) {
        return {
          remoteJid: primaryJid,
          remoteJidAlt: lid,
        };
      }
    } catch {}

    return { remoteJid: primaryJid };
  }

  private async handleIncomingMessage(msg: Message): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, msg);
    if (!resolvedJids) return;

    const [pushName, photo] = await Promise.all([
      this.resolvePushName(msg),
      this.resolvePhotoForMessage(client, msg, resolvedJids),
    ]);

    const upsert = await wwebjsMessageToUpsert(msg, resolvedJids, pushName);
    if (!upsert) return;
    upsert.photo = photo ?? null;

    await this.upsertMediaEnricher.enrich(upsert, msg);

    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handlePinnedMessage(
    msg: Message,
    pinData?: WwebjsPinEventData
  ): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    if (this.shouldSkipPinnedMessage(msg)) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, msg);
    if (!resolvedJids) return;

    const [pushName, photo] = await Promise.all([
      this.resolvePushName(msg),
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

  private async resolvePushName(msg: Message): Promise<string | undefined> {
    const raw = msg as unknown as {
      _data?: {
        notifyName?: unknown;
      };
    };

    const rawNotifyName = normalizeNameCandidate(raw._data?.notifyName);
    if (rawNotifyName) {
      return rawNotifyName;
    }

    try {
      const contact = await msg.getContact();
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

      const contactName = normalizeNameCandidate(
        (contact as { name?: unknown } | undefined)?.name
      );
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

  private buildPhotoCandidates(rawJids: Array<string | undefined>): string[] {
    const candidates = new Set<string>();

    for (const raw of rawJids) {
      if (!raw) continue;

      const normalized = normalizeJid(raw) ?? raw;
      if (!normalized) continue;
      if (this.shouldSkipChat(normalized)) continue;
      if (this.isGroupOrBroadcastJid(normalized)) continue;

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
    const candidates = this.removeSelfPhotoCandidates(
      client,
      this.buildPhotoCandidates([
        resolvedJids.remoteJid,
        resolvedJids.remoteJidAlt,
        directPeerJid,
        getMessageRemoteFromId(msg),
      ])
    );
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
    const candidates = this.buildPhotoCandidates([jid]);
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

    const resolvedJids = await this.resolveRemoteJids(client, msg);
    if (!resolvedJids) return;

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
    reaction: {
      id?: { _serialized?: string };
      msgId?: { _serialized?: string };
      reaction?: string;
      senderId?: string;
      timestamp?: number;
    }
  ): Promise<void> {
    const parentMsgId = getReactionMsgIdSerialized(reaction);
    if (!parentMsgId) return;

    let remoteJid: string;
    let remoteJidAlt: string | undefined;
    try {
      const parentMsg = await client.getMessageById(parentMsgId);
      if (!parentMsg) {
        return;
      }

      const resolvedJids = await this.resolveRemoteJids(client, parentMsg);
      remoteJid = resolvedJids?.remoteJid ?? '';
      remoteJidAlt = resolvedJids?.remoteJidAlt;
    } catch {
      return;
    }
    if (!remoteJid) return;

    const reactionId = getReactionIdSerialized(reaction);
    const emoji = reaction.reaction ?? '';
    const myJid =
      (this.currentClient?.info?.wid as { _serialized?: string } | undefined)
        ?._serialized ?? '';
    const fromMe = Boolean(
      reaction.senderId &&
      myJid &&
      (reaction.senderId === myJid ||
        reaction.senderId.replace(/@s\.whatsapp\.net$/, '') ===
          myJid.replace(/@s\.whatsapp\.net$/, ''))
    );
    const participant = remoteJid.includes('@g.us')
      ? reaction.senderId
      : undefined;

    const upsert = buildReactionUpsert(
      remoteJid,
      remoteJidAlt,
      reactionId,
      parentMsgId,
      emoji,
      fromMe,
      participant,
      reaction.timestamp ?? Math.floor(Date.now() / 1000)
    );
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);
  }

  private async handleCall(call: {
    id?: string;
    from?: string;
    fromMe?: boolean;
    reject?: () => Promise<void>;
  }): Promise<void> {
    const client = this.currentClient;
    if (!client) return;

    const jid = call.from;
    if (!jid) return;
    if (call.fromMe) return;

    const callKey = `${jid}:${call.id ?? ''}:offer`;
    if (this.processedCalls.has(callKey)) return;
    this.processedCalls.set(callKey, Date.now());

    const phone = getPhoneFromJid(jid, null);
    if (!phone) return;

    const upsert = buildCallUpsert(jid, null, phone);
    const photo = await this.resolvePhotoForCall(client, jid);
    upsert.photo = photo ?? null;
    const topic = this.kafkaServiceQueueService.upsertMessage();
    await this.streamProducerService.send(topic, upsert);

    if (this.rejectCallConfig && call.reject) {
      call.reject().catch(() => {});
    }
  }

  private mapAckToPatch(ack: number): MessageSummaryPatch | null {
    if (ack < 1) return null;
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

    const remoteJidRaw =
      getMessageRemoteFromId(msg) ||
      (msg.fromMe ? msg.to || msg.from || '' : msg.from || msg.to || '');
    const remoteJid = remoteJidRaw
      ? (normalizeJid(remoteJidRaw) ?? remoteJidRaw)
      : undefined;

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

  unbind(): void {
    this.currentClient = undefined;
    this.processedCalls.clear();
    this.processedPinMessages.clear();
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
