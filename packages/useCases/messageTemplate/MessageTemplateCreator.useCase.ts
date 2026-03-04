import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { ICreateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/ICreateMessageTemplate';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { WorkerService } from '@core/services/worker.service';

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
  private readonly DOCUMENT_EXTENSIONS = ['pdf'];
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
    @inject(MessageTemplateService)
    private readonly messageTemplateService: MessageTemplateService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  private normalizeChannelId(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    if (!normalized || normalized.toLowerCase() === 'null') {
      return null;
    }

    return normalized;
  }

  private async validateChannelExists(
    accountId: string,
    channelId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const channelExists = await this.workerService.existsWorkerById(
      accountId,
      channelId
    );

    if (!channelExists) {
      throw new Error(t('worker_not_found'));
    }
  }

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

    if (this.DOCUMENT_EXTENSIONS.includes(ext)) {
      return EMessageType.document;
    }

    if (this.AUDIO_EXTENSIONS.includes(ext)) {
      return EMessageType.audio;
    }

    return null;
  }

  private normalizeBooleanValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    return false;
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
  ): Promise<
    UploadFileResponse & {
      mimetype?: string | null;
      duration?: number | null;
      width?: number | null;
      height?: number | null;
    }
  > {
    if (messageType === EMessageType.image) {
      const result = await this.storageService.uploadImage(file, accountId);
      if (!result) {
        return null as any;
      }
      return {
        ...result,
        mimetype: result.mimetype ?? null,
        duration: null,
        width: result.width ?? null,
        height: result.height ?? null,
      };
    }

    if (messageType === EMessageType.video) {
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
        return null as any;
      }

      return {
        ...uploadResult,
        mimetype: converted.mimetype,
        duration: converted.duration ?? null,
        width: converted.width ?? null,
        height: converted.height ?? null,
      };
    }

    if (messageType === EMessageType.audio) {
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
        return null as any;
      }

      return {
        ...uploadResult,
        mimetype: converted.mimetype,
        duration: converted.duration ?? null,
        width: null,
        height: null,
      };
    }

    if (messageType === EMessageType.document) {
      const result = await this.storageService.uploadDocument(file, accountId);
      if (!result) {
        return null as any;
      }
      return {
        ...result,
        mimetype: result.mimetype ?? null,
        duration: null,
        width: null,
        height: null,
      };
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

    const channelId = this.normalizeChannelId(input.channel_id?.value);

    if (channelId) {
      await this.validateChannelExists(accountId, channelId, t);
    }

    const messageType = this.resolveMessageType(
      input.type?.value,
      input.attachment_url?.filename
    );

    let attachmentUrl:
      | (UploadFileResponse & {
          mimetype?: string | null;
          duration?: number | null;
          width?: number | null;
          height?: number | null;
        })
      | null = null;

    let mimetype: string | null = null;
    let duration: number | null = null;
    let width: number | null = null;
    let height: number | null = null;
    const normalizedMessage =
      messageType === EMessageType.audio ? '' : input.message.value;

    if (input.attachment_url?.filename) {
      await this.validateAttachment(input.attachment_url, t);

      attachmentUrl = await this.uploadAttachmentByType(
        input.attachment_url,
        messageType,
        accountId
      );

      if (attachmentUrl) {
        mimetype = attachmentUrl.mimetype ?? null;
        duration = attachmentUrl.duration ?? null;
        width = attachmentUrl.width ?? null;
        height = attachmentUrl.height ?? null;
      }
    }

    const inputWithAttachment: ICreateMessageTemplate = {
      account_id: accountId,
      channel_id: channelId,
      message: normalizedMessage,
      command: input.command.value,
      attachment_url: attachmentUrl ? attachmentUrl.url : null,
      message_status_id: input.message_status_id.value,
      type: messageType,
      mimetype,
      duration,
      width,
      height,
      auto_send: this.normalizeBooleanValue(input.auto_send?.value) ?? false,
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
