import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WAUrlInfo,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageTextService {
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
   * Envia um texto simples. Pode incluir linkPreview (prévia de link) e mentions (menções a contatos no texto).
   */
  sendText(
    jid: string,
    text: string,
    options?: MiscMessageGenerationOptions & {
      linkPreview?: WAUrlInfo | null;
      mentions?: string[];
    }
  ) {
    const content: AnyMessageContent = {
      text,
      linkPreview: options?.linkPreview ?? undefined,
      mentions: options?.mentions,
    };

    return this.send(jid, content, options);
  }

  /**
   * Envia um texto citando (quoting) outra mensagem já recebida/enviada.
   */
  sendTextQuoted(
    jid: string,
    text: string,
    quoted: WAMessage,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { text }, { ...options, quoted });
  }

  /**
   * 	Envia texto mencionando usuários específicos (@usuario).
   */
  sendMention(
    jid: string,
    text: string,
    mentions: string[],
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { text, mentions }, options);
  }

  /**
   * 	Reenvia (forward) uma mensagem recebida para outro chat.
   */
  forward(
    jid: string,
    msg: WAMessage,
    force = false,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { forward: msg, force }, options);
  }
}
