import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageShareRequestPhoneNumberService {
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
   * Compartilha seu número de telefone com o destinatário.
   */
  sharePhoneNumber(jid: string, options?: MiscMessageGenerationOptions) {
    return this.send(
      jid,
      { sharePhoneNumber: true } as AnyMessageContent,
      options
    );
  }

  /**
   * Solicita o número de telefone do destinatário.
   */
  requestPhoneNumber(jid: string, options?: MiscMessageGenerationOptions) {
    return this.send(
      jid,
      { requestPhoneNumber: true } as AnyMessageContent,
      options
    );
  }
}
