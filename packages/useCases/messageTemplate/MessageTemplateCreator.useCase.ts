import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { StorageService } from '@core/services/storage.service';
import { ICreateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/ICreateMessageTemplate';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';

@injectable()
export class MessageTemplateCreatorUseCase {
  private readonly MAX_ATTACHMENT_SIZE = 16 * 1024 * 1024;
  private readonly ALLOWED_ATTACHMENT_EXTENSIONS = [
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

  constructor(
    private readonly messageTemplateService: MessageTemplateService,
    private readonly accountService: AccountService,
    private readonly storageService: StorageService
  ) {}

  private async validateAccountExists(
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }
  }

  private async validateMessageStatusExists(
    messageStatusId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const messageStatusExists =
      await this.messageTemplateService.existsMessageStatusById(
        messageStatusId
      );

    if (!messageStatusExists) {
      throw new Error(t('message_status_not_found'));
    }
  }

  private async validateAttachment(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();
    const size = buffer.byteLength;

    const match = /\.([^./\\]+)$/.exec(file.filename);
    const ext = match?.[1]?.toLowerCase() ?? '';

    const isAllowedExt =
      !!ext && this.ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext);
    const isAllowedSize = size <= this.MAX_ATTACHMENT_SIZE;

    if (!isAllowedExt) {
      throw new Error(t('invalid_attachment_type'));
    }

    if (!isAllowedSize) {
      throw new Error(t('invalid_attachment_size'));
    }
  }

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
    inputType: string | undefined,
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

  private async uploadAttachmentByType(
    file: UploadFileRequest,
    messageType: EMessageType,
    accountId: string
  ): Promise<UploadFileResponse | null> {
    if (messageType === EMessageType.image) {
      return await this.storageService.uploadImage(file, accountId);
    }

    if (messageType === EMessageType.video) {
      return await this.storageService.uploadVideo(file, accountId);
    }

    if (messageType === EMessageType.audio) {
      return await this.storageService.uploadAudio(file, accountId);
    }

    throw new Error('Invalid message type for attachment upload');
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateMessageTemplateRequest,
    accountId: string
  ): Promise<boolean> {
    await this.validateAccountExists(accountId, t);
    await this.validateMessageStatusExists(input.message_status_id.value, t);

    const messageType = this.resolveMessageType(
      input.type?.value,
      input.attachment_url?.filename
    );

    let attachmentUrl: UploadFileResponse | null = null;

    if (input.attachment_url?.filename) {
      await this.validateAttachment(input.attachment_url, t);

      attachmentUrl = await this.uploadAttachmentByType(
        input.attachment_url,
        messageType,
        accountId
      );
    }

    const inputWithAttachment: ICreateMessageTemplate = {
      account_id: accountId,
      message: input.message.value,
      command: input.command.value,
      attachment_url: attachmentUrl ? attachmentUrl.url : null,
      message_status_id: input.message_status_id.value,
      type: messageType,
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
