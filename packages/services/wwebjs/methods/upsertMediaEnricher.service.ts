import { injectable, inject } from 'tsyringe';
import { Buffer } from 'node:buffer';
import type { Message } from '@wwebjs/whatsapp-web.js';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { IContent } from '@core/common/interfaces/IChatMessage';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { StorageService } from '@core/services/storage.service';

const MEDIA_DOWNLOAD_TIMEOUT_MS = 15000;
const LOTTIE_STICKER_EXT = 'was';
const LOTTIE_STICKER_MIME = 'application/was';
const LOTTIE_ZIP_ENTRY_MARKER = Buffer.from('animation/animation.json');

interface WwebjsStickerRawData {
  mimetype?: unknown;
  isAnimated?: unknown;
  isLottie?: unknown;
  width?: unknown;
  height?: unknown;
}

interface WwebjsStickerMeta {
  mimetype?: string;
  isAnimated: boolean;
  isLottie: boolean;
  width: number | null;
  height: number | null;
}

@injectable()
export class WwebjsUpsertMediaEnricher {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService
  ) {}

  async enrich(upsert: IUpsertMessage, msg: Message): Promise<void> {
    if (!msg.hasMedia) return;

    const type = upsert.type;
    const content: Partial<IContent> = { type };

    const downloadPromise = msg.downloadMedia();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Download timeout')),
        MEDIA_DOWNLOAD_TIMEOUT_MS
      )
    );

    let media:
      | { data: string; mimetype?: string; filename?: string | null }
      | undefined;
    try {
      media = (await Promise.race([
        downloadPromise,
        timeoutPromise,
      ])) as typeof media;
    } catch {
      content.media_download_failed = true;
      upsert.content = { ...upsert.content, ...content } as IContent;
      return;
    }

    if (!media?.data) {
      content.media_download_failed = true;
      upsert.content = { ...upsert.content, ...content } as IContent;
      return;
    }

    const buffer = Buffer.from(media.data, 'base64');

    const mediaOpts = {
      mimetype: media.mimetype,
      filename: media.filename ?? undefined,
    };
    if (type === EMessageType.image) {
      await this.enrichImage(
        content,
        buffer,
        upsert.account_id,
        msg,
        mediaOpts
      );
    }
    if (type === EMessageType.video || type === EMessageType.video_note) {
      await this.enrichVideo(content, buffer, upsert.account_id, mediaOpts);
    }
    if (type === EMessageType.audio) {
      await this.enrichAudio(content, buffer, upsert.account_id, mediaOpts);
    }
    if (type === EMessageType.document) {
      await this.enrichDocument(content, buffer, upsert.account_id, mediaOpts);
    }
    if (type === EMessageType.sticker) {
      await this.enrichSticker(
        content,
        buffer,
        upsert.account_id,
        mediaOpts,
        msg
      );
    }

    const hasMedia =
      content.image ||
      content.video ||
      content.audio ||
      content.document ||
      content.sticker;
    if (hasMedia) {
      upsert.content = { ...upsert.content, ...content } as IContent;
    }
  }

  private async enrichImage(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    msg: Message,
    media: { mimetype?: string; filename?: string }
  ): Promise<void> {
    const result = await this.storageService.uploadFromBuffer(
      buffer,
      accountId,
      {
        mimetype: media.mimetype,
      }
    );
    if (result) {
      content.image = {
        url: result.url,
        caption: typeof msg.body === 'string' ? msg.body : null,
        mimetype: media.mimetype ?? null,
        extension: result.extension,
        size: result.size,
        height: null,
        width: null,
      };
    }
  }

  private async enrichVideo(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string | undefined }
  ): Promise<void> {
    const result = await this.storageService.uploadFromBuffer(
      buffer,
      accountId,
      {
        fileName: media.filename ?? undefined,
        mimetype: media.mimetype,
      }
    );
    if (result) {
      content.video = {
        url: result.url,
        caption: null,
        name: media.filename ?? result.name,
        mimetype: media.mimetype ?? result.mimetype ?? 'video/mp4',
        extension: result.extension,
        size: result.size,
        duration: null,
        height: null,
        width: null,
        thumbnail: null,
      };
    }
  }

  private async enrichAudio(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string | undefined }
  ): Promise<void> {
    const result = await this.storageService.uploadFromBuffer(
      buffer,
      accountId,
      {
        fileName: media.filename ?? undefined,
        mimetype: media.mimetype,
      }
    );
    if (result) {
      content.audio = {
        url: result.url,
        name: media.filename ?? result.name,
        mimetype: media.mimetype ?? result.mimetype ?? null,
        extension: result.extension,
        size: result.size,
        duration: null,
        ptt: false,
        view_once: false,
        waveform: null,
      };
    }
  }

  private async enrichDocument(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string | undefined }
  ): Promise<void> {
    const result = await this.storageService.uploadFromBuffer(
      buffer,
      accountId,
      {
        fileName: media.filename ?? undefined,
        mimetype: media.mimetype,
      }
    );
    if (result) {
      content.document = {
        url: result.url,
        name: media.filename ?? result.name,
        mimetype: media.mimetype ?? result.mimetype ?? null,
        extension: result.extension,
        size: result.size,
      };
    }
  }

  private async enrichSticker(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string },
    msg: Message
  ): Promise<void> {
    const stickerMeta = this.resolveStickerMeta(msg);
    const payloadLooksLottie = this.isLottiePayload(buffer);
    const isLottie = stickerMeta.isLottie || payloadLooksLottie;
    const isAnimated = stickerMeta.isAnimated || isLottie;
    const sourceMimetype = this.normalizeMimetype(
      media.mimetype ?? stickerMeta.mimetype
    );
    const mimetype = this.resolveStickerMimetype(sourceMimetype, isLottie);
    const forcedExt = this.resolveStickerExtension(mimetype, stickerMeta);
    const forcedFileName = forcedExt
      ? `sticker-${Date.now()}.${forcedExt}`
      : undefined;

    const result = await this.storageService.uploadFromBuffer(
      buffer,
      accountId,
      {
        fileName: forcedFileName,
        mimetype,
      }
    );
    if (result) {
      content.sticker = {
        url: result.url,
        mimetype: mimetype ?? result.mimetype ?? null,
        extension: result.extension,
        size: result.size,
        height: stickerMeta.height,
        width: stickerMeta.width,
        is_animated: isAnimated,
      };
    }
  }

  private resolveStickerMeta(msg: Message): WwebjsStickerMeta {
    const rawData = (msg as unknown as { _data?: WwebjsStickerRawData })._data;

    const mimetype =
      typeof rawData?.mimetype === 'string'
        ? rawData.mimetype.trim().toLowerCase()
        : undefined;
    const isAnimated = this.isTrue(rawData?.isAnimated);
    const isLottie = this.isTrue(rawData?.isLottie);

    return {
      mimetype,
      isAnimated: isAnimated || isLottie,
      isLottie,
      width: this.toNullableNumber(rawData?.width),
      height: this.toNullableNumber(rawData?.height),
    };
  }

  private resolveStickerExtension(
    mimetype: string | undefined,
    meta: WwebjsStickerMeta
  ): string | undefined {
    const normalizedMime = mimetype?.trim().toLowerCase();
    if (meta.isLottie || normalizedMime === 'application/was') {
      return LOTTIE_STICKER_EXT;
    }

    if (normalizedMime === 'application/x-tgsticker') {
      return 'tgs';
    }

    if (normalizedMime === 'image/webp') {
      return 'webp';
    }

    return undefined;
  }

  private resolveStickerMimetype(
    mimetype: string | undefined,
    isLottie: boolean
  ): string | undefined {
    if (isLottie) return LOTTIE_STICKER_MIME;
    return mimetype;
  }

  private normalizeMimetype(mimetype?: string): string | undefined {
    if (typeof mimetype !== 'string') return undefined;
    const normalized = mimetype.trim().toLowerCase();
    if (!normalized) return undefined;
    return normalized;
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value !== 'number') return null;
    if (!Number.isFinite(value)) return null;
    return value > 0 ? value : null;
  }

  private isTrue(value: unknown): boolean {
    return value === true;
  }

  private isLottiePayload(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;
    const hasZipHeader = buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!hasZipHeader) return false;
    return buffer.includes(LOTTIE_ZIP_ENTRY_MARKER);
  }
}
