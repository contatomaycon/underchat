import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WALocationMessage,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageLocationContactService {
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
   * Envia coordenadas GPS (latitude/longitude) no formato locationMessage.
   */
  sendLocation(
    jid: string,
    location: WALocationMessage,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { location }, options);
  }

  /**
   * Envia um cartão de contato único (vCard) com nome, telefone e outros dados.
   */
  sendContactCard(
    jid: string,
    vcard: string,
    displayName?: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(
      jid,
      { contacts: { displayName, contacts: [{ vcard }] } },
      options
    );
  }

  /**
   * Envia vários contatos no mesmo envio (lista de vCards).
   */
  sendContacts(
    jid: string,
    vcards: string[],
    displayName?: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(
      jid,
      {
        contacts: { displayName, contacts: vcards.map((vcard) => ({ vcard })) },
      },
      options
    );
  }
}
