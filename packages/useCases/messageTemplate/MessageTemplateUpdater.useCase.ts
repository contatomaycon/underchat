import { injectable } from 'tsyringe';
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
    private readonly messageTemplateService: MessageTemplateService,
    private readonly storageService: StorageService,
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
    const messageTemplateExists =
      await this.messageTemplateService.existsMessageTemplateById(
        messageTemplateId
      );

    if (!messageTemplateExists) {
      throw new Error(t('message_template_not_found'));
    }

    if (body.message_status_id?.value) {
      const messageStatusExists =
        await this.messageTemplateService.existsMessageStatusById(
          body.message_status_id.value
        );

      if (!messageStatusExists) {
        throw new Error(t('message_status_not_found'));
      }
    }

    let attachmentUrl:
      | (UploadFileResponse & {
          mimetype?: string | null;
          duration?: number | null;
          width?: number | null;
          height?: number | null;
        })
      | null = null;

    let mimetype: string | null | undefined = undefined;
    let duration: number | null | undefined = undefined;
    let width: number | null | undefined = undefined;
    let height: number | null | undefined = undefined;

    if (body.attachment_url?.filename) {
      await this.validateAttachment(body.attachment_url, t);

      const messageType = (body.type?.value || 'text') as EMessageType;

      if (messageType === EMessageType.image) {
        const result = await this.storageService.uploadImage(
          body.attachment_url,
          accountId
        );
        if (result) {
          attachmentUrl = {
            ...result,
            mimetype: result.mimetype ?? null,
            duration: null,
            width: result.width ?? null,
            height: result.height ?? null,
          };
        }
      } else if (messageType === EMessageType.video) {
        const originalBuffer = await body.attachment_url.toBuffer();
        const originalMimetype = body.attachment_url.mimetype || null;

        const converted = await this.converterService.convertVideo(
          originalBuffer,
          originalMimetype
        );

        const filename =
          body.attachment_url.filename.replace(/\.[^.]+$/, '') || 'video';
        const newFilename = `${filename}.${converted.extension}`;

        const uploadResult = await this.storageService.uploadVideoFromBuffer(
          converted.buffer,
          newFilename,
          converted.mimetype,
          accountId,
          converted.width,
          converted.height
        );

        if (uploadResult) {
          attachmentUrl = {
            ...uploadResult,
            mimetype: converted.mimetype,
            duration: converted.duration ?? null,
            width: converted.width ?? null,
            height: converted.height ?? null,
          };
        }
      } else if (messageType === EMessageType.audio) {
        const originalBuffer = await body.attachment_url.toBuffer();
        const originalMimetype = body.attachment_url.mimetype || null;

        const converted = await this.converterService.convertAudio(
          originalBuffer,
          originalMimetype,
          true
        );

        const filename =
          body.attachment_url.filename.replace(/\.[^.]+$/, '') || 'audio';
        const newFilename = `${filename}.${converted.extension}`;

        const uploadResult = await this.storageService.uploadAudioFromBuffer(
          converted.buffer,
          newFilename,
          converted.mimetype,
          accountId
        );

        if (uploadResult) {
          attachmentUrl = {
            ...uploadResult,
            mimetype: converted.mimetype,
            duration: converted.duration ?? null,
            width: null,
            height: null,
          };
        }
      }
    }

    let resolvedAttachmentUrl: string | null | undefined;
    if (attachmentUrl) {
      resolvedAttachmentUrl = attachmentUrl.url;
      mimetype = attachmentUrl.mimetype ?? null;
      duration = attachmentUrl.duration ?? null;
      width = attachmentUrl.width ?? null;
      height = attachmentUrl.height ?? null;
    } else if (body.attachment_url) {
      resolvedAttachmentUrl = null;
      mimetype = null;
      duration = null;
      width = null;
      height = null;
    } else {
      resolvedAttachmentUrl = undefined;
    }

    const inputWithAttachment: IUpdateMessageTemplate = {
      message_template_id: messageTemplateId,
      message: body.message?.value,
      command: body.command?.value,
      attachment_url: resolvedAttachmentUrl,
      message_status_id: body.message_status_id?.value,
      type: body.type?.value,
      mimetype,
      duration,
      width,
      height,
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
}
