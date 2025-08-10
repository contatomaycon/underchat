import { singleton, inject } from 'tsyringe';
import {
  AnyMessageContent,
  MessageUpsertType,
  WAMessage,
  WAMessageKey,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { mapIncomingToType } from '@core/common/functions/mapIncomingToType';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { baileysEnvironment } from '@core/config/environments';

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

  constructor(
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  bindTo(socket: WASocket) {
    if (this.currentSocket === socket) return;

    this.unbind();
    this.currentSocket = socket;

    /**
     * Mensagem nova recebida ou enviada (via messages.upsert).
     */
    socket.ev.on('messages.upsert', async (e) => {
      if (!e?.messages?.length) return;
      for (const m of e.messages) {
        const type = mapIncomingToType(m);

        if (!type) {
          throw new Error('Unknown message type');
        }

        const inputUpsert: IUpsertMessage = {
          worker_id: baileysEnvironment.baileysWorkerId,
          account_id: baileysEnvironment.baileysAccountId,
          type,
          message: m,
        };

        await this.streamProducerService.send(
          this.kafkaServiceQueueService.upsertMessage(),
          inputUpsert
        );
      }
    });

    /**
     * Alterações em mensagens existentes (reação, edição, status, etc.).
     */
    socket.ev.on('messages.update', (events) => {
      for (const { key, update } of events) {
        /*   console.log('messages.update');
        console.log('Message key:', key);
        console.log('Message update:', update); */
      }
    });

    /**
     * Mudança no status de entrega/leitura.
     */
    socket.ev.on('message-receipt.update', (events) => {
      for (const { key, receipt } of events) {
        /*  console.log('message-receipt.update');
        console.log('Message key:', key);
        console.log('Message receipt:', receipt); */
      }
    });

    /**
     * Alguém no chat mudou de status (online, digitando, etc.).
     */
    socket.ev.on('presence.update', (data) => {
      /*   console.log('presence.update');
      console.log('Presence data:', data); */
    });

    /**
     * Histórico carregado pelo WhatsApp (ao conectar ou sincronizar).
     */
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
