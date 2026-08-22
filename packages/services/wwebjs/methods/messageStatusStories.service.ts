import { injectable, inject } from 'tsyringe';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import { withMediaUrlFromInput } from '@core/common/functions/getMediaUrlFromInput';
import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';
import {
  WwebjsHelpersService,
  type WwebjsProviderInvocationBoundary,
} from './helpers.service';
import { WwebjsMessageEditDeleteService } from './messageEditDelete.service';
import { messageToWaLike } from '../util/messageToWaLike';
import type { IMessageKeyResponse } from '@core/common/interfaces/IMessageKeyResponse';
import type { IMediaInput } from '@core/common/interfaces/IMediaInput';

const { MessageMedia } = whatsappWeb;
type MessageMediaType = InstanceType<typeof MessageMedia>;

async function mediaFromInput(input: IMediaInput): Promise<MessageMediaType> {
  return withMediaUrlFromInput(input, async (url, metadata) => {
    const downloaded = await downloadMediaBuffer(url);
    return new MessageMedia(
      metadata.mimetype?.trim() ||
        downloaded.contentType?.trim() ||
        'application/octet-stream',
      downloaded.buffer.toString('base64'),
      metadata.filename?.trim() ||
        downloaded.filename?.trim() ||
        'status-media',
      metadata.filesize ??
        downloaded.contentLength ??
        downloaded.buffer.byteLength
    );
  });
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
    text: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const msg = await this.helpers.sendMessage(
      jid,
      text,
      undefined,
      beforeProviderInvoke
    );

    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusImage(
    jid: string,
    media: IMediaInput,
    args: { caption?: string },
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const messageMedia = await mediaFromInput(media);
    const options = { caption: args.caption };
    const msg = await this.helpers.sendMessage(
      jid,
      messageMedia,
      options,
      beforeProviderInvoke
    );
    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusVideo(
    jid: string,
    media: IMediaInput,
    args: { caption?: string },
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const messageMedia = await mediaFromInput(media);
    const options = { caption: args.caption };
    const msg = await this.helpers.sendMessage(
      jid,
      messageMedia,
      options,
      beforeProviderInvoke
    );
    return messageToWaLike(msg ?? undefined);
  }

  async sendStatusAudio(
    jid: string,
    media: IMediaInput,
    args: { caption?: string },
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<IMessageKeyResponse | undefined> {
    const messageMedia = await mediaFromInput(media);
    const options = { caption: args.caption, sendAudioAsVoice: true };
    const msg = await this.helpers.sendMessage(
      jid,
      messageMedia,
      options,
      beforeProviderInvoke
    );
    return messageToWaLike(msg ?? undefined);
  }

  async deleteStatus(
    externalId: string,
    beforeProviderInvoke?: WwebjsProviderInvocationBoundary
  ): Promise<void> {
    const jid = 'status@broadcast';
    const key = {
      remoteJid: jid,
      fromMe: true,
      id: externalId,
    };
    await this.messageEditDeleteService.deleteMessage(
      key,
      beforeProviderInvoke
    );
  }
}
