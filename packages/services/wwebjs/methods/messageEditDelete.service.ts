import { injectable, inject } from 'tsyringe';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMessageKeyInput } from '@core/common/interfaces/IMessageKeyInput';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';

@injectable()
export class WwebjsMessageEditDeleteService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async deleteMessage(
    key: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const msg = await this.resolveMessageByKey(key);

    if (msg) {
      await msg.delete(true);
    }

    return undefined;
  }

  private buildSerializedIdCandidates(
    key: IMessageKeyInput,
    chatJid?: string
  ): string[] {
    const rawId = key.id?.trim();
    if (!rawId) {
      return [];
    }

    const parsed = parseSerializedMessageId(rawId);
    const stanzaId = parsed?.stanzaId ?? rawId;
    const fromMeCandidates =
      typeof key.fromMe === 'boolean'
        ? [key.fromMe]
        : typeof key.from_me === 'boolean'
          ? [key.from_me]
          : typeof parsed?.fromMe === 'boolean'
            ? [parsed.fromMe]
            : [false, true];

    const remoteCandidates = new Set<string>();
    const directRemote = (key.remoteJid ?? key.remote_jid ?? '').trim();
    if (directRemote) {
      remoteCandidates.add(directRemote);
    }
    if (chatJid?.trim()) {
      remoteCandidates.add(chatJid.trim());
    }
    if (parsed?.remoteJid?.trim()) {
      remoteCandidates.add(parsed.remoteJid.trim());
    }

    const candidates = new Set<string>();
    if (parsed) {
      candidates.add(rawId);
    }

    for (const remoteJid of remoteCandidates) {
      for (const fromMe of fromMeCandidates) {
        candidates.add(`${fromMe}_${remoteJid}_${stanzaId}`);
      }
    }

    candidates.add(rawId);
    return Array.from(candidates);
  }

  private async resolveMessageByKey(
    key: IMessageKeyInput,
    chatJid?: string
  ): Promise<any | null> {
    const client = this.helpers.getClient();
    const candidates = this.buildSerializedIdCandidates(key, chatJid);

    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      try {
        const message = await client.getMessageById(candidate);
        if (message) {
          return message;
        }
      } catch {}
    }

    return null;
  }

  async editText(
    newText: string,
    editKey: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const msg = await this.resolveMessageByKey(editKey);

    if (
      msg &&
      typeof (msg as { edit: (t: string) => Promise<unknown> }).edit ===
        'function'
    ) {
      await (msg as { edit: (t: string) => Promise<unknown> }).edit(newText);
      return messageToWaLike(msg);
    }

    return undefined;
  }

  async forwardMessage(
    destinationJid: string,
    sourceKey: IMessageKeyInput
  ): Promise<IMessageKeyResponse | undefined> {
    const msg = await this.resolveMessageByKey(sourceKey, destinationJid);

    if (
      !msg ||
      typeof (msg as { forward?: (chatId: string) => Promise<unknown> })
        .forward !== 'function'
    ) {
      return undefined;
    }

    const forwarded = (await (
      msg as { forward: (chatId: string) => Promise<unknown> }
    ).forward(destinationJid)) as
      | Parameters<typeof messageToWaLike>[0]
      | null
      | undefined;

    return messageToWaLike(forwarded);
  }
}
