import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateScheduleRequest } from '@core/schema/schedule/createSchedule/request.schema';
import { ScheduleService } from '@core/services/schedule.service';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { WorkerService } from '@core/services/worker.service';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import moment from 'moment-timezone';
import { extractArrayField } from '@core/common/functions/extractArrayField';
import { formatDateToISO } from '@core/common/functions/formatDateToISO';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

@injectable()
export class ScheduleCreatorUseCase {
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
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService
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

  private async validateWorkerExists(
    workerId: string,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    if (!workerId) {
      throw new Error(t('worker_id_required'));
    }

    const workerExists = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!workerExists) {
      throw new Error(t('worker_not_found'));
    }
  }

  private validateSendDate(
    sendDate: string,
    t: TFunction<'translation', undefined>
  ): void {
    if (!sendDate) {
      throw new Error(t('send_date_required'));
    }

    const date = moment.tz(sendDate, 'YYYY-MM-DD HH:mm', true, APP_TIMEZONE);

    if (!date.isValid()) {
      throw new Error(t('send_date_invalid_format'));
    }

    const now = moment.tz(APP_TIMEZONE);

    if (date.isBefore(now)) {
      throw new Error(t('send_date_must_be_future'));
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

  private inferMessageTypeFromFile(filename: string): EScheduleType | null {
    const ext = this.getFileExtension(filename);

    if (this.IMAGE_EXTENSIONS.includes(ext)) {
      return EScheduleType.image;
    }

    if (this.VIDEO_EXTENSIONS.includes(ext)) {
      return EScheduleType.video;
    }

    if (this.AUDIO_EXTENSIONS.includes(ext)) {
      return EScheduleType.audio;
    }

    return null;
  }

  private resolveMessageType(
    inputType: string | undefined,
    attachmentFilename?: string
  ): EScheduleType {
    if (
      inputType &&
      Object.values(EScheduleType).includes(inputType as EScheduleType)
    ) {
      return inputType as EScheduleType;
    }

    if (!attachmentFilename) {
      return EScheduleType.text;
    }

    const inferredType = this.inferMessageTypeFromFile(attachmentFilename);

    if (inferredType) {
      return inferredType;
    }

    return EScheduleType.text;
  }

  private async uploadAttachmentByType(
    file: UploadFileRequest,
    messageType: EScheduleType,
    accountId: string
  ): Promise<
    UploadFileResponse & {
      mimetype?: string | null;
      duration?: number | null;
      width?: number | null;
      height?: number | null;
    }
  > {
    if (messageType === EScheduleType.image) {
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

    if (messageType === EScheduleType.video) {
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

    if (messageType === EScheduleType.audio) {
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

    throw new Error('Invalid message type for attachment upload');
  }

  private extractStringValue(
    field: string | { value: string | null } | null | undefined
  ): string | null {
    if (!field) return null;
    if (typeof field === 'string') return field;
    return field.value ?? null;
  }

  private extractMessageValue(
    message: string | { value: string | null } | null | undefined
  ): string | null {
    if (typeof message === 'string') return message;
    return message?.value ?? null;
  }

  private extractContactIds(
    contactIds: { value: string | string[] } | undefined
  ): string[] {
    return extractArrayField(contactIds);
  }

  private extractContactGroupIds(
    contactGroupIds: { value: string | string[] } | undefined
  ): string[] {
    return extractArrayField(contactGroupIds);
  }

  private validateRequiredFields(
    workerId: string | null,
    sendDate: string | null,
    sendToValue: string | null,
    contactIds: string[],
    contactGroupIds: string[],
    t: TFunction<'translation', undefined>
  ): void {
    if (!workerId) {
      throw new Error(t('worker_id_required'));
    }

    if (!sendDate) {
      throw new Error(t('send_date_required'));
    }

    if (sendToValue === EScheduleSendTo.contacts && contactIds.length === 0) {
      throw new Error(t('schedule_contacts_required'));
    }

    if (
      sendToValue === EScheduleSendTo.contact_groups &&
      contactGroupIds.length === 0
    ) {
      throw new Error(t('schedule_contact_groups_required'));
    }
  }

  private async processAttachment(
    url: UploadFileRequest | null | undefined,
    messageType: EScheduleType,
    accountId: string,
    t: TFunction<'translation', undefined>
  ): Promise<
    | (UploadFileResponse & {
        mimetype?: string | null;
        duration?: number | null;
        width?: number | null;
        height?: number | null;
      })
    | null
  > {
    if (messageType === EScheduleType.chatbot) return null;
    if (!url?.filename) return null;

    await this.validateAttachment(url, t);

    return this.uploadAttachmentByType(url, messageType, accountId);
  }

  private resolveSendSpeed(
    value: string | null | undefined
  ): EScheduleSendSpeed {
    if (
      value &&
      Object.values(EScheduleSendSpeed).includes(value as EScheduleSendSpeed)
    ) {
      return value as EScheduleSendSpeed;
    }
    return EScheduleSendSpeed.low;
  }

  private buildCreateScheduleInput(
    scheduleBasic: {
      accountId: string;
      workerId: string;
      sendDate: string;
    },
    messageType: EScheduleType,
    sendToValue: string,
    sendSpeedValue: EScheduleSendSpeed,
    chatbotIdValue: string | null,
    messageValue: string | null,
    attachmentUrl:
      | (UploadFileResponse & {
          mimetype?: string | null;
          duration?: number | null;
          width?: number | null;
          height?: number | null;
        })
      | null,
    recipients: {
      contactIds: string[];
      contactGroupIds: string[];
    }
  ) {
    const sendDateISO = formatDateToISO(
      scheduleBasic.sendDate,
      'YYYY-MM-DD HH:mm'
    );

    const isChatbot = !!chatbotIdValue;

    return {
      account_id: scheduleBasic.accountId,
      worker_id: scheduleBasic.workerId,
      type: messageType,
      send_to: sendToValue,
      send_speed: sendSpeedValue,
      chatbot_id: chatbotIdValue ?? undefined,
      message: isChatbot ? null : messageValue,
      url: isChatbot ? null : attachmentUrl ? attachmentUrl.url : null,
      mimetype: isChatbot ? null : (attachmentUrl?.mimetype ?? null),
      duration: isChatbot ? null : (attachmentUrl?.duration ?? null),
      width: isChatbot ? null : (attachmentUrl?.width ?? null),
      height: isChatbot ? null : (attachmentUrl?.height ?? null),
      send_date: sendDateISO,
      contact_ids:
        recipients.contactIds.length > 0 ? recipients.contactIds : undefined,
      contact_group_ids:
        recipients.contactGroupIds.length > 0
          ? recipients.contactGroupIds
          : undefined,
    };
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateScheduleRequest,
    accountId: string
  ): Promise<boolean> {
    await this.validateAccountExists(accountId, t);

    const workerId = this.extractStringValue(input.worker_id);
    const sendDate = this.extractStringValue(input.send_date);
    const typeValue = this.extractStringValue(input.type);
    const sendToValue = this.extractStringValue(input.send_to);
    const sendSpeedValue = this.resolveSendSpeed(
      this.extractStringValue(input.send_speed)
    );
    const chatbotIdValue = this.extractStringValue(input.chatbot_id);
    const messageValue = this.extractMessageValue(input.message);
    const contactIds = this.extractContactIds(input.contact_ids);
    const contactGroupIds = this.extractContactGroupIds(
      input.contact_group_ids
    );

    this.validateRequiredFields(
      workerId,
      sendDate,
      sendToValue,
      contactIds,
      contactGroupIds,
      t
    );

    if (!workerId || !sendDate) {
      return false;
    }

    await this.validateWorkerExists(workerId, accountId, t);
    this.validateSendDate(sendDate, t);

    const messageType = this.resolveMessageType(
      typeValue ?? undefined,
      input.url?.filename
    );

    if (messageType === EScheduleType.chatbot) {
      if (!chatbotIdValue) {
        throw new Error(t('schedule_chatbot_required'));
      }
      const exists = await this.scheduleService.existsChatbotInAccount(
        chatbotIdValue,
        accountId
      );
      if (!exists) {
        throw new Error(t('schedule_chatbot_not_found'));
      }
    }

    const attachmentUrl = await this.processAttachment(
      input.url,
      messageType,
      accountId,
      t
    );

    const createScheduleInput = this.buildCreateScheduleInput(
      {
        accountId,
        workerId,
        sendDate,
      },
      messageType,
      sendToValue ?? '',
      sendSpeedValue,
      chatbotIdValue,
      messageValue,
      attachmentUrl,
      {
        contactIds,
        contactGroupIds,
      }
    );

    const createSchedule =
      await this.scheduleService.createSchedule(createScheduleInput);

    if (!createSchedule) {
      throw new Error(t('schedule_creation_failed'));
    }

    return true;
  }
}
