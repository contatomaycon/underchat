import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ScheduleService } from '@core/services/schedule.service';
import { UpdateScheduleRequest } from '@core/schema/schedule/editSchedule/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { ConverterService } from '@core/services/converter';
import { UploadFileResponse } from '@core/schema/upload/response.schema';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { WorkerService } from '@core/services/worker.service';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import { IUpdateSchedule } from '@core/interfaces/repositories/schedule/IUpdateSchedule';
import moment from 'moment-timezone';
import { extractArrayField } from '@core/common/functions/extractArrayField';
import { formatDateToISO } from '@core/common/functions/formatDateToISO';
import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { ScheduleOfficialMessageService } from '@core/services/scheduleOfficialMessage.service';

@injectable()
export class ScheduleUpdaterUseCase {
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

  constructor(
    @inject(ScheduleService)
    private readonly scheduleService: ScheduleService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(StorageService)
    private readonly storageService: StorageService,
    @inject(ConverterService)
    private readonly converterService: ConverterService,
    @inject(ScheduleOfficialMessageService)
    private readonly scheduleOfficialMessageService: ScheduleOfficialMessageService
  ) {}

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

  private extractStringValue(
    field: string | { value: string | null } | null | undefined
  ): string | null | undefined {
    if (field === undefined || field === null) return undefined;
    if (typeof field === 'string') return field;
    return field.value ?? undefined;
  }

  private extractMessageValue(
    message: string | { value: string | null } | null | undefined
  ): string | null | undefined {
    if (typeof message === 'string') return message;
    return message?.value ?? undefined;
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
    sendToValue: string | null | undefined,
    contactIds: string[],
    contactGroupIds: string[],
    t: TFunction<'translation', undefined>
  ): void {
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

  private resolveSendSpeed(
    value: string | null | undefined
  ): EScheduleSendSpeed | undefined {
    if (!value) return undefined;
    if (
      Object.values(EScheduleSendSpeed).includes(value as EScheduleSendSpeed)
    ) {
      return value as EScheduleSendSpeed;
    }
    return undefined;
  }

  private buildUpdateScheduleInput(
    scheduleBasic: {
      scheduleId: string;
      workerId: string | null | undefined;
      sendDate: string | null | undefined;
    },
    type: string | null | undefined,
    sendToValue: string | null | undefined,
    sendSpeedValue: EScheduleSendSpeed | undefined,
    chatbotIdValue: string | null | undefined,
    messageValue: string | null | undefined,
    officialTemplate: IOfficialWhatsappTemplateMessage | null,
    attachment:
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
  ): IUpdateSchedule {
    const sendDateISO = scheduleBasic.sendDate
      ? formatDateToISO(scheduleBasic.sendDate, 'YYYY-MM-DD HH:mm')
      : undefined;

    const isChatbot = type === EScheduleType.chatbot;
    const isOfficialTemplate = type === EScheduleType.official_template;

    return {
      schedule_id: scheduleBasic.scheduleId,
      worker_id: scheduleBasic.workerId ?? undefined,
      type: type ?? undefined,
      send_to: sendToValue ?? undefined,
      send_speed: sendSpeedValue ?? undefined,
      chatbot_id: isChatbot ? (chatbotIdValue ?? undefined) : null,
      message:
        isChatbot || isOfficialTemplate ? null : (messageValue ?? undefined),
      url:
        isChatbot || isOfficialTemplate ? null : (attachment?.url ?? undefined),
      mimetype:
        isChatbot || isOfficialTemplate
          ? null
          : (attachment?.mimetype ?? undefined),
      duration:
        isChatbot || isOfficialTemplate
          ? null
          : (attachment?.duration ?? undefined),
      width:
        isChatbot || isOfficialTemplate
          ? null
          : (attachment?.width ?? undefined),
      height:
        isChatbot || isOfficialTemplate
          ? null
          : (attachment?.height ?? undefined),
      official_template: isOfficialTemplate ? officialTemplate : null,
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
    scheduleId: string,
    body: UpdateScheduleRequest,
    accountId: string
  ): Promise<boolean> {
    await this.ensureScheduleExists(t, scheduleId);
    await this.ensureWorkerIsValid(t, body, accountId);
    const currentSchedule =
      await this.scheduleService.viewScheduleById(scheduleId);
    if (!currentSchedule) {
      throw new Error(t('schedule_not_found'));
    }

    const sendDate = this.extractStringValue(body.send_date);
    if (sendDate) {
      this.validateSendDate(sendDate, t);
    }

    const attachment = await this.processAttachmentIfPresent(
      t,
      body,
      accountId
    );

    const contactIds = this.extractContactIds(body.contact_ids);
    const contactGroupIds = this.extractContactGroupIds(body.contact_group_ids);
    const sendToValue = this.extractStringValue(body.send_to);
    const sendSpeedValue = this.resolveSendSpeed(
      this.extractStringValue(body.send_speed)
    );
    const typeValue =
      this.extractStringValue(body.type) ?? currentSchedule.type ?? null;
    let chatbotIdValue = this.extractStringValue(body.chatbot_id);
    if (chatbotIdValue === '') chatbotIdValue = null;
    const effectiveChatbotIdValue =
      chatbotIdValue === undefined
        ? currentSchedule.chatbot_id
        : chatbotIdValue;
    const messageValue = this.extractMessageValue(body.message);
    const workerIdValue =
      this.extractStringValue(body.worker_id) ??
      currentSchedule.worker.worker_id;
    const officialTemplateInput = this.extractOfficialTemplateValue(
      body.official_template as unknown
    );

    this.validateRequiredFields(sendToValue, contactIds, contactGroupIds, t);

    const isOfficialWorker =
      await this.scheduleOfficialMessageService.isOfficialWorker(
        t,
        accountId,
        workerIdValue
      );
    let officialTemplate: IOfficialWhatsappTemplateMessage | null = null;

    if (
      isOfficialWorker &&
      typeValue !== EScheduleType.official_template &&
      typeValue !== EScheduleType.chatbot
    ) {
      throw new Error(t('schedule_official_type_invalid'));
    }

    if (!isOfficialWorker && typeValue === EScheduleType.official_template) {
      throw new Error(t('schedule_official_template_not_allowed'));
    }

    if (typeValue === EScheduleType.official_template) {
      officialTemplate =
        await this.scheduleOfficialMessageService.validateTemplateForSchedule({
          t,
          accountId,
          workerId: workerIdValue,
          officialTemplate:
            officialTemplateInput ?? currentSchedule.official_template ?? null,
        });
    }

    if (typeValue === 'chatbot' && !effectiveChatbotIdValue) {
      throw new Error(t('schedule_chatbot_required'));
    }

    if (effectiveChatbotIdValue) {
      const exists = await this.scheduleService.existsChatbotInAccount(
        effectiveChatbotIdValue,
        accountId
      );
      if (!exists) {
        throw new Error(t('schedule_chatbot_not_found'));
      }

      if (isOfficialWorker && typeValue === EScheduleType.chatbot) {
        await this.scheduleOfficialMessageService.assertOfficialScheduleChatbotStart(
          {
            t,
            accountId,
            chatbotId: effectiveChatbotIdValue,
          }
        );
      }
    }

    const updateBody = this.buildUpdateScheduleInput(
      {
        scheduleId,
        workerId: workerIdValue,
        sendDate,
      },
      typeValue,
      sendToValue,
      isOfficialWorker ? EScheduleSendSpeed.low : sendSpeedValue,
      effectiveChatbotIdValue,
      messageValue,
      officialTemplate,
      attachment,
      {
        contactIds,
        contactGroupIds,
      }
    );

    const scheduleUpdater = await this.scheduleService.updateScheduleById(
      scheduleId,
      updateBody
    );

    if (!scheduleUpdater) {
      throw new Error(t('schedule_update_error'));
    }

    return scheduleUpdater;
  }

  private extractOfficialTemplateValue(
    field: unknown
  ): IOfficialWhatsappTemplateMessage | null {
    const raw =
      field &&
      typeof field === 'object' &&
      'value' in field &&
      !Array.isArray(field)
        ? (field as { value?: unknown }).value
        : field;

    if (!raw) {
      return null;
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }

      try {
        return JSON.parse(trimmed) as IOfficialWhatsappTemplateMessage;
      } catch {
        return null;
      }
    }

    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as IOfficialWhatsappTemplateMessage;
    }

    return null;
  }

