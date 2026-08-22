import { injectable, inject } from 'tsyringe';
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
    options?: {
      linkPreview?: IWAUrlInfo | null;
      mentions?: string[];
      extra?: Record<string, unknown>;
    },
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const sendOptions: {
      linkPreview?: boolean;
      mentions?: string[];
      extra?: Record<string, unknown>;
    } = {
      linkPreview: true,
      extra: options?.extra,
    };
    if (options?.mentions?.length) {
      sendOptions.mentions = options.mentions;
    }

    const msg = await this.helpers.sendMessage(
      jid,
      text,
      sendOptions,
      beforeProviderInvoke
    );
    return messageToWaLike(msg ?? undefined);
  }

  async sendTextQuoted(
    jid: string,
    text: string,
    quoted: { key: IWwebjsQuotedKeyInput },
    options?: { extra?: Record<string, unknown> },
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const quotedMessageId = await resolveQuotedMessageId(
      client,
      jid,
      quoted.key,
      (invoke) =>
        this.helpers.invokeProviderLookup(
          client,
          'quoted_message_lookup',
          invoke
        )
    );
    const sendOptions: {
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      extra: options?.extra,
    };
    if (quotedMessageId) {
      sendOptions.quotedMessageId = quotedMessageId;
      sendOptions.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(
      jid,
      text,
      sendOptions,
      beforeProviderInvoke
    );

    return messageToWaLike(msg ?? undefined);
  }
}
