import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMessageKeyInput } from '@core/common/interfaces/IMessageKeyInput';

@injectable()
export class WwebjsMessageReactionsInteractionsService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async react(
    key: IMessageKeyInput,
    emoji: string
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const serializedId = this.buildSerializedId(key);
    const msg = await client.getMessageById(serializedId);

    if (msg) {
      await msg.react(emoji);
      return messageToWaLike(msg);
    }

    return undefined;
  }

  private buildSerializedId(key: IMessageKeyInput): string {
    const id = key.id;
    const remoteJid = key.remoteJid ?? key.remote_jid ?? '';
    const fromMe = key.fromMe ?? key.from_me ?? false;

    if (id.includes('_') && id.length > 20) {
      return id;
    }

    return `${fromMe}_${remoteJid}_${id}`;
  }
}
