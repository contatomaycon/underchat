import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import {
  AnyMessageContent,
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
import { baileysEnvironment } from '@core/config/environments';
import { getChatKind } from '@core/common/functions/getChatKind';
import { EChatKind } from '@core/common/enums/EChatKind';
import { EMessageUpsertType } from '@core/common/enums/EMessageUpsertType';
import { remoteJid } from '@core/common/functions/remoteJid';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import {
  MessageSummaryPatch,
  MessageStatusService,
} from '@core/services/messageStatus.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { EMessageType } from '@core/common/enums/EMessageType';

interface PendingMessage {
  inputUpsert: IUpsertMessage;
  messageKey: string;
  retries: number;
  addedAt: number;
}

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;
  private readonly processedMessages = new Map<string, number>();
  private readonly processedCalls = new Map<string, number>();
  private readonly MAX_SIZE = 100000;
  private readonly DEDUP_WINDOW_MS = 3000;
  private cleanupInterval?: NodeJS.Timeout;
  private rejectCallConfig: boolean = false;

  private readonly pendingQueue: PendingMessage[] = [];
  private isProcessingQueue = false;
  private readonly MAX_RETRIES = 100;
  private readonly RETRY_BASE_DELAY_MS = 50;
  private readonly MAX_RETRY_DELAY_MS = 5000;
  private readonly MAX_QUEUE_SIZE = 500000;
  private readonly DESTROY_TIMEOUT_MS = 30000;
  private queueProcessorInterval?: NodeJS.Timeout;
  private isDestroying = false;

  private readonly PHOTO_CACHE_TTL = 86400;
  private readonly PHOTO_CACHE_PREFIX = 'photo:jid:';

  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis
  ) {
    this.startCleanupInterval();
    this.startQueueProcessor();
  }

  private getMessageKey(m: WAMessage): string | null {
    const jid = remoteJid(m.key);
    const jidAlt = remoteJidAlt(m.key);
    const id = m.key?.id;
    const fromMe = m.key?.fromMe ?? false;

    if (!id) return null;

    const jidToUse = jid || jidAlt;
    if (!jidToUse) return null;

    return `${jidToUse}:${id}:${fromMe}`;
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
    let batch: PendingMessage[] = [];

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
        console.log(`[RECOVERY] Restored ${batch.length} messages to queue`);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async sendToKafkaWithRetry(item: PendingMessage): Promise<void> {
    const delay = Math.min(
      this.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries),
      this.MAX_RETRY_DELAY_MS
    );

    if (item.retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.upsertMessage(),
      item.inputUpsert,
      item.messageKey
    );
  }

  private enqueueMessage(
    inputUpsert: IUpsertMessage,
    messageKey: string
  ): PendingMessage | null {
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

    const item: PendingMessage = {
      inputUpsert,
      messageKey,
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
        this.processMessage(socket, m, e.type);
      }
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

    socket.ev.on('messaging-history.set', () => {});

    socket.ev.on('call', (callEvents: WACallEvent[]) => {
      if (!callEvents) return;

      const eventsArray = Array.isArray(callEvents) ? callEvents : [callEvents];

      for (const callEvent of eventsArray) {
        this.processCallEvent(socket, callEvent);
      }
    });
  }

  private processMessage(
    socket: WASocket,
    m: WAMessage,
    upsertType: string
  ): void {
    try {
      if (m.category === 'peer') return;

      const chatKind = getChatKind(m);
      if (
        chatKind !== EChatKind.user ||
        upsertType !== EMessageUpsertType.notify
      ) {
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
      const hasQuoted = messageHasQuoted(m);

      if (!type) {
        console.warn('[WARN] Unknown message type, skipping:', messageKey);
        return;
      }

      const inputUpsert: IUpsertMessage = {
        worker_id: baileysEnvironment.baileysWorkerId,
        account_id: baileysEnvironment.baileysAccountId,
        type,
        message: m,
        photo: null,
        has_quoted: hasQuoted,
      };

      const pendingItem = this.enqueueMessage(inputUpsert, messageKey);
      if (!pendingItem) return;

      this.fetchPhotoNonBlocking(socket, pendingItem);
    } catch (error) {
      console.error('[CRITICAL] Error processing message:', error, m.key?.id);
    }
  }

  private fetchPhotoNonBlocking(
    socket: WASocket,
    pendingItem: PendingMessage,
    jid?: string
  ): void {
    const resolvedJid =
      jid ||
      remoteJid(pendingItem.inputUpsert.message?.key) ||
      remoteJidAlt(pendingItem.inputUpsert.message?.key);

    if (!resolvedJid) return;

    const cacheKey = `${this.PHOTO_CACHE_PREFIX}${resolvedJid}`;

    this.redis
      .get(cacheKey)
      .then((cachedPhoto) => {
        if (cachedPhoto) {
          if (pendingItem.retries === 0) {
            pendingItem.inputUpsert.photo = cachedPhoto;
          }
          return;
        }

        return socket
          .profilePictureUrl(resolvedJid, 'image')
          .then((photo) => {
            if (photo) {
              this.redis
                .set(cacheKey, photo, 'EX', this.PHOTO_CACHE_TTL)
                .catch(() => {});

              if (pendingItem.retries === 0) {
                pendingItem.inputUpsert.photo = photo;
              }
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
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

      const lastKnownPresence = presence?.lastKnownPresence;

      if (
        lastKnownPresence !== 'composing' &&
        lastKnownPresence !== 'available'
      ) {
        continue;
      }

      const typingEvent: IChatTyping = {
        type: 'typing',
        jid: chatJid,
        is_typing: lastKnownPresence === 'composing',
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

  private getCallKey(callEvent: WACallEvent): string | null {
    const jid = callEvent.remoteJid || callEvent.from;
    if (!jid) return null;

    const callId =
      (callEvent as { id?: string })?.id ??
      (callEvent as { callId?: string })?.callId ??
      Date.now().toString();

    return `${jid}:${callId}:${callEvent.status}`;
  }

  private processCallEvent(
    socket: WASocket,
    callEvent: WACallEvent | null
  ): void {
    try {
      if (!callEvent) {
        return;
      }

      if (callEvent.status !== 'offer') {
        return;
      }

      const jid = callEvent.remoteJid || callEvent.from;
      const jidAlt = callEvent.remoteJidAlt || null;

      if (!jid) {
        console.warn('[WARN] Call event without jid, skipping');
        return;
      }

      const callKey = this.getCallKey(callEvent);
      if (!callKey) {
        console.warn('[WARN] Call event without key, skipping');
        return;
      }

      if (this.processedCalls.has(callKey)) {
        return;
      }

      this.processedCalls.set(callKey, Date.now());

      const phone = getPhoneFromJid(jid, jidAlt);
      if (!phone) {
        console.warn('[WARN] Call event without phone, skipping:', jid);
        this.processedCalls.delete(callKey);
        return;
      }

      const callUpsert: IUpsertMessage = {
        worker_id: baileysEnvironment.baileysWorkerId,
        account_id: baileysEnvironment.baileysAccountId,
        type: EMessageType.system,
        message: {} as WAMessage,
        photo: null,
        has_quoted: false,
        is_call_event: true,
        call_phone: phone,
        call_jid: jid,
        call_jid_alt: jidAlt,
        call_name: callEvent.pushName ?? null,
      };

      const pendingItem = this.enqueueMessage(callUpsert, callKey);
      if (!pendingItem) return;

      const jidToUse = jidAlt?.endsWith('@s.whatsapp.net') ? jidAlt : jid;
      this.fetchPhotoNonBlocking(socket, pendingItem, jidToUse);

      if (this.rejectCallConfig) {
        const callId =
          (callEvent as { id?: string })?.id ??
          (callEvent as { callId?: string })?.callId;
        if (callId && jid) {
          socket.rejectCall(callId, jid).catch(() => {});
        }
      }
    } catch (error) {
      console.error('[CRITICAL] Error processing call event:', error);
    }
  }

  private async handleMessagesUpdate(events: WAMessageUpdate[]) {
    if (!events?.length) return;

    const promises = events.map((event) => {
      const patch = this.mapStatusToPatch(event.update?.status);
      return this.applyStatusPatch(event.key, patch);
    });

    await Promise.allSettled(promises);
  }

  private async handleMessageReceiptUpdate(events: MessageUserReceiptUpdate[]) {
    if (!events?.length) return;

    const promises = events.map((event) => {
      const patch = this.mapReceiptToPatch(event.receipt);
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

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        statusUpdate,
        kafkaKey
      );
    } catch {}
  }

  unbind() {
    if (!this.currentSocket) return;
    try {
      this.currentSocket.ev.removeAllListeners('messages.upsert');
      this.currentSocket.ev.removeAllListeners('messages.update');
      this.currentSocket.ev.removeAllListeners('message-receipt.update');
      this.currentSocket.ev.removeAllListeners('presence.update');
      this.currentSocket.ev.removeAllListeners('messaging-history.set');
      this.currentSocket.ev.removeAllListeners('call');
    } catch {}
    this.currentSocket = undefined;
  }

  async destroy(): Promise<void> {
    this.isDestroying = true;
    this.unbind();
    this.stopCleanupInterval();

    if (this.pendingQueue.length > 0) {
      console.log(
        `[GRACEFUL] Waiting for ${this.pendingQueue.length} pending messages...`
      );

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

      if (this.pendingQueue.length > 0) {
        console.error(
          `[CRITICAL] Timeout reached, ${this.pendingQueue.length} messages lost`
        );
      } else {
        console.log('[GRACEFUL] All pending messages sent successfully');
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

  async reply(jid: string, quoted: WAMessage, content: AnyMessageContent) {
    if (!this.currentSocket) {
      throw new Error('Socket not connected');
    }

    return this.currentSocket.sendMessage(jid, content, { quoted });
  }

  updateRejectCallConfig(rejectCall: boolean): void {
    this.rejectCallConfig = rejectCall;
  }
}
