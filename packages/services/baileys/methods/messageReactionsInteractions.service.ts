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
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const content = { react: { text: emoji, key } };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          options,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, options);
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
