import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WAMessage,
  WAUrlInfo,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';
import { buildLinkPreview } from '@core/common/functions/buildLinkPreview';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';

@injectable()
export class BaileysMessageTextService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Envia um texto simples. Pode incluir linkPreview (prévia de link) e mentions (menções a contatos no texto).
   */
  async sendText(
    jid: string,
    text: string,
    options?: MiscMessageGenerationOptions & {
      linkPreview?: WAUrlInfo | null;
      mentions?: string[];
    }
  ): Promise<proto.WebMessageInfo | undefined> {
    const firstUrl = extractFirstUrl(text);
    const linkPreview = firstUrl ? await buildLinkPreview(firstUrl) : null;

    const content: AnyMessageContent = {
      text,
      linkPreview,
      mentions: options?.mentions,
    };

    return this.baileysHelpersService.send(jid, content, options);
  }

  /**
   * Envia um texto citando (quoting) outra mensagem já recebida/enviada.
   */
  sendTextQuoted(
    jid: string,
    text: string,
    quoted: WAMessage,
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { text },
      { ...options, quoted }
    );
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
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
      jid,
      { forward: msg, force },
      options
    );
  }
}
