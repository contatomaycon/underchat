import { inject, singleton } from 'tsyringe';
import type { Client, Message } from 'whatsapp-web.js';
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
    const value = msg.id as { remote?: string; _serialized?: string };

    if (typeof value.remote === 'string' && value.remote) {
      return value.remote;
    }

    if (typeof value._serialized === 'string') {
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

  constructor(
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
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
    client.on('message_edit', (message: Message, newBody: string) => {
      void this.handleMessageEdit(message, newBody);
    });
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
  }

  private shouldSkipChat(remoteJid: string): boolean {
    if (!remoteJid) return true;
    if (remoteJid === 'status@broadcast') return true;
    if (remoteJid.endsWith('@broadcast')) return true;
    return false;
  }

  private isGroupOrBroadcastJid(jid: string): boolean {
    return jid.endsWith('@g.us') || jid.endsWith('@broadcast');
  }

  private async resolveRemoteJids(
    client: Client,
    msg: Message
  ): Promise<WwebjsResolvedJids | null> {
    const fallbackRaw = msg.fromMe
      ? msg.to || msg.from || ''
      : msg.from || msg.to || '';
    const fallbackJid = normalizeJid(fallbackRaw) ?? fallbackRaw;

    if (!fallbackJid || this.shouldSkipChat(fallbackJid)) {
      return null;
    }

    if (this.isGroupOrBroadcastJid(fallbackJid)) {
      return { remoteJid: fallbackJid };
    }

    const messageIdRemoteRaw = getMessageRemoteFromId(msg);
    const messageIdRemote = messageIdRemoteRaw
      ? (normalizeJid(messageIdRemoteRaw) ?? messageIdRemoteRaw)
      : undefined;

    const userIds = Array.from(
      new Set([fallbackJid, messageIdRemote].filter(Boolean))
    ) as string[];

    if (!userIds.length) {
      return { remoteJid: fallbackJid };
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

      if (pn && pn !== fallbackJid) {
        return {
          remoteJid: pn,
          remoteJidAlt: fallbackJid,
        };
      }

      if (lid && lid !== fallbackJid) {
        return {
          remoteJid: fallbackJid,
          remoteJidAlt: lid,
        };
      }
    } catch {}

    return { remoteJid: fallbackJid };
  }

  private async handleIncomingMessage(msg: Message): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const [resolvedJids, pushName] = await Promise.all([
      this.resolveRemoteJids(client, msg),
      this.resolvePushName(msg),
    ]);
    if (!resolvedJids) return;

    const upsert = wwebjsMessageToUpsert(msg, resolvedJids, pushName);
    if (!upsert) return;

    await this.upsertMediaEnricher.enrich(upsert, msg);

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

    try {
      const contact = await msg.getContact();
      const contactName = normalizeNameCandidate(
        (contact as { name?: unknown } | undefined)?.name
      );
      if (contactName) {
        return contactName;
      }

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
    } catch {}

    if (rawNotifyName) {
      return rawNotifyName;
    }

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
    newBody: string
  ): Promise<void> {
    const client = this.currentClient;
    if (!client) {
      return;
    }

    const resolvedJids = await this.resolveRemoteJids(client, message);
    if (!resolvedJids) return;

    const upsert = buildEditMessageUpsert(message, newBody, resolvedJids);
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
    const jid = call.from;
    if (!jid) return;
    if (call.fromMe) return;

    const callKey = `${jid}:${call.id ?? ''}:offer`;
    if (this.processedCalls.has(callKey)) return;
    this.processedCalls.set(callKey, Date.now());

    const phone = getPhoneFromJid(jid, null);
    if (!phone) return;

    const upsert = buildCallUpsert(jid, null, phone);
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

    const patch = this.mapAckToPatch(ack);
    if (!patch) return;

    const statusUpdate: IMessageStatusUpdate = {
      account_id: wwebjsEnvironment.wwebjsAccountId,
      message_id: messageId,
      patch,
    };

    const topic = this.kafkaServiceQueueService.updateMessageStatus();
    const kafkaKey = `${wwebjsEnvironment.wwebjsAccountId}:${messageId}:${MessageStatusService.hashPatch(patch)}`;
    await this.streamProducerService.send(topic, statusUpdate, kafkaKey);
  }

  unbind(): void {
    this.currentClient = undefined;
    this.processedCalls.clear();
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
