import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { UpdateMessageTemplateRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { IUpdateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/IUpdateMessageTemplate';
import { EMessageType } from '@core/common/enums/EMessageType';

@injectable()
export class MessageTemplateUpdaterUseCase {
  constructor(
    @inject(MessageTemplateService)
    private readonly messageTemplateService: MessageTemplateService,
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

  async execute(
    t: TFunction<'translation', undefined>,
    messageTemplateId: string,
    body: UpdateMessageTemplateRequest,
    accountId: string
  ): Promise<boolean> {
    const currentTemplate = await this.ensureMessageTemplateExists(
      t,
      messageTemplateId
    );
    await this.ensureMessageStatusIsValid(t, body);

    const effectiveMessageType = this.resolveMessageType(
      body.type?.value,
      currentTemplate.type
    );

    const attachment = await this.processAttachmentIfPresent(
      t,
      body,
      accountId,
      effectiveMessageType
    );

    const { resolvedAttachmentUrl, mimetype, duration, width, height } =
      this.resolveAttachmentMetadata(attachment, body);

    const inputWithAttachment: IUpdateMessageTemplate = {
      message_template_id: messageTemplateId,
      message:
        effectiveMessageType === EMessageType.audio ? '' : body.message?.value,
      command: body.command?.value,
      attachment_url: resolvedAttachmentUrl,
      message_status_id: body.message_status_id?.value,
      type: body.type?.value,
      mimetype,
      duration,
      width,
      height,
      auto_send: this.normalizeBooleanValue(body.auto_send?.value),
    };

    const messageTemplateUpdater =
      await this.messageTemplateService.updateMessageTemplateById(
        inputWithAttachment
      );

    if (!messageTemplateUpdater) {
      throw new Error(t('message_template_update_error'));
    }

    return messageTemplateUpdater;
  }

  private normalizeBooleanValue(value: unknown): boolean | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    return undefined;
  }

  private resolveMessageType(
    inputType: string | null | undefined,
    currentType?: string | null
  ): EMessageType {
    const resolved = inputType ?? currentType ?? EMessageType.text;

    if (Object.values(EMessageType).includes(resolved as EMessageType)) {
      return resolved as EMessageType;
    }

    return EMessageType.text;
  }

  private async ensureMessageTemplateExists(
    t: TFunction<'translation', undefined>,
    messageTemplateId: string
  ): Promise<{ type: string }> {
    const messageTemplate =
      await this.messageTemplateService.viewMessageTemplateById(
        messageTemplateId
      );

    if (!messageTemplate) {
      throw new Error(t('message_template_not_found'));
    }

    return messageTemplate;
  }

  private async ensureMessageStatusIsValid(
    t: TFunction<'translation', undefined>,
    body: UpdateMessageTemplateRequest
  ): Promise<void> {
    const messageStatusId = body.message_status_id?.value;
    if (!messageStatusId) return;

    const messageStatusExists =
      await this.messageTemplateService.existsMessageStatusById(
        messageStatusId
      );

    if (!messageStatusExists) {
      throw new Error(t('message_status_not_found'));
    }
  }

  private async processAttachmentIfPresent(
    t: TFunction<'translation', undefined>,
    body: UpdateMessageTemplateRequest,
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
    body: UpdateMessageTemplateRequest
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
