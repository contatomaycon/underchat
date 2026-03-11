import { injectable, inject } from 'tsyringe';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import { withMediaUrlFromInput } from '@core/common/functions/getMediaUrlFromInput';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import {
  resolveQuotedMessageId,
  type IWwebjsQuotedKeyInput,
} from '../util/resolveQuotedMessageId';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMediaInput } from '@core/common/interfaces/IMediaInput';

const { MessageMedia } = whatsappWeb;
type MessageMediaType = InstanceType<typeof MessageMedia>;

async function mediaFromInput(input: IMediaInput): Promise<MessageMediaType> {
  return withMediaUrlFromInput(input, (url) => MessageMedia.fromUrl(url));
}

async function getQuotedMessageId(
  client: ReturnType<WwebjsHelpersService['getClient']>,
  jid: string,
  quoted?: { key: IWwebjsQuotedKeyInput }
): Promise<string | undefined> {
  if (!quoted?.key?.id) {
    return undefined;
  }

  return resolveQuotedMessageId(client, jid, quoted.key);
}

@injectable()
export class WwebjsMessageMediaService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService
  ) {}

  async sendImage(
    jid: string,
    image: IMediaInput,
    args?: { caption?: string; extra?: Record<string, unknown> },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(image);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      caption?: string;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      caption: args?.caption,
      extra: args?.extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendVideo(
    jid: string,
    video: IMediaInput,
    args?: {
      caption?: string;
      seconds?: number;
      extra?: Record<string, unknown>;
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(video);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      caption?: string;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      caption: args?.caption,
      extra: args?.extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendAudio(
    jid: string,
    audio: IMediaInput,
    args?: {
      ptt?: boolean;
      seconds?: number;
      mimetype?: string;
      viewOnce?: boolean;
      waveform?: Uint8Array;
      extra?: Record<string, unknown>;
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(audio);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      sendAudioAsVoice: boolean;
      isViewOnce?: boolean;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      sendAudioAsVoice: args?.ptt ?? true,
      isViewOnce: args?.viewOnce,
      extra: args?.extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }

    const msg = await this.helpers.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendSticker(
    jid: string,
    sticker: IMediaInput,
    quoted?: { key: IWwebjsQuotedKeyInput },
    extra?: Record<string, unknown>
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(sticker);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      sendMediaAsSticker: true;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      sendMediaAsSticker: true,
      extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(jid, media, options);
    return messageToWaLike(msg ?? undefined);
  }

  async sendDocument(
    jid: string,
    document: IMediaInput,
    args: {
      mimetype: string;
      fileName?: string;
      caption?: string;
      extra?: Record<string, unknown>;
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(document);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      sendMediaAsDocument: true;
      caption?: string;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      sendMediaAsDocument: true,
      caption: args.caption,
      extra: args.extra,
    };
    if (quotedMessageId) {
      options.quotedMessageId = quotedMessageId;
      options.ignoreQuoteErrors = false;
    }
    const msg = await this.helpers.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }
}
