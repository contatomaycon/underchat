import { injectable, inject } from 'tsyringe';
import whatsappWeb from 'whatsapp-web.js';
import { withMediaUrlFromInput } from '@core/common/functions/getMediaUrlFromInput';
import { WwebjsHelpersService } from './helpers.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMediaInput } from '@core/common/interfaces/IMediaInput';

const { MessageMedia } = whatsappWeb;
type MessageMediaType = InstanceType<typeof MessageMedia>;

async function mediaFromInput(input: IMediaInput): Promise<MessageMediaType> {
  return withMediaUrlFromInput(input, (url) => MessageMedia.fromUrl(url));
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
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(image);
    const msg = await client.sendMessage(jid, media, {
      caption: args?.caption,
      quotedMessageId: quoted?.key?.id,
    });

    return messageToWaLike(msg ?? undefined);
  }

  async sendVideo(
    jid: string,
    video: IMediaInput,
    args?: { caption?: string; seconds?: number },
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(video);
    const msg = await client.sendMessage(jid, media, {
      caption: args?.caption,
      quotedMessageId: quoted?.key?.id,
    });

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
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(audio);
    const msg = await client.sendMessage(jid, media, {
      sendAudioAsVoice: args?.ptt ?? true,
      quotedMessageId: quoted?.key?.id,
    });

    return messageToWaLike(msg ?? undefined);
  }

  async sendSticker(
    jid: string,
    sticker: IMediaInput,
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(sticker);
    const msg = await client.sendMessage(jid, media, {
      sendMediaAsSticker: true,
      quotedMessageId: quoted?.key?.id,
    });

    return messageToWaLike(msg ?? undefined);
  }

  async sendDocument(
    jid: string,
    document: IMediaInput,
    args: { mimetype: string; fileName?: string; caption?: string },
    quoted?: { key: { id: string } }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromInput(document);
    const msg = await client.sendMessage(jid, media, {
      sendMediaAsDocument: true,
      caption: args.caption,
      quotedMessageId: quoted?.key?.id,
    });

    return messageToWaLike(msg ?? undefined);
  }
}
