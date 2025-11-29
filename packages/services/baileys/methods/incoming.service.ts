import { singleton } from 'tsyringe';
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
import { getSenderPhotoUrl } from '@core/common/functions/getSenderPhotoUrl';
import { remoteJid } from '@core/common/functions/remoteJid';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import { MessageSummaryPatch } from '@core/services/messageStatus.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { EMessageType } from '@core/common/enums/EMessageType';

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;
  private readonly processedMessages = new Set<string>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly centrifugoService: CentrifugoService
  ) {
    this.startCleanupInterval();
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
      if (this.processedMessages.size > 10000) {
        this.processedMessages.clear();
      }
    }, 300000);
  }

  private stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  bindTo(socket: WASocket) {
    if (this.currentSocket === socket) return;

    this.unbind();
    this.currentSocket = socket;

    socket.ev.on('messages.upsert', async (e) => {
      if (!e?.messages?.length) return;
      for (const m of e.messages) {
        const chatKind = getChatKind(m);
        const upsertType = e.type;

        console.dir(upsertType, { depth: null, colors: true });
        console.dir(chatKind, { depth: null, colors: true });

        if (
          chatKind === EChatKind.user &&
          upsertType === EMessageUpsertType.notify
        ) {
          const messageKey = this.getMessageKey(m);
          if (!messageKey) continue;

          if (this.processedMessages.has(messageKey)) {
            continue;
          }

          this.processedMessages.add(messageKey);

          const type = mapIncomingToType(m);
          const hasQuoted = messageHasQuoted(m);

          console.dir(m, { depth: null, colors: true });
          console.dir(type, { depth: null, colors: true });

          if (!type) {
            this.processedMessages.delete(messageKey);
            continue;
          }

          const senderPic = await getSenderPhotoUrl(socket, m);

          const inputUpsert: IUpsertMessage = {
            worker_id: baileysEnvironment.baileysWorkerId,
            account_id: baileysEnvironment.baileysAccountId,
            type,
            message: m,
            photo: senderPic,
            has_quoted: hasQuoted,
          };

          await this.streamProducerService.send(
            this.kafkaServiceQueueService.upsertMessage(),
            inputUpsert
          );
        }
      }
    });

    socket.ev.on('messages.update', (events) => {
      void this.handleMessagesUpdate(events);
    });

    socket.ev.on('message-receipt.update', (events) => {
      void this.handleMessageReceiptUpdate(events);
    });

    socket.ev.on('presence.update', async (data) => {
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

        try {
          await this.centrifugoService.publishSub(
            chatAccountCentrifugo(baileysEnvironment.baileysAccountId),
            typingEvent
          );
        } catch (error) {
          console.error('Error publishing typing event:', error);
        }
      }
    });

    socket.ev.on('messaging-history.set', (data) => {
      console.log('data:', data);
    });

    socket.ev.on('call', async (callEvents: WACallEvent[]) => {
      if (!callEvents) return;

      const eventsArray = Array.isArray(callEvents) ? callEvents : [callEvents];

      for (const callEvent of eventsArray) {
        await this.processCallEvent(socket, callEvent);
      }
    });
  }

  private async processCallEvent(
    socket: WASocket,
    callEvent: WACallEvent | null
  ): Promise<void> {
    if (!callEvent) {
      return;
    }

    if (callEvent.status !== 'offer') {
      return;
    }

    const jid = callEvent.remoteJid || callEvent.from;
    const jidAlt = callEvent.remoteJidAlt || null;

    if (!jid) {
      return;
    }

    const phone = getPhoneFromJid(jid, jidAlt);
    if (!phone) {
      return;
    }

    const jidToUse = jidAlt?.endsWith('@s.whatsapp.net') ? jidAlt : jid;
    let senderPic: string | undefined;
    try {
      senderPic = await socket.profilePictureUrl(jidToUse, 'image');
    } catch {
      senderPic = undefined;
    }

    const callUpsert: IUpsertMessage = {
      worker_id: baileysEnvironment.baileysWorkerId,
      account_id: baileysEnvironment.baileysAccountId,
      type: EMessageType.system,
      message: {} as WAMessage,
      photo: senderPic || null,
      has_quoted: false,
      is_call_event: true,
      call_phone: phone,
      call_jid: jid,
      call_jid_alt: jidAlt,
      call_name: callEvent.pushName || null,
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.upsertMessage(),
      callUpsert
    );
  }

  private async handleMessagesUpdate(events: WAMessageUpdate[]) {
    if (!events?.length) return;

    await Promise.all(
      events.map(async (event) => {
        const patch = this.mapStatusToPatch(event.update?.status);
        await this.applyStatusPatch(event.key, patch);
      })
    );
  }

  private async handleMessageReceiptUpdate(events: MessageUserReceiptUpdate[]) {
    if (!events?.length) return;

    await Promise.all(
      events.map(async (event) => {
        const patch = this.mapReceiptToPatch(event.receipt);
        await this.applyStatusPatch(event.key, patch);
      })
    );
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

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessageStatus(),
        statusUpdate
      );
    } catch (error) {
      console.error('Error sending message status update to queue', {
        messageId: key.id,
        error,
      });
    }
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

  destroy() {
    this.stopCleanupInterval();
    this.processedMessages.clear();
    this.unbind();
  }

  async markRead(keys: WAMessageKey[]) {
    if (!this.currentSocket) {
      throw new Error('Socket not connected');
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
}
