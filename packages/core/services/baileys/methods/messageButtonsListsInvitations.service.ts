import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  ButtonReplyInfo,
  MiscMessageGenerationOptions,
  proto,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageButtonsListsInvitationsService {
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
   * Envia resposta de botão (template ou plain).
   */
  sendButtonReply(
    jid: string,
    info: ButtonReplyInfo,
    type: 'template' | 'plain',
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { buttonReply: info, type }, options);
  }

  /**
   * Envia resposta de lista (listReply).
   */
  sendListReply(
    jid: string,
    list: Omit<proto.Message.IListResponseMessage, 'contextInfo'>,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { listReply: list }, options);
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
    return this.send(jid, { groupInvite: invite }, options);
  }
}
