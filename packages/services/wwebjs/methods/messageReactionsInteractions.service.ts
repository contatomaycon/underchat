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
      const pupPage = client.pupPage;
      if (!pupPage) {
        throw new Error('Wwebjs puppeteer page not available');
      }

      await pupPage.evaluate(
        async (messageId: string, reaction: string) => {
          if (!messageId) {
            return;
          }

          const browserGlobal = globalThis as unknown as {
            require: (module: string) => unknown;
          };
          const collections = browserGlobal.require('WAWebCollections') as {
            Msg: {
              get: (id: string) => unknown;
              getMessagesById: (
                ids: string[]
              ) => Promise<{ messages?: unknown[] } | undefined>;
            };
          };
          const message =
            collections.Msg.get(messageId) ||
            (await collections.Msg.getMessagesById([messageId]))?.messages?.[0];
          if (!message) {
            return;
          }

          const reactionAction = browserGlobal.require(
            'WAWebSendReactionMsgAction'
          ) as {
            sendReactionToMsg: (
              message: unknown,
              reactionText: string
            ) => Promise<unknown>;
          };
          await reactionAction.sendReactionToMsg(message, reaction);
        },
        serializedId,
        emoji
      );
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
