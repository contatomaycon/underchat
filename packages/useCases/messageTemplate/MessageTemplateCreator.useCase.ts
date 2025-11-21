import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { StorageService } from '@core/services/storage.service';
import { ICreateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/ICreateMessageTemplate';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';

@injectable()
export class MessageTemplateCreatorUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService,
    private readonly accountService: AccountService,
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
    input: CreateMessageTemplateRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const messageStatusExists =
      await this.messageTemplateService.existsMessageStatusById(
        input.message_status_id.value
      );

    if (!messageStatusExists) {
      throw new Error(t('message_status_not_found'));
    }

    let attachmentUrl: UploadFileResponse | null = null;

    if (input.attachment_url?.filename) {
      await this.validateAttachment(input.attachment_url, t);

      attachmentUrl = await this.storageService.uploadImage(
        input.attachment_url,
        accountId
      );
    }

    const inputWithAttachment: ICreateMessageTemplate = {
      account_id: accountId,
      message: input.message.value,
      command: input.command.value,
      attachment_url: attachmentUrl ? attachmentUrl.url : null,
      message_status_id: input.message_status_id.value,
    };

    const createMessageTemplate =
      await this.messageTemplateService.createMessageTemplate(
        inputWithAttachment
      );

    if (!createMessageTemplate) {
      throw new Error(t('message_template_creation_failed'));
    }

    return true;
  }
}
