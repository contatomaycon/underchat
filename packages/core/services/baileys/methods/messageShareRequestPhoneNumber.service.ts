import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageShareRequestPhoneNumberService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Compartilha seu número de telefone com o destinatário.
   */
  sharePhoneNumber(jid: string, options?: MiscMessageGenerationOptions) {
    return this.baileysHelpersService.send(
      jid,
      { sharePhoneNumber: true } as AnyMessageContent,
      options
    );
  }

  /**
   * Solicita o número de telefone do destinatário.
   */
  requestPhoneNumber(jid: string, options?: MiscMessageGenerationOptions) {
    return this.baileysHelpersService.send(
      jid,
      { requestPhoneNumber: true } as AnyMessageContent,
      options
    );
  }
}
