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

interface WwebjsRawData {
  body?: unknown;
  caption?: unknown;
  mimetype?: unknown;
  filename?: unknown;
  duration?: unknown;
  seconds?: unknown;
  width?: unknown;
  height?: unknown;
  ptt?: unknown;
  isPtt?: unknown;
  staticUrl?: unknown;
  campaignId?: unknown;
  isAnimated?: unknown;
  isLottie?: unknown;
}

@injectable()
export class WwebjsUpsertMediaEnricher {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService
  ) {}

  async enrich(upsert: IUpsertMessage, msg: Message): Promise<void> {
    const type = upsert.type;
    const content: Partial<IContent> = { type };

    if (!msg.hasMedia) {
      const handledWithoutDownload =
        await this.enrichCampaignMediaWithoutDownload(upsert, content, msg);
      if (handledWithoutDownload) {
        return;
      }
      return;
    }

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
      await this.enrichVideo(
        content,
        buffer,
        upsert.account_id,
        mediaOpts,
        msg
      );
    }
    if (type === EMessageType.audio) {
      await this.enrichAudio(
        content,
        buffer,
        upsert.account_id,
        mediaOpts,
        msg
      );
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

  private async enrichCampaignMediaWithoutDownload(
    upsert: IUpsertMessage,
    content: Partial<IContent>,
    msg: Message
  ): Promise<boolean> {
    if (upsert.type !== EMessageType.video) {
      return false;
    }

    const rawData = this.getRawData(msg);
    const campaignId = this.getNonEmptyString(rawData.campaignId);
    const staticUrl = this.getNonEmptyString(rawData.staticUrl);

    if (!campaignId && !staticUrl) {
      return false;
    }

    const caption = this.resolveCaption(msg, rawData);
    const base64Body =
      this.getNonEmptyString(rawData.body) ?? this.getNonEmptyString(msg.body);
    const previewBuffer = this.decodeBase64Image(base64Body);

    if (previewBuffer) {
      const result = await this.storageService.uploadFromBuffer(
        previewBuffer,
        upsert.account_id,
        {
          fileName: campaignId
            ? `campaign-${campaignId}.png`
            : `campaign-${Date.now()}.png`,
          mimetype: 'image/png',
        }
      );

      if (result) {
        upsert.type = EMessageType.image;
        content.type = EMessageType.image;
        content.image = {
          url: result.url,
          caption,
          mimetype: result.mimetype ?? 'image/png',
          extension: result.extension,
          size: result.size,
          height: result.height ?? null,
          width: result.width ?? null,
        };
        upsert.content = { ...upsert.content, ...content } as IContent;
        return true;
      }
    }

    if (!staticUrl) {
      return false;
    }

    try {
      const uploaded = await this.storageService.uploadFromUrl(
        staticUrl,
        upsert.account_id,
        campaignId ? `campaign-${campaignId}` : undefined
      );

      if (!uploaded) {
        return false;
      }

      const isImage = (uploaded.mimetype ?? '').startsWith('image/');
      if (isImage) {
        upsert.type = EMessageType.image;
        content.type = EMessageType.image;
        content.image = {
          url: uploaded.url,
          caption,
          mimetype: uploaded.mimetype ?? null,
          extension: uploaded.extension,
          size: uploaded.size,
          height: uploaded.height ?? null,
          width: uploaded.width ?? null,
        };
      } else {
        content.video = {
          url: uploaded.url,
          caption,
          name: uploaded.name,
          mimetype: uploaded.mimetype ?? 'video/mp4',
          extension: uploaded.extension,
          size: uploaded.size,
          duration: this.toNullableNumber(rawData.duration),
          height: this.toNullableNumber(rawData.height),
          width: this.toNullableNumber(rawData.width),
          thumbnail: null,
        };
      }

      upsert.content = { ...upsert.content, ...content } as IContent;
      return true;
    } catch {
      return false;
    }
  }

  private async enrichImage(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    msg: Message,
    media: { mimetype?: string; filename?: string }
  ): Promise<void> {
    const rawData = this.getRawData(msg);
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
        caption: this.resolveCaption(msg),
        mimetype: media.mimetype ?? null,
        extension: result.extension,
        size: result.size,
        height: this.toNullableNumber(rawData.height),
        width: this.toNullableNumber(rawData.width),
      };
    }
  }

  private async enrichVideo(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string | undefined },
    msg: Message
  ): Promise<void> {
    const rawData = this.getRawData(msg);
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
        caption: this.resolveCaption(msg, rawData),
        name: media.filename ?? result.name,
        mimetype: media.mimetype ?? result.mimetype ?? 'video/mp4',
        extension: result.extension,
        size: result.size,
        duration: this.toNullableNumber(rawData.duration),
        height: this.toNullableNumber(rawData.height),
        width: this.toNullableNumber(rawData.width),
        thumbnail: null,
      };
    }
  }

  private async enrichAudio(
    content: Partial<IContent>,
    buffer: Buffer,
    accountId: string,
    media: { mimetype?: string; filename?: string | undefined },
    msg: Message
  ): Promise<void> {
    const rawData = this.getRawData(msg);
    const rawType = this.getNonEmptyString(msg.type)?.toLowerCase();
    const isPtt =
      rawType === 'ptt' ||
      this.isTrue(rawData.ptt) ||
      this.isTrue(rawData.isPtt);
    const isViewOnce = this.isTrue(
      (msg as unknown as { isViewOnce?: unknown }).isViewOnce
    );
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
        duration:
          this.toNullableNumber(rawData.seconds) ??
          this.toNullableNumber(rawData.duration),
        ptt: isPtt,
        view_once: isViewOnce,
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

  private getRawData(msg: Message): WwebjsRawData {
    const rawData = (msg as unknown as { _data?: unknown })._data;
    if (!rawData || typeof rawData !== 'object') {
      return {};
    }

    return rawData as WwebjsRawData;
  }

  private getNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private resolveCaption(
    msg: Message,
    rawData: WwebjsRawData = this.getRawData(msg)
  ): string | null {
    const caption = this.getNonEmptyString(rawData.caption);
    if (caption) {
      return caption;
    }

    const body = this.getNonEmptyString(msg.body);
    if (!body) {
      return null;
    }

    return this.isLikelyBase64ImagePayload(body) ? null : body;
  }

  private isLikelyBase64ImagePayload(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;
    if (normalized.startsWith('data:image/')) return true;
    if (normalized.length < 256) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false;

    return (
      normalized.startsWith('iVBORw0KGgo') ||
      normalized.startsWith('/9j/') ||
      normalized.startsWith('R0lGOD') ||
      normalized.startsWith('UklGR')
    );
  }

  private isImageBuffer(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;

    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    if (isPng) return true;

    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    if (isJpeg) return true;

    const isGif = buffer.toString('ascii', 0, 3) === 'GIF';
    if (isGif) return true;

    const isWebp =
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP';
    if (isWebp) return true;

    return false;
  }

  private decodeBase64Image(value?: string): Buffer | null {
    if (!value) return null;

    const normalized = value
      .trim()
      .replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');

    if (!this.isLikelyBase64ImagePayload(normalized)) {
      return null;
    }

    try {
      const buffer = Buffer.from(normalized, 'base64');
      if (!buffer.length) return null;
      return this.isImageBuffer(buffer) ? buffer : null;
    } catch {
      return null;
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
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return value > 0 ? value : null;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed)) return null;
      return parsed > 0 ? parsed : null;
    }

    return null;
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
