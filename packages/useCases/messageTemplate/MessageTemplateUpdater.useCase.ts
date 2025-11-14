import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { UpdateMessageTemplateRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { IUpdateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/IUpdateMessageTemplate';

@injectable()
export class MessageTemplateUpdaterUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService,
    private readonly storageService: StorageService
  ) {}

  private async validateAttachment(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
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

    let attachmentUrl: UploadFileResponse | null = null;

    if (body.attachment_url?.filename) {
      await this.validateAttachment(body.attachment_url, t);

      attachmentUrl = await this.storageService.uploadImage(
        body.attachment_url,
        accountId
      );
    }

    const inputWithAttachment: IUpdateMessageTemplate = {
      message_template_id: messageTemplateId,
      message: body.message.value,
      command: body.command.value,
      attachment_url: attachmentUrl ? attachmentUrl.url : null,
      message_status_id: body.message_status_id.value,
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
