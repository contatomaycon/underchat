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

  return (
    (await resolveQuotedMessageId(client, jid, quoted.key)) ?? quoted.key.id
  );
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
    args?: { caption?: string },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(image);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options = {
      caption: args?.caption,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendVideo(
    jid: string,
    video: IMediaInput,
    args?: { caption?: string; seconds?: number },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(video);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options = {
      caption: args?.caption,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, media, options);

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
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(audio);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options = {
      sendAudioAsVoice: args?.ptt ?? true,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };

    const msg = await client.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }

  async sendSticker(
    jid: string,
    sticker: IMediaInput,
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(sticker);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options = {
      sendMediaAsSticker: true,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, media, options);
    return messageToWaLike(msg ?? undefined);
  }

  async sendDocument(
    jid: string,
    document: IMediaInput,
    args: { mimetype: string; fileName?: string; caption?: string },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(document);
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options = {
      sendMediaAsDocument: true,
      caption: args.caption,
      quotedMessageId,
      ignoreQuoteErrors: quotedMessageId ? false : undefined,
    };
    const msg = await client.sendMessage(jid, media, options);

    return messageToWaLike(msg ?? undefined);
  }
}
