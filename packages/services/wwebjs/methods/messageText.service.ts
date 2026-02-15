import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import {
  resolveQuotedMessageId,
  type IWwebjsQuotedKeyInput,
} from '../util/resolveQuotedMessageId';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IWAUrlInfo } from '@core/common/interfaces/IWAUrlInfo';

@injectable()
export class WwebjsMessageTextService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async sendText(
    jid: string,
    text: string,
    options?: { linkPreview?: IWAUrlInfo | null; mentions?: string[] }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();

    const sendOptions: { linkPreview?: boolean; mentions?: string[] } = {
      linkPreview: true,
    };
    if (options?.mentions?.length) {
      sendOptions.mentions = options.mentions;
    }

    const msg = await client.sendMessage(jid, text, sendOptions);
    return messageToWaLike(msg ?? undefined);
  }

  async sendTextQuoted(
    jid: string,
    text: string,
    quoted: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId =
      (await resolveQuotedMessageId(client, jid, quoted.key)) ?? quoted.key.id;

    const msg = await client.sendMessage(jid, text, {
      quotedMessageId,
      ignoreQuoteErrors: false,
    });
    return messageToWaLike(msg ?? undefined);
  }
}
