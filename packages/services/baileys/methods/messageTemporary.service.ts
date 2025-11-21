import { injectable } from 'tsyringe';
import { MiscMessageGenerationOptions } from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageTemporaryService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Liga/desliga mensagens que somem após um período (24h, 7d, etc).
   */
  setDisappearingMessages(
    jid: string,
    seconds: number | boolean,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { disappearingMessagesInChat: seconds },
      options
    );
  }
}
