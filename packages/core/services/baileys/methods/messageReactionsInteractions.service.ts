import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  PollMessageOptions,
  proto,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageReactionsInteractionsService {
  constructor(private readonly connection: BaileysConnectionService) {}

  private socket() {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }

    return s;
  }

  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<proto.WebMessageInfo | undefined> {
    return this.socket().sendMessage(jid, content, options);
  }

  /**
   * Reage a uma mensagem com um emoji (💖, 👍, etc).
   */
  react(
    jid: string,
    key: WAMessageKey,
    emoji: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { react: { text: emoji, key } }, options);
  }

  /**
   * Fixa (ou remove) uma mensagem do chat por um tempo definido.
   */
  pinMessage(
    jid: string,
    key: WAMessageKey,
    type: proto.PinInChat.Type,
    time?: 86400 | 604800 | 2592000,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { pin: key, type, time }, options);
  }

  /**
   * Envia uma enquete com opções para os participantes escolherem.
   */
  sendPoll(
    jid: string,
    poll: Omit<PollMessageOptions, 'messageSecret'> & {
      messageSecret?: Uint8Array;
    },
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { poll }, options);
  }
}
