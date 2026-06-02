import { injectable, inject } from 'tsyringe';
import whatsappWeb from '@wwebjs/whatsapp-web.js';
import { withMediaUrlFromInput } from '@core/common/functions/getMediaUrlFromInput';
import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';
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

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }

  return 'application/octet-stream';
}

function normalizeFilesize(value?: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function ignoreGenericMimetype(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') {
    return null;
  }

  return value ?? null;
}

function normalizeFilename(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) return fallback;

  return normalized.replaceAll(/[\\/\0]/g, '_');
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split('/').pop();
    if (!rawName) return undefined;

    return decodeURIComponent(rawName);
  } catch {
    return undefined;
  }
}

async function mediaFromDownloadedInput(
  input: IMediaInput,
  options: {
    mimetype?: string | null;
    filename?: string | null;
    filesize?: number | null;
    fallbackMimetype: string;
    fallbackFilename: string;
  }
): Promise<MessageMediaType> {
  return withMediaUrlFromInput(input, async (url, metadata) => {
    const downloaded = await downloadMediaBuffer(url);
    const mimetype = firstNonEmpty(
      options.mimetype,
      metadata.mimetype,
      ignoreGenericMimetype(downloaded.contentType),
      options.fallbackMimetype
    );
    const filename = normalizeFilename(
      firstNonEmpty(
        options.filename,
        metadata.filename,
        downloaded.filename,
        filenameFromUrl(url),
        options.fallbackFilename
      ),
      options.fallbackFilename
    );
    const filesize =
      normalizeFilesize(options.filesize) ??
      normalizeFilesize(metadata.filesize) ??
      normalizeFilesize(downloaded.contentLength) ??
      downloaded.buffer.byteLength;

    console.info('[WwebjsMediaDebug]', {
      event: 'media_downloaded_for_message_media',
      filename,
      mimetype,
      filesize,
      downloaded_size: downloaded.buffer.byteLength,
      content_type_header: downloaded.contentType ?? null,
      content_length_header: downloaded.contentLength ?? null,
    });

    return new MessageMedia(
      mimetype,
      downloaded.buffer.toString('base64'),
      filename,
      filesize
    );
  });
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
      mimetype?: string;
      fileName?: string;
      filesize?: number;
      extra?: Record<string, unknown>;
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const media = await mediaFromDownloadedInput(video, {
      mimetype: args?.mimetype,
      filename: args?.fileName,
      filesize: args?.filesize,
      fallbackMimetype: 'video/mp4',
      fallbackFilename: 'video.mp4',
    });
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
      fileName?: string;
      filesize?: number;
      viewOnce?: boolean;
      waveform?: Uint8Array;
      extra?: Record<string, unknown>;
    },
    quoted?: { key: IWwebjsQuotedKeyInput }
  ): Promise<IMessageKeyResponse | undefined> {
    const client = this.helpers.getClient();
    const isPtt = args?.ptt ?? true;
    const media = await mediaFromDownloadedInput(audio, {
      mimetype:
        args?.mimetype ?? (isPtt ? 'audio/ogg; codecs=opus' : 'audio/mpeg'),
      filename: args?.fileName,
      filesize: args?.filesize,
      fallbackMimetype: isPtt ? 'audio/ogg; codecs=opus' : 'audio/mpeg',
      fallbackFilename: isPtt ? 'audio.ogg' : 'audio.mp3',
    });
    const quotedMessageId = await getQuotedMessageId(client, jid, quoted);
    const options: {
      sendAudioAsVoice: boolean;
      isViewOnce?: boolean;
      quotedMessageId?: string;
      ignoreQuoteErrors?: false;
      extra?: Record<string, unknown>;
    } = {
      sendAudioAsVoice: isPtt,
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
    const media = await mediaFromDownloadedInput(document, {
      mimetype: args.mimetype,
      filename: args.fileName,
      fallbackMimetype: args.mimetype,
      fallbackFilename: args.fileName ?? 'document',
    });
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
