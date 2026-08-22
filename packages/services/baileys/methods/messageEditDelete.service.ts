import { injectable, inject } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  WAMessageKey,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageEditDeleteService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

  /**
   * Exclui uma mensagem (para todos).
   */
  deleteMessage(
    jid: string,
    key: WAMessageKey,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          { delete: key },
          options,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, { delete: key }, options);
  }

  /**
   * Edita o conteúdo de uma mensagem enviada.
   */
  editText(
    jid: string,
    newText: string,
    editKey: WAMessageKey,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const content = { text: newText, edit: editKey };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          content,
          options,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, content, options);
  }
}
