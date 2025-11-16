import { singleton } from 'tsyringe';
import {
  AnyMessageContent,
  WAMessage,
  WAMessageKey,
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
      console.log('events:', events);
    });

    socket.ev.on('message-receipt.update', (events) => {
      console.log('events:', events);
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
  }

  unbind() {
    if (!this.currentSocket) return;
    try {
      this.currentSocket.ev.removeAllListeners('messages.upsert');
      this.currentSocket.ev.removeAllListeners('messages.update');
      this.currentSocket.ev.removeAllListeners('message-receipt.update');
      this.currentSocket.ev.removeAllListeners('presence.update');
      this.currentSocket.ev.removeAllListeners('messaging-history.set');
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
