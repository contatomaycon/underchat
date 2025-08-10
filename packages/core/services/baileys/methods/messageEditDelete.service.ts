import { injectable } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageEditDeleteService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Exclui uma mensagem (para todos).
   */
  deleteMessage(
    jid: string,
    key: WAMessageKey,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(jid, { delete: key }, options);
  }

  /**
   * Edita o conteúdo de uma mensagem enviada.
   */
  editText(
    jid: string,
    newText: string,
    editKey: WAMessageKey,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { text: newText, edit: editKey },
      options
    );
  }
}