  private async ensureScheduleExists(
    t: TFunction<'translation', undefined>,
    scheduleId: string
  ): Promise<void> {
    const scheduleExists =
      await this.scheduleService.existsScheduleById(scheduleId);

    if (!scheduleExists) {
      throw new Error(t('schedule_not_found'));
    }
  }

  private async ensureWorkerIsValid(
    t: TFunction<'translation', undefined>,
    body: UpdateScheduleRequest,
    accountId: string
  ): Promise<void> {
    const workerId = this.extractStringValue(body.worker_id);
    if (!workerId) return;

    const workerExists = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!workerExists) {
      throw new Error(t('worker_not_found'));
    }
  }

  private validateSendDate(
    sendDate: string | null | undefined,
    t: TFunction<'translation', undefined>
  ): void {
    if (!sendDate) return;

    const date = moment.tz(sendDate, 'YYYY-MM-DD HH:mm', true, APP_TIMEZONE);

    if (!date.isValid()) {
      throw new Error(t('send_date_invalid_format'));
    }

    const now = moment.tz(APP_TIMEZONE);

    if (date.isBefore(now)) {
      throw new Error(t('send_date_must_be_future'));
    }
  }

  private async processAttachmentIfPresent(
    t: TFunction<'translation', undefined>,
    body: UpdateScheduleRequest,
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
    const typeValue = this.extractStringValue(body.type);
    if (
      typeValue === EScheduleType.chatbot ||
      typeValue === EScheduleType.official_template
    ) {
      return null;
    }

    const file = body.url;
    if (!file?.filename) return null;

    await this.validateAttachment(file, t);
    const messageType = (typeValue || 'text') as EScheduleType;

    if (messageType === EScheduleType.image) {
      return this.uploadImageAttachment(file, accountId);
    }

    if (messageType === EScheduleType.video) {
      return this.uploadVideoAttachment(file, accountId);
    }

    if (messageType === EScheduleType.audio) {
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
}
