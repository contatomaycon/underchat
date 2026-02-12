import { injectable, inject } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  PollMessageOptions,
  proto,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageReactionsInteractionsService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

  /**
   * Reage a uma mensagem com um emoji (💖, 👍, etc).
   */
  react(
    jid: string,
    key: WAMessageKey,
    emoji: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { react: { text: emoji, key } },
      options
    );
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
    return this.baileysHelpersService.send(
      jid,
      { pin: key, type, time },
      options
    );
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
    return this.baileysHelpersService.send(jid, { poll }, options);
  }
}
