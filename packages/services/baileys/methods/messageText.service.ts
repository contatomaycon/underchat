import { injectable, inject } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WAMessage,
  WAUrlInfo,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageTextService {
  constructor(
    @inject(BaileysHelpersService)
    private readonly baileysHelpersService: BaileysHelpersService
  ) {}

  /**
   * Envia um texto simples. Pode incluir linkPreview (prévia de link) e mentions (menções a contatos no texto).
   */
  async sendText(
    jid: string,
    text: string,
    options?: MiscMessageGenerationOptions & {
      linkPreview?: WAUrlInfo | null;
      mentions?: string[];
      contextInfo?: proto.IContextInfo;
    },
    beforeProviderInvoke?: () => Promise<void>
  ): Promise<WAMessage | undefined> {
    const content: AnyMessageContent = {
      text,
      linkPreview: options?.linkPreview ?? undefined,
      mentions: options?.mentions,
      contextInfo: options?.contextInfo,
    };

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
   * Envia um texto citando (quoting) outra mensagem já recebida/enviada.
   */
  sendTextQuoted(
    jid: string,
    text: string,
    quoted: WAMessage,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    const sendOptions = { ...options, quoted };
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          { text },
          sendOptions,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, { text }, sendOptions);
  }

  /**
   * 	Envia texto mencionando usuários específicos (@usuario).
   */
  sendMention(
    jid: string,
    text: string,
    mentions: string[],
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(jid, { text, mentions }, options);
  }

  /**
   * 	Reenvia (forward) uma mensagem recebida para outro chat.
   */
  forward(
    jid: string,
    msg: WAMessage,
    force = false,
    options?: MiscMessageGenerationOptions,
    beforeProviderInvoke?: () => Promise<void>
  ) {
    return beforeProviderInvoke
      ? this.baileysHelpersService.send(
          jid,
          { forward: msg, force },
          options,
          beforeProviderInvoke
        )
      : this.baileysHelpersService.send(jid, { forward: msg, force }, options);
  }
}
