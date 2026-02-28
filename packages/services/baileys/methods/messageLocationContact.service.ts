import { injectable, inject } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  proto,
  WALocationMessage,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageLocationContactService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

  /**
   * Envia coordenadas GPS (latitude/longitude) no formato locationMessage.
   */
  sendLocation(
    jid: string,
    location: WALocationMessage & { contextInfo?: proto.IContextInfo },
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(jid, { location }, options);
  }

  /**
   * Envia um cartão de contato único (vCard) com nome, telefone e outros dados.
   */
  sendContactCard(
    jid: string,
    vcard: string,
    displayName?: string,
    contextInfo?: proto.IContextInfo,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { contacts: { displayName, contacts: [{ vcard }] }, contextInfo },
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
    contextInfo?: proto.IContextInfo,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      {
        contacts: { displayName, contacts: vcards.map((vcard) => ({ vcard })) },
        contextInfo,
      },
      options
    );
  }
}
