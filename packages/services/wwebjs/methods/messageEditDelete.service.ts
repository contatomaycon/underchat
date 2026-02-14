import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMessageKeyInput } from '@core/common/interfaces/IMessageKeyInput';

@injectable()
export class WwebjsMessageEditDeleteService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async deleteMessage(
    key: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const serializedId = this.buildSerializedId(key);
    const msg = await client.getMessageById(serializedId);

    if (msg) {
      await msg.delete(true);
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

  async editText(
    jid: string,
    newText: string,
    editKey: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const serializedId = this.buildSerializedId(editKey);
    const msg = await client.getMessageById(serializedId);

    if (
      msg &&
      typeof (msg as { edit: (t: string) => Promise<unknown> }).edit ===
        'function'
    ) {
      await (msg as { edit: (t: string) => Promise<unknown> }).edit(newText);
      return messageToWaLike(msg);
    }

    const sent = await client.sendMessage(jid, newText);
    return messageToWaLike(sent ?? undefined);
  }
}
