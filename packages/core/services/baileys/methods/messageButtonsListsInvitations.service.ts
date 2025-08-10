import { injectable } from 'tsyringe';
import {
  ButtonReplyInfo,
  MiscMessageGenerationOptions,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageButtonsListsInvitationsService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Envia resposta de botão (template ou plain).
   */
  sendButtonReply(
    jid: string,
    info: ButtonReplyInfo,
    type: 'template' | 'plain',
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { buttonReply: info, type },
      options
    );
  }

  /**
   * Envia resposta de lista (listReply).
   */
  sendListReply(
    jid: string,
    list: Omit<proto.Message.IListResponseMessage, 'contextInfo'>,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(jid, { listReply: list }, options);
  }

  /**
   * Envia convite para entrar em um grupo com link e informações.
   */
  sendGroupInvite(
    jid: string,
    invite: {
      inviteCode: string;
      inviteExpiration: number;
      text: string;
      jid: string;
      subject: string;
    },
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { groupInvite: invite },
      options
    );
  }
}
