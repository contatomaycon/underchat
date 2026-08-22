import { injectable, inject } from 'tsyringe';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import {
  WwebjsHelpersService,
  type WwebjsProviderInvocationBoundary,
} from './helpers.service';
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
    quoted?: { key: IWwebjsQuotedKeyInput },
    extra?: Record<string, unknown>,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId = quoted?.key?.id
      ? await resolveQuotedMessageId(client, jid, quoted.key, (invoke) =>
          this.helpers.invokeProviderLookup(
            client,
            'quoted_message_lookup',
            invoke
          )
        )
      : undefined;

    const loc = new Location(
      location.degreesLatitude,
      location.degreesLongitude,
      {
        name: location.name,
        address: location.address,
      }
    );
    const options: {
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(
      jid,
      loc,
      options,
      beforeProviderInvoke
    );

    return messageToWaLike(msg ?? undefined);
  }

  async sendContactCard(
    jid: string,
    vcard: string,
    quoted?: { key: IWwebjsQuotedKeyInput },
    extra?: Record<string, unknown>,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId = quoted?.key?.id
      ? await resolveQuotedMessageId(client, jid, quoted.key, (invoke) =>
          this.helpers.invokeProviderLookup(
            client,
            'quoted_message_lookup',
            invoke
          )
        )
      : undefined;

    const options: {
      parseVCards: true;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      parseVCards: true,
      extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(
      jid,
      vcard,
      options,
      beforeProviderInvoke
    );

    return messageToWaLike(msg ?? undefined);
  }
}
