import { injectable, inject } from 'tsyringe';
import { MessageMedia } from 'whatsapp-web.js';
import { withMediaUrlFromInput } from '@core/common/functions/getMediaUrlFromInput';
import { WwebjsHelpersService } from './helpers.service';
import { WwebjsMessageEditDeleteService } from './messageEditDelete.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMediaInput } from '@core/common/interfaces/IMediaInput';

async function mediaFromInput(input: IMediaInput): Promise<MessageMedia> {
  return withMediaUrlFromInput(input, (url) => MessageMedia.fromUrl(url));
}

@injectable()
export class WwebjsMessageStatusStoriesService {
  constructor(
    @inject(WwebjsHelpersService)
    private readonly helpers: WwebjsHelpersService,
    @inject(WwebjsMessageEditDeleteService)
    private readonly messageEditDeleteService: WwebjsMessageEditDeleteService
  ) {}

  async sendStatusText(
    jid: string,
    text: string
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const msg = await client.sendMessage(jid, text);
    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: { caption?: string }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const messageMedia = await mediaFromInput(media);
    const msg = await client.sendMessage(jid, messageMedia, {
      caption: args.caption,
    });
    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusVideo(
    jid: string,
    media: IMediaInput,
    args: { caption?: string }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const messageMedia = await mediaFromInput(media);
    const msg = await client.sendMessage(jid, messageMedia, {
      caption: args.caption,
    });
    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusAudio(
    jid: string,
    media: IMediaInput,
    args: { caption?: string }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const messageMedia = await mediaFromInput(media);
    const msg = await client.sendMessage(jid, messageMedia, {
      caption: args.caption,
      sendAudioAsVoice: true,
    });
    return messageToWaLike(msg ?? undefined);
  }

  async deleteStatus(externalId: string): Promise<void> {
    const jid = 'status@broadcast';
    const key = {
      remoteJid: jid,
      fromMe: true,
      id: externalId,
    };
    await this.messageEditDeleteService.deleteMessage(key);
  }
}
