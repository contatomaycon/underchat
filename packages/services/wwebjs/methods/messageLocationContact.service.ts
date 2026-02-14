import { injectable, inject } from 'tsyringe';
import { Location } from 'whatsapp-web.js';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IWALocationMessage } from '@core/common/interfaces/IWALocationMessage';

@injectable()
export class WwebjsMessageLocationContactService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async sendLocation(
    jid: string,
    location: IWALocationMessage,
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const loc = new Location(
      location.degreesLatitude,
      location.degreesLongitude,
      {
        name: location.name,
        address: location.address,
      }
    );
    const msg = await client.sendMessage(jid, loc, {
      quotedMessageId: quoted?.key?.id,
    });
    return messageToWaLike(msg ?? undefined);
  }

  async sendContactCard(
    jid: string,
    vcard: string,
    displayName?: string,
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const msg = await client.sendMessage(jid, vcard, {
      parseVCards: true,
      quotedMessageId: quoted?.key?.id,
    });
    return messageToWaLike(msg ?? undefined);
  }
}
