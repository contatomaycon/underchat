import { singleton } from 'tsyringe';
import {
  AnyMessageContent,
  MessageUpsertType,
  WAMessage,
  WAMessageKey,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';

export type IncomingEvent =
  | {
      type: 'message';
      data: { upsertType: MessageUpsertType; message: WAMessage };
    }
  | {
      type: 'message.update';
      data: { key: WAMessageKey; update: Partial<WAMessage> };
    }
  | {
      type: 'message.receipt';
      data: { key: WAMessageKey; receipt: proto.IUserReceipt };
    }
  | { type: 'presence.update'; data: any }
  | { type: 'messages.history'; data: any };

@singleton()
export class BaileysIncomingMessageService {
  private currentSocket?: WASocket;

  bindTo(socket: WASocket) {
    if (this.currentSocket === socket) return;

    this.unbind();
    this.currentSocket = socket;

    socket.ev.on('messages.upsert', (e) => {
      if (!e?.messages?.length) return;
      for (const m of e.messages) {
        /*   console.log('messages.upsert');
        console.log('New message received:', m);
        console.log('Message event:', e); */
      }
    });

    socket.ev.on('messages.update', (events) => {
      for (const { key, update } of events) {
        /*   console.log('messages.update');
        console.log('Message key:', key);
        console.log('Message update:', update); */
      }
    });

    socket.ev.on('message-receipt.update', (events) => {
      for (const { key, receipt } of events) {
        /*  console.log('message-receipt.update');
        console.log('Message key:', key);
        console.log('Message receipt:', receipt); */
      }
    });

    socket.ev.on('presence.update', (data) => {
      /*   console.log('presence.update');
      console.log('Presence data:', data); */
    });

    socket.ev.on('messaging-history.set', (data) => {
      /*   console.log('messaging-history.set');
      console.log('Messaging history data:', data); */
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

  onIncoming(handler: (event: IncomingEvent) => void) {
    /*     console.log('Incoming event handler registered');
    console.log('handler:', handler); */
  }

  offIncoming(handler: (event: IncomingEvent) => void) {
    /*     console.log('Incoming event handler unregistered');
    console.log('handler:', handler); */
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
