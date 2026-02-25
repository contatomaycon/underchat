import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { RandomMessageService } from '@core/services/randomMessage.service';
import { UpdateRandomMessageItemRequest } from '@core/schema/randomMessage/updateRandomMessageItem/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';

@injectable()
export class RandomMessageItemUpdaterUseCase {
  constructor(
    @inject(RandomMessageService)
    private readonly randomMessageService: RandomMessageService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService
  ) {}

  private async validateAttachment(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const MAX_ATTACHMENT_SIZE = 16 * 1024 * 1024;
    const ALLOWED_ATTACHMENT_EXTENSIONS = [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'webp',
      'pdf',
      'mp3',
      'wav',
      'ogg',
      'm4a',
      'aac',
      'flac',
      'opus',
      'mp4',
      'webm',
    ];

    const buffer = await file.toBuffer();
    const size = buffer.byteLength;

    const match = /\.([^./\\]+)$/.exec(file.filename);
    const ext = match?.[1]?.toLowerCase() ?? '';

    const isAllowedExt = !!ext && ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext);
    const isAllowedSize = size <= MAX_ATTACHMENT_SIZE;

    if (!isAllowedExt) {
      throw new Error(t('invalid_attachment_type'));
    }

    if (!isAllowedSize) {
      throw new Error(t('invalid_attachment_size'));
    }
  }

  private readonly IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  private readonly VIDEO_EXTENSIONS = ['mp4', 'webm'];
  private readonly AUDIO_EXTENSIONS = [
    'mp3',
    'wav',
    'ogg',
    'm4a',
    'aac',
    'flac',
    'opus',
  ];

  private getFileExtension(filename: string): string {
    const match = /\.([^./\\]+)$/.exec(filename);
    return match?.[1]?.toLowerCase() ?? '';
  }

  private inferMessageTypeFromFile(filename: string): EMessageType | null {
    const ext = this.getFileExtension(filename);

    if (this.IMAGE_EXTENSIONS.includes(ext)) {
      return EMessageType.image;
    }

    if (this.VIDEO_EXTENSIONS.includes(ext)) {
      return EMessageType.video;
    }

    if (this.AUDIO_EXTENSIONS.includes(ext)) {
      return EMessageType.audio;
    }

    return null;
  }

  private resolveMessageType(
    inputType: string | null | undefined,
    attachmentFilename?: string
  ): EMessageType {
    if (
      inputType &&
      Object.values(EMessageType).includes(inputType as EMessageType)
    ) {
      return inputType as EMessageType;
    }

    if (!attachmentFilename) {
      return EMessageType.text;
    }

    const inferredType = this.inferMessageTypeFromFile(attachmentFilename);

    if (inferredType) {
      return inferredType;
    }

    return EMessageType.text;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    randomMessageItemId: string,
    accountId: string,
    body: UpdateRandomMessageItemRequest
  ): Promise<boolean> {
    await this.ensureRandomMessageExists(t, randomMessageId, accountId);
    const currentRandomMessageItem = await this.ensureRandomMessageItemExists(
      t,
      randomMessageItemId,
      randomMessageId,
      accountId
    );

    const effectiveMessageType = this.resolveMessageType(
      body.type?.value ?? currentRandomMessageItem.type,
      body.attachment_url?.filename
    );

    const attachment = await this.processAttachmentIfPresent(
      t,
      body,
      accountId,
      effectiveMessageType
    );

    const { resolvedAttachmentUrl, mimetype, duration, width, height } =
      this.resolveAttachmentMetadata(attachment, body);

    const updated = await this.randomMessageService.updateRandomMessageItemById(
      {
        random_message_item_id: randomMessageItemId,
        random_message_id: randomMessageId,
        account_id: accountId,
        message:
          effectiveMessageType === EMessageType.audio
            ? ''
            : body.message?.value,
        status: body.status?.value,
        type: body.type?.value,
        attachment_url: resolvedAttachmentUrl,
        mimetype,
        duration,
        width,
        height,
      }
    );

    if (!updated) {
      throw new Error(t('random_message_item_update_error'));
    }

    return updated;
  }

  private async ensureRandomMessageExists(
    t: TFunction<'translation', undefined>,
    randomMessageId: string,
    accountId: string
  ): Promise<void> {
    const randomMessage = await this.randomMessageService.viewRandomMessageById(
      randomMessageId,
      accountId
    );

    if (!randomMessage) {
      throw new Error(t('random_message_not_found'));
    }
  }

  private async ensureRandomMessageItemExists(
    t: TFunction<'translation', undefined>,
    randomMessageItemId: string,
    randomMessageId: string,
    accountId: string
  ): Promise<{ type: string }> {
    const randomMessageItem =
      await this.randomMessageService.viewRandomMessageItemById(
        randomMessageItemId,
        randomMessageId,
        accountId
      );

    if (!randomMessageItem) {
      throw new Error(t('random_message_item_not_found'));
    }

    return randomMessageItem;
  }

  private async processAttachmentIfPresent(
    t: TFunction<'translation', undefined>,
    body: UpdateRandomMessageItemRequest,
    accountId: string,
    messageType: EMessageType
  ): Promise<
    | (UploadFileResponse & {
        mimetype?: string | null;
        duration?: number | null;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    const file = body.attachment_url;
    if (!file?.filename) return null;

    await this.validateAttachment(file, t);

    if (messageType === EMessageType.image) {
      return this.uploadImageAttachment(file, accountId);
    }

    if (messageType === EMessageType.video) {
      return this.uploadVideoAttachment(file, accountId);
    }

    if (messageType === EMessageType.audio) {
      return this.uploadAudioAttachment(file, accountId);
    }

    return null;
  }

  private async uploadImageAttachment(
    file: UploadFileRequest,
    accountId: string
  ): Promise<
    | (UploadFileResponse & {
        mimetype?: string | null;
        duration?: number | null;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    const result = await this.storageService.uploadImage(file, accountId);
    if (!result) {
      return null;
    }

    return {
      ...result,
      mimetype: result.mimetype ?? null,
      duration: null,
      width: result.width ?? null,
      height: result.height ?? null,
    };
  }

  private async uploadVideoAttachment(
    file: UploadFileRequest,
    accountId: string
  ): Promise<
    | (UploadFileResponse & {
        mimetype?: string | null;
        duration?: number | null;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    const originalBuffer = await file.toBuffer();
    const originalMimetype = file.mimetype || null;

    const converted = await this.converterService.convertVideo(
      originalBuffer,
      originalMimetype
    );

    const filename = file.filename.replace(/\.[^.]+$/, '') || 'video';
    const newFilename = `${filename}.${converted.extension}`;

    const uploadResult = await this.storageService.uploadVideoFromBuffer(
      converted.buffer,
      newFilename,
      converted.mimetype,
      accountId,
      converted.width,
      converted.height
    );

    if (!uploadResult) {
      return null;
    }

    return {
      ...uploadResult,
      mimetype: converted.mimetype,
      duration: converted.duration ?? null,
      width: converted.width ?? null,
      height: converted.height ?? null,
    };
  }

  private async uploadAudioAttachment(
    file: UploadFileRequest,
    accountId: string
  ): Promise<
    | (UploadFileResponse & {
        mimetype?: string | null;
        duration?: number | null;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    const originalBuffer = await file.toBuffer();
    const originalMimetype = file.mimetype || null;

    const converted = await this.converterService.convertAudio(
      originalBuffer,
      originalMimetype,
      true
    );

    const filename = file.filename.replace(/\.[^.]+$/, '') || 'audio';
    const newFilename = `${filename}.${converted.extension}`;

    const uploadResult = await this.storageService.uploadAudioFromBuffer(
      converted.buffer,
      newFilename,
      converted.mimetype,
      accountId
    );

    if (!uploadResult) {
      return null;
    }

    return {
      ...uploadResult,
      mimetype: converted.mimetype,
      duration: converted.duration ?? null,
      width: null,
      height: null,
    };
  }

  private resolveAttachmentMetadata(
    attachment:
      | (UploadFileResponse & {
          mimetype?: string | null;
          duration?: number | null;
          width?: number | null;
          height?: number | null;
        })
      | null,
    body: UpdateRandomMessageItemRequest
  ): {
    resolvedAttachmentUrl: string | null | undefined;
    mimetype: string | null | undefined;
    duration: number | null | undefined;
    width: number | null | undefined;
    height: number | null | undefined;
  } {
    if (attachment) {
      return {
        resolvedAttachmentUrl: attachment.url,
        mimetype: attachment.mimetype ?? null,
        duration: attachment.duration ?? null,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
      };
    }

    if (body.attachment_url) {
      return {
        resolvedAttachmentUrl: null,
        mimetype: null,
        duration: null,
        width: null,
        height: null,
      };
    }

    return {
      resolvedAttachmentUrl: undefined,
      mimetype: undefined,
      duration: undefined,
      width: undefined,
      height: undefined,
    };
  }
}
