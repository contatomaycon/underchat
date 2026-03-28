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
    console.log('[BAILEYS_EDIT_DEBUG] baileys_edit_service_call', {
      jid,
      new_text_length: newText.length,
      new_text_preview: newText.slice(0, 120),
      edit_key: {
        id: editKey?.id ?? null,
        fromMe: editKey?.fromMe ?? null,
        remoteJid: editKey?.remoteJid ?? null,
        remoteJidAlt: (editKey as any)?.remoteJidAlt ?? null,
        participant: editKey?.participant ?? null,
        participantAlt: (editKey as any)?.participantAlt ?? null,
        addressingMode: (editKey as any)?.addressingMode ?? null,
      },
      has_options: !!options,
    });

    return this.baileysHelpersService.send(
      jid,
      { text: newText, edit: editKey },
      options
    );
  }
}
