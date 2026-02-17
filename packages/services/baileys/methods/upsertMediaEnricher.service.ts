import { injectable, inject } from 'tsyringe';
import { Buffer } from 'node:buffer';
import {
  downloadContentFromMessage,
  downloadMediaMessage,
  proto,
  WAMessage,
} from '@whiskeysockets/baileys';
import { unwrapMessage } from '@core/common/functions/unwrapMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { IContent } from '@core/common/interfaces/IChatMessage';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { StorageService } from '@core/services/storage.service';
import { convertWaveformToBase64 } from '@core/common/functions/convertWaveform';

const MEDIA_DOWNLOAD_TIMEOUT_MS = 15000;
const LOTTIE_STICKER_EXT = 'was';
const LOTTIE_STICKER_MIME = 'application/was';
const LOTTIE_ZIP_ENTRY_MARKER = Buffer.from('animation/animation.json');
const LOTTIE_JSON_ENTRY_MARKER = Buffer.from('animation.json');

@injectable()
export class BaileysUpsertMediaEnricher {
  constructor(
    @inject(StorageService)
    private readonly storageService: StorageService
  ) {}

  async enrich(upsert: IUpsertMessage, waMessage: WAMessage): Promise<void> {
    const type = upsert.type;
    const content: Partial<IContent> = { type };

    if (type === EMessageType.image) {
      await this.enrichImage(content, waMessage, upsert.account_id);
    }
    if (type === EMessageType.video || type === EMessageType.video_note) {
      await this.enrichVideo(content, waMessage, upsert.account_id);
    }
    if (type === EMessageType.audio) {
      await this.enrichAudio(content, waMessage, upsert.account_id);
    }
    if (type === EMessageType.document) {
      await this.enrichDocument(content, waMessage, upsert.account_id);
    }
    if (type === EMessageType.sticker) {
      await this.enrichSticker(content, waMessage, upsert.account_id);
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

  private getInnerMessage(
    waMessage: WAMessage,
    keepViewOnce = false
  ): proto.IMessage | null {
    const msg = waMessage.message;
    if (!msg) return null;
    return unwrapMessage(msg, { keepViewOnce }) ?? msg;
  }

  private async downloadWithTimeout(message: WAMessage): Promise<Buffer> {
    return Promise.race([
      downloadMediaMessage(message, 'buffer', { startByte: 0 }),
      new Promise<Buffer>((_, reject) =>
        setTimeout(
          () => reject(new Error('Download timeout')),
          MEDIA_DOWNLOAD_TIMEOUT_MS
        )
      ),
    ]);
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async downloadStickerWithFallback(
    waMessage: WAMessage,
    stickerMsg: proto.Message.IStickerMessage
  ): Promise<Buffer> {
    try {
      return await this.downloadWithTimeout(waMessage);
    } catch {
      const hasMediaKey =
        stickerMsg.mediaKey instanceof Uint8Array &&
        stickerMsg.mediaKey.length > 0;
      const hasPath =
        typeof stickerMsg.directPath === 'string' &&
        stickerMsg.directPath.length > 0;
      const hasUrl =
        typeof stickerMsg.url === 'string' && stickerMsg.url.length > 0;

      if (!hasMediaKey || (!hasPath && !hasUrl)) {
        throw new Error('Sticker message does not have download metadata');
      }

      return Promise.race([
        (async () => {
          const stream = await downloadContentFromMessage(
            {
              mediaKey: stickerMsg.mediaKey,
              directPath: hasPath ? stickerMsg.directPath : undefined,
              url: hasUrl ? stickerMsg.url : undefined,
            },
            'sticker',
            { startByte: 0 }
          );

          return this.streamToBuffer(stream);
        })(),
        new Promise<Buffer>((_, reject) =>
          setTimeout(
            () => reject(new Error('Sticker download timeout')),
            MEDIA_DOWNLOAD_TIMEOUT_MS
          )
        ),
      ]);
    }
  }

  private getImageMessage(
    waMessage: WAMessage
  ): proto.Message.IImageMessage | null {
    const msg = this.getInnerMessage(waMessage);
    if (!msg) return null;
    if (msg.imageMessage?.url) return msg.imageMessage;
    const withCaption = (msg as Record<string, unknown>)
      .imageWithCaptionMessage as
      | { message?: { imageMessage?: proto.Message.IImageMessage } }
      | undefined;
    if (withCaption?.message?.imageMessage?.url) {
      return withCaption.message.imageMessage;
    }
    return null;
  }

  private getVideoMessage(
    waMessage: WAMessage
  ): proto.Message.IVideoMessage | null {
    const msg = this.getInnerMessage(waMessage) as
      | Record<string, unknown>
      | undefined;
    if (!msg) return null;
    const ptv = msg.ptvMessage as proto.Message.IVideoMessage | undefined;
    if (ptv?.url) return ptv;
    if ((msg.videoMessage as proto.Message.IVideoMessage | undefined)?.url) {
      return msg.videoMessage as proto.Message.IVideoMessage;
    }
    const withCaption = msg.videoWithCaptionMessage as
      | { message?: { videoMessage?: proto.Message.IVideoMessage } }
      | undefined;
    if (withCaption?.message?.videoMessage?.url) {
      return withCaption.message.videoMessage;
    }
    return null;
  }

  private getDocumentMessage(
    waMessage: WAMessage
  ): proto.Message.IDocumentMessage | null {
    const msg = this.getInnerMessage(waMessage);
    if (!msg) return null;
    if (msg.documentMessage?.url) return msg.documentMessage;
    const withCaption = (msg as Record<string, unknown>)
      .documentWithCaptionMessage as
      | { message?: { documentMessage?: proto.Message.IDocumentMessage } }
      | undefined;
    if (withCaption?.message?.documentMessage?.url) {
      return withCaption.message.documentMessage;
    }
    return null;
  }

  private async enrichImage(
    content: Partial<IContent>,
    waMessage: WAMessage,
    accountId: string
  ): Promise<void> {
    const imageMsg = this.getImageMessage(waMessage);
    if (!imageMsg) return;

    try {
      const buffer = await this.downloadWithTimeout(waMessage);
      const photoResult = await this.storageService.uploadFromBuffer(
        buffer,
        accountId
      );
      if (photoResult) {
        content.image = {
          url: photoResult.url,
          caption: imageMsg.caption ?? null,
          mimetype: imageMsg.mimetype ?? null,
          extension: photoResult.extension,
          size: photoResult.size,
          height: imageMsg.height ?? null,
          width: imageMsg.width ?? null,
        };
      }
    } catch {
      content.media_download_failed = true;
    }
  }

  private async enrichVideo(
    content: Partial<IContent>,
    waMessage: WAMessage,
    accountId: string
  ): Promise<void> {
    const videoMsg = this.getVideoMessage(waMessage);
    if (!videoMsg) return;

    try {
      const buffer = await this.downloadWithTimeout(waMessage);
      const inferredVideoName =
        (videoMsg as { fileName?: string | null }).fileName ?? undefined;
      const videoResult = await this.storageService.uploadFromBuffer(
        buffer,
        accountId,
        {
          fileName: inferredVideoName,
          mimetype: videoMsg.mimetype ?? undefined,
        }
      );

      const thumb =
        videoMsg.jpegThumbnail && videoMsg.jpegThumbnail.length > 0
          ? `data:image/jpeg;base64,${Buffer.from(videoMsg.jpegThumbnail).toString('base64')}`
          : null;

      if (videoResult) {
        content.video = {
          url: videoResult.url,
          caption: videoMsg.caption ?? null,
          name: inferredVideoName ?? videoResult.name,
          mimetype: videoMsg.mimetype ?? videoResult.mimetype ?? 'video/mp4',
          extension: videoResult.extension,
          size: videoResult.size,
          duration: videoMsg.seconds ?? null,
          height: videoMsg.height ?? null,
          width: videoMsg.width ?? null,
          thumbnail: thumb,
        };
      }
    } catch {
      content.media_download_failed = true;
    }
  }

  private async enrichAudio(
    content: Partial<IContent>,
    waMessage: WAMessage,
    accountId: string
  ): Promise<void> {
    const msg = this.getInnerMessage(waMessage);
    if (!msg?.audioMessage?.url) return;

    const audioMsg = msg.audioMessage;
    try {
      const buffer = await this.downloadWithTimeout(waMessage);
      const inferredAudioName =
        (audioMsg as { fileName?: string | null }).fileName ?? undefined;
      const audioResult = await this.storageService.uploadFromBuffer(
        buffer,
        accountId,
        {
          fileName: inferredAudioName,
          mimetype: audioMsg.mimetype ?? undefined,
        }
      );
      const waveform = convertWaveformToBase64(audioMsg.waveform);

      if (audioResult) {
        content.audio = {
          url: audioResult.url,
          name: inferredAudioName ?? audioResult.name,
          mimetype: audioMsg.mimetype ?? audioResult.mimetype ?? null,
          extension: audioResult.extension,
          size: audioResult.size,
          duration: audioMsg.seconds ?? null,
          ptt: audioMsg.ptt ?? false,
          view_once: waMessage.key?.isViewOnce ?? false,
          waveform: waveform ?? null,
        };
      }
    } catch {
      content.media_download_failed = true;
    }
  }

  private async enrichDocument(
    content: Partial<IContent>,
    waMessage: WAMessage,
    accountId: string
  ): Promise<void> {
    const documentMsg = this.getDocumentMessage(waMessage);
    if (!documentMsg) return;

    try {
      const buffer = await this.downloadWithTimeout(waMessage);
      const documentResult = await this.storageService.uploadFromBuffer(
        buffer,
        accountId,
        {
          fileName: documentMsg.fileName ?? undefined,
          mimetype: documentMsg.mimetype ?? undefined,
        }
      );
      if (documentResult) {
        content.document = {
          url: documentResult.url,
          name: documentMsg.fileName ?? documentResult.name,
          mimetype: documentMsg.mimetype ?? documentResult.mimetype ?? null,
          extension: documentResult.extension,
          size: documentResult.size,
        };
      }
    } catch {
      content.media_download_failed = true;
    }
  }

  private async enrichSticker(
    content: Partial<IContent>,
    waMessage: WAMessage,
    accountId: string
  ): Promise<void> {
    const msg = this.getInnerMessage(waMessage);
    if (!msg?.stickerMessage?.url) return;

    const stickerMsg = msg.stickerMessage;
    try {
      const buffer = await this.downloadStickerWithFallback(
        waMessage,
        stickerMsg
      );
      const sourceMimetype = this.normalizeMimetype(stickerMsg.mimetype);
      const payloadLooksLottie = this.isLottiePayload(buffer);
      const isLottie =
        this.isLottieSticker(stickerMsg, sourceMimetype) || payloadLooksLottie;
      const mimetype = this.resolveStickerMimetype(sourceMimetype, isLottie);
      const forcedExt = this.resolveStickerExtension(mimetype, isLottie);
      const forcedFileName = forcedExt
        ? `sticker-${Date.now()}.${forcedExt}`
        : undefined;
      const stickerResult = await this.storageService.uploadFromBuffer(
        buffer,
        accountId,
        {
          fileName: forcedFileName,
          mimetype,
        }
      );
      if (stickerResult) {
        content.sticker = {
          url: stickerResult.url,
          mimetype: mimetype ?? stickerResult.mimetype ?? null,
          extension: stickerResult.extension,
          size: stickerResult.size,
          height: stickerMsg.height ?? stickerResult.height ?? null,
          width: stickerMsg.width ?? stickerResult.width ?? null,
          is_animated: stickerMsg.isAnimated ?? isLottie,
        };
      }
    } catch {
      content.media_download_failed = true;
    }
  }

  private isLottieSticker(
    stickerMessage: proto.Message.IStickerMessage,
    mimetype?: string
  ): boolean {
    const lottieFlag =
      (stickerMessage as unknown as { isLottie?: unknown }).isLottie === true;
    const animatedFlag = stickerMessage.isAnimated === true;

    return (
      lottieFlag ||
      mimetype === 'application/was' ||
      mimetype === 'application/x-tgsticker' ||
      (animatedFlag && mimetype === undefined)
    );
  }

  private resolveStickerMimetype(
    mimetype: string | undefined,
    isLottie: boolean
  ): string | undefined {
    if (isLottie) return LOTTIE_STICKER_MIME;
    return mimetype;
  }

  private normalizeMimetype(mimetype?: string | null): string | undefined {
    if (typeof mimetype !== 'string') return undefined;
    const normalized = mimetype.toLowerCase().split(';')[0]?.trim();
    if (!normalized) return undefined;
    return normalized;
  }

  private resolveStickerExtension(
    mimetype: string | undefined,
    isLottie: boolean
  ): string | undefined {
    if (isLottie || mimetype === 'application/was') {
      return LOTTIE_STICKER_EXT;
    }

    if (mimetype === 'application/x-tgsticker') {
      return 'tgs';
    }

    if (mimetype === 'image/webp') {
      return 'webp';
    }

    return undefined;
  }

  private isLottiePayload(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;
    const hasZipHeader = buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!hasZipHeader) return false;
    if (buffer.includes(LOTTIE_ZIP_ENTRY_MARKER)) return true;
    if (buffer.includes(LOTTIE_JSON_ENTRY_MARKER)) return true;

    // WhatsApp lottie stickers are zip payloads; some clients vary inner path names.
    return true;
  }
}
