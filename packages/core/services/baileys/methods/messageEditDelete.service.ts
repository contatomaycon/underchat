import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessageKey,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageEditDeleteService {
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
   * Exclui uma mensagem (para todos).
   */
  deleteMessage(
    jid: string,
    key: WAMessageKey,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { delete: key }, options);
  }

  /**
   * Edita o conteúdo de uma mensagem enviada.
   */
  editText(
    jid: string,
    newText: string,
    editKey: WAMessageKey,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { text: newText, edit: editKey }, options);
  }
}
