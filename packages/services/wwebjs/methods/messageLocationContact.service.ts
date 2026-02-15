import { injectable, inject } from 'tsyringe';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import {
  resolveQuotedMessageId,
  type IWwebjsQuotedKeyInput,
} from '../util/resolveQuotedMessageId';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IWALocationMessage } from '@core/common/interfaces/IWALocationMessage';

const { Location } = whatsappWeb;

@injectable()
export class WwebjsMessageLocationContactService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async sendLocation(
    jid: string,
    location: IWALocationMessage,
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId = quoted?.key?.id
      ? ((await resolveQuotedMessageId(client, jid, quoted.key)) ??
        quoted.key.id)
      : undefined;

    const loc = new Location(
      location.degreesLatitude,
      location.degreesLongitude,
      {
        name: location.name,
        address: location.address,
      }
    );
    const options = {
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, loc, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendContactCard(
    jid: string,
    vcard: string,
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId = quoted?.key?.id
      ? ((await resolveQuotedMessageId(client, jid, quoted.key)) ??
        quoted.key.id)
      : undefined;

    const options = {
      parseVCards: true,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, vcard, options);

    return messageToWaLike(msg ?? undefined);
  }
}
