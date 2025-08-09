import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageTemporaryService {
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
   * Liga/desliga mensagens que somem após um período (24h, 7d, etc).
   */
  setDisappearingMessages(
    jid: string,
    seconds: number | boolean,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { disappearingMessagesInChat: seconds }, options);
  }
}
