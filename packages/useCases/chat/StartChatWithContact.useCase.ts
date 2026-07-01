import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { IChat } from '@core/common/interfaces/IChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { StartChatWithContactRequest } from '@core/schema/chat/startChatWithContact/request.schema';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ContactService } from '@core/services/contact.service';
import { SectorService } from '@core/services/sector.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EncryptService } from '@core/services/encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import {
  IContactData,
  IRequiredData,
} from '@core/common/interfaces/IStartChatData';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import {
  createChatbotFlowCacheKey,
  createChatbotInactivityCacheKey,
  createChatbotFailedAttemptsCacheKey,
} from '@core/common/functions/createCacheKey';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { withLock } from '@core/common/functions/withLock';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import type { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { MetaWhatsappEmbeddedService } from '@core/services/metaWhatsappEmbedded.service';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  IOfficialWhatsappTemplate,
  IOfficialWhatsappTemplateMessage,
} from '@core/common/interfaces/IOfficialWhatsappTemplate';

type StartChatWithContactExistingInChatBehavior =
  'error' | 'reuse_and_takeover';

type StartChatWithContactExecuteOptions = {
  onExistingInChat?: StartChatWithContactExistingInChatBehavior;
};

@injectable()
export class StartChatWithContactUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PhoneValidationService)
    private readonly phoneValidationService: PhoneValidationService,
    @inject(ChatUserViewerRepository)
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject(AttendanceInactivityService)
    private readonly attendanceInactivityService: AttendanceInactivityService,
    @inject(PushNotificationService)
    _pushNotificationService: PushNotificationService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    body: StartChatWithContactRequest,
    userChannels: { id: string; name: string }[] = [],
    options: StartChatWithContactExecuteOptions = {}
  ): Promise<IChat> {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!body.worker_id || !channelIds.includes(body.worker_id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const contactData = await this.validateAndGetContactData(
      t,
      body.contact_id,
      accountId
    );

    const requiredData = await this.fetchRequiredData(
      t,
      accountId,
      userId,
      body.worker_id,
      body.sector_id
    );
    const workerType = await this.workerService.viewWorkerType(
      accountId,
      body.worker_id
    );
    const isOfficialWorker =
      workerType?.worker_type_id === EWorkerType.whatsapp;
    requiredData.worker = {
      ...requiredData.worker,
      type_id: workerType?.worker_type_id ?? null,
      is_official: isOfficialWorker,
    };

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(body.worker_id);

    if (workerConfigFields?.allow_attendance_only_online) {
      const userStatus =
        await this.chatUserViewerRepository.findStatusByUserId(userId);

      if (userStatus !== EChatUserStatus.online) {
        throw new Error(t('attendance_only_online_allowed'));
      }
    }

    const officialTemplate = isOfficialWorker
      ? await this.resolveOfficialTemplate(t, body.worker_id, body)
      : null;

    const remoteJid = this.resolveContactRemoteJid(contactData);
    const lockKey = buildChatIdentityLockKey(
      accountId,
      requiredData.worker.id,
      {
        phone: contactData.fullPhone,
        remoteJid,
      }
    );

    const chat = await withLock(
      this.redis,
      lockKey,
      async () => {
        const existingChat = await this.chatService.findOpenChatByIdentity(
          accountId,
          requiredData.worker.id,
          {
            phone: contactData.fullPhone,
            remoteJid,
          }
        );

        if (existingChat) {
          if (existingChat.status === EChatStatus.in_chat) {
            if (options.onExistingInChat === 'reuse_and_takeover') {
              return this.updateExistingChat(
                t,
                existingChat,
                contactData,
                requiredData
              );
            }

            const sectorName = existingChat.sector?.name;
            if (sectorName) {
              throw new Error(
                t('chat_already_in_service_with_sector', {
                  sector: sectorName,
                })
              );
            }

            throw new Error(t('chat_already_in_service'));
          }

          if (
            existingChat.status === EChatStatus.queue ||
            existingChat.status === EChatStatus.ura ||
            existingChat.status === EChatStatus.ura_output ||
            existingChat.status === EChatStatus.ura_schedule ||
            existingChat.status === EChatStatus.ura_webhook
          ) {
            return this.updateExistingChat(
              t,
              existingChat,
              contactData,
              requiredData
            );
          }
        }

        return this.createNewChat(t, contactData, requiredData);
      },
      { ttlMs: 30_000, retryMs: 100, maxWaitMs: 30_000 }
    );

    if (isOfficialWorker && officialTemplate) {
      await this.publishOfficialOpeningTemplate(chat, officialTemplate);
    }

    return chat;
  }

  private async resolveOfficialTemplate(
    t: TFunction<'translation', undefined>,
    workerId: string,
    body: StartChatWithContactRequest
  ): Promise<IOfficialWhatsappTemplateMessage> {
    if (!body.official_template) {
      throw new Error(t('official_template_required_for_opening'));
    }

    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      throw new Error(t('official_opening_connection_not_found'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const approvedTemplates =
      await this.metaWhatsappEmbeddedService.listApprovedMessageTemplates({
        apiVersion: connection.api_version,
        accessToken,
        wabaId: connection.waba_id,
      });
    const templates =
      this.officialWhatsappTemplateService.normalizeTemplates(
        approvedTemplates
      );
    const template = this.officialWhatsappTemplateService.findTemplate(
      templates,
      body.official_template
    );

    if (!template) {
      throw new Error(t('official_template_not_approved_or_not_found'));
    }

    let variables: IOfficialWhatsappTemplateMessage['variables'];
    try {
      variables = this.officialWhatsappTemplateService.validateVariableValues({
        template,
        values: body.official_template.variables,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'official_template_variables_required'
      ) {
        throw new Error(t('official_template_variables_required'));
      }

      throw error;
    }

    return this.buildOfficialTemplateMessage(template, variables);
  }

  private buildOfficialTemplateMessage(
    template: IOfficialWhatsappTemplate,
    variables: IOfficialWhatsappTemplateMessage['variables']
  ): IOfficialWhatsappTemplateMessage {
    return {
      name: template.name,
      language: template.language,
      status: template.status,
      category: template.category,
      components: template.components,
      variables,
      preview: template.preview,
    };
  }

  private async publishOfficialOpeningTemplate(
    chat: IChat,
    template: IOfficialWhatsappTemplateMessage
  ): Promise<void> {
    const messageText = this.officialWhatsappTemplateService.buildPreviewText(
      {
        id: null,
        name: template.name,
        language: template.language,
        status: 'APPROVED',
        category: template.category ?? null,
        components: template.components ?? [],
        variables:
          template.components?.flatMap((component) => [
            ...(component.variables ?? []),
            ...(component.buttons?.flatMap(
              (button) => button.variables ?? []
            ) ?? []),
          ]) ?? [],
        preview: template.preview ?? {},
      },
      template.variables
    );

    await this.chatMessageService.publishPreparedMessage({
      message_id: uuidv7(),
      chat_id: chat.chat_id,
      message_key: {
        remote_jid: chat.message_key?.remote_jid ?? null,
        remote_jid_alt: chat.message_key?.remote_jid_alt ?? null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user ?? null,
      phone: chat.phone,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      content: {
        type: EMessageType.official_template,
        message: messageText,
        official_template: template,
      },
      date: new Date().toISOString(),
    });
  }

  private resolveValidationRemoteJid(
    validationResult: Pick<IPhoneValidationResponse, 'jid' | 'phone'>
  ): string | null {
    const candidates = [validationResult.jid, validationResult.phone];

    for (const candidate of candidates) {
      const raw = candidate?.trim();
      if (!raw || !raw.includes('@') || raw.endsWith('@lid')) {
        continue;
      }

      return normalizeJid(raw) ?? raw;
    }

    return null;
  }

  private resolveContactRemoteJid(contactData: IContactData): string | null {
    return (
      contactData.remoteJid ??
      normalizePhoneToJid(
        contactData.sensitiveData?.phone || null,
        contactData.contact.phone_ddi || null
      ) ??
      null
    );
  }

  private async validateAndGetContactData(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<IContactData> {
    const contact = await this.contactService.viewContactById(
      contactId,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData?.phone) {
      throw new Error(t('contact_phone_required'));
    }

    const fallbackPhoneDdi = contact.phone_ddi ?? null;
    const phoneDdiToValidate = fallbackPhoneDdi ?? '55';

    let validationResult: Pick<
      IPhoneValidationResponse,
      'valid' | 'phone' | 'jid'
    >;
    try {
      validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        sensitiveData.phone,
        phoneDdiToValidate,
        undefined,
        { bypassCache: true }
      );
    } catch (error) {
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();

        if (this.isInvalidValidationError(errorMessage)) {
          await this.contactService.updateContactIsValided(contactId, false);
          throw new Error(t('phone_number_not_valid_on_whatsapp'));
        }

        if (this.isTechnicalValidationError(errorMessage)) {
          const canUseFallback =
            contact.is_valided === true &&
            !!fallbackPhoneDdi &&
            !!sensitiveData.phone;

          if (canUseFallback) {
            return this.buildContactData(
              contact,
              sensitiveData.phone,
              fallbackPhoneDdi,
              sensitiveData.email,
              null
            );
          }

          throw new Error(t('contact_must_be_validated'));
        }
      }

      throw error;
    }

    if (!validationResult.valid) {
      await this.contactService.updateContactIsValided(contactId, false);
      throw new Error(t('phone_number_not_valid_on_whatsapp'));
    }

    if (validationResult.phone?.endsWith('@lid')) {
      if (
        contact.is_valided === true &&
        fallbackPhoneDdi &&
        sensitiveData.phone
      ) {
        return this.buildContactData(
          contact,
          sensitiveData.phone,
          fallbackPhoneDdi,
          sensitiveData.email,
          null
        );
      }
      await this.contactService.updateContactIsValided(contactId, false);
      throw new Error(t('phone_number_not_valid_on_whatsapp'));
    }

    const remoteJid = this.resolveValidationRemoteJid(validationResult);
    let normalizedPhone = sensitiveData.phone;
    let normalizedPhoneDdi = phoneDdiToValidate;

    if (validationResult.phone) {
      const extracted = extractPhoneAndDdi(validationResult.phone);
      if (extracted) {
        normalizedPhone = extracted.phone;
        normalizedPhoneDdi = extracted.phone_ddi;
      }
    }

    const shouldUpdateContact =
      contact.is_valided !== true ||
      normalizedPhone !== sensitiveData.phone ||
      normalizedPhoneDdi !== (contact.phone_ddi ?? '');

    if (shouldUpdateContact) {
      const updated = await this.contactService.validateContact(
        contact.contact_id,
        normalizedPhone,
        normalizedPhoneDdi
      );

      if (!updated) {
        throw new Error(t('contact_must_be_validated'));
      }
    }

    return this.buildContactData(
      contact,
      normalizedPhone,
      normalizedPhoneDdi,
      sensitiveData.email,
      remoteJid
    );
  }

  private isTechnicalValidationError(errorMessage: string): boolean {
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('deadline exceeded') ||
      errorMessage.includes('no active worker') ||
      errorMessage.includes('unavailable') ||
      errorMessage.includes('disconnected') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('not connected')
    );
  }

  private isInvalidValidationError(errorMessage: string): boolean {
    return (
      errorMessage.includes('phone_number_not_valid_on_whatsapp') ||
      errorMessage.includes('phone number is not valid on whatsapp')
    );
  }

  private buildContactData(
    contact: IContactData['contact'],
    phone: string,
    phoneDdi: string,
    email?: string | null,
    remoteJid?: string | null
  ): IContactData {
    const contactName = contact.name ?? contact.last_name ?? '';
    const phonePartial =
      this.encryptService.sanitize(phone, ETypeSanetize.phone) ?? '';
    const fullPhone = `${phoneDdi}${phone}`;

    return {
      contact: {
        ...contact,
        phone_ddi: phoneDdi,
        is_valided: true,
      },
      sensitiveData: {
        phone,
        email: email ?? null,
      },
      contactName,
      phonePartial,
      fullPhone,
      remoteJid: remoteJid ?? null,
    };
  }

  private async fetchRequiredData(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    workerId: string,
    sectorId: string | undefined
  ): Promise<IRequiredData> {
    const [user, account, worker] = await Promise.all([
      this.userService.viewUserNamePhoto(userId),
      this.accountService.viewAccountName(accountId),
      this.workerService.viewWorkerNameAndId(accountId, workerId),
    ]);

    if (!user || !account || !worker) {
      throw new Error(t('chat_create_not_found'));
    }

    let sector: { id: string; name: string; color?: string } | null = null;
    if (sectorId) {
      const sectorData = await this.sectorService.viewSectorById(
        sectorId,
        accountId
      );

      if (sectorData) {
        sector = {
          id: sectorData.sector_id,
          name: sectorData.name,
          color: sectorData.color,
        };
      }
    }

    return { user, account, worker, sector };
  }

  private async validateSimultaneousAttendanceLimit(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<void> {
    const simultaneousAttendanceLimit =
      await this.workerConfigService.viewSimultaneousAttendance(workerId);
    const simultaneousAttendanceLimitInt = Number(simultaneousAttendanceLimit);

    if (simultaneousAttendanceLimitInt > 0) {
      const currentInChatCount =
        await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          userId
        );

      if (currentInChatCount >= simultaneousAttendanceLimitInt) {
        throw new Error(
          t('simultaneous_attendance_limit_reached', {
            limit: simultaneousAttendanceLimit,
          })
        );
      }
    }
  }

  private async updateExistingChat(
    t: TFunction<'translation', undefined>,
    existingChat: IChat,
    contactData: IContactData,
    requiredData: IRequiredData
  ): Promise<IChat> {
    const currentDate = new Date().toISOString();
    const userData = requiredData.user;

    if (userData) {
      await this.validateSimultaneousAttendanceLimit(
        t,
        requiredData.account.id,
        requiredData.worker.id,
        userData.id
      );
    }

    const wasUraStatus =
      existingChat.status === EChatStatus.ura ||
      existingChat.status === EChatStatus.ura_output ||
      existingChat.status === EChatStatus.ura_schedule ||
      existingChat.status === EChatStatus.ura_webhook;

    const updatedChat = this.buildUpdatedChat(
      existingChat,
      contactData,
      requiredData,
      currentDate
    );

    const updated = await this.chatService.updateChatStatus(
      existingChat.chat_id,
      EChatStatus.in_chat,
      userData
        ? {
            id: userData.id,
            name: userData.name,
            photo: userData.photo,
            entered_at: currentDate,
          }
        : null,
      existingChat.started_at || currentDate,
      null
    );

    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    const saved = await this.chatService.saveChat(updatedChat, {
      refresh: true,
    });
    if (!saved) {
      throw new Error(t('chat_update_failed'));
    }

    if (existingChat.status !== EChatStatus.in_chat) {
      await this.attendanceInactivityService.startTrackingOnInChatEntry(
        updatedChat
      );
    }

    if (wasUraStatus) {
      await this.invalidateChatbotFlow(updatedChat);
    }

    await this.publishChatUpdate(updatedChat);

    return updatedChat;
  }

  private async invalidateChatbotFlow(chat: IChat): Promise<void> {
    const accountId = chat.account?.id;
    const workerId = chat.worker?.id;
    const chatId = chat.chat_id;

    if (!accountId || !workerId || !chatId) {
      return;
    }

    const chatbotFlowCacheKey = createChatbotFlowCacheKey(
      accountId,
      workerId,
      chatId
    );
    const inactivityCacheKey = createChatbotInactivityCacheKey(
      accountId,
      workerId,
      chatId
    );
    const inactivityScheduleKey = 'underchat:chatbot-inactivity-schedule';
    const failedAttemptsCacheKey = createChatbotFailedAttemptsCacheKey(
      accountId,
      workerId,
      chatId
    );

    await Promise.all([
      this.redis.del(chatbotFlowCacheKey),
      this.redis.del(inactivityCacheKey),
      this.redis.zrem(inactivityScheduleKey, inactivityCacheKey),
      this.redis.del(failedAttemptsCacheKey),
      this.chatService.invalidateChatCache(chat),
    ]);
  }

  private buildUpdatedChat(
    existingChat: IChat,
    contactData: IContactData,
    requiredData: IRequiredData,
    currentDate: string
  ): IChat {
    const userData = requiredData.user;
    const remoteJid = this.resolveContactRemoteJid(contactData);

    return {
      ...existingChat,
      message_key: existingChat.message_key || {
        remote_jid: remoteJid || null,
        remote_jid_alt: null,
      },
      status: EChatStatus.in_chat,
      worker: {
        id: requiredData.worker.id,
        name: requiredData.worker.name,
        type_id: requiredData.worker.type_id ?? null,
        is_official: requiredData.worker.is_official ?? null,
      },
      sector: requiredData.sector || existingChat.sector,
      user: userData
        ? {
            id: userData.id,
            name: userData.name,
            photo: userData.photo,
            entered_at: currentDate,
          }
        : existingChat.user,
      contact: {
        id: contactData.contact.contact_id,
        name: contactData.contactName,
        phone: contactData.phonePartial,
        phone_ddi: contactData.contact.phone_ddi,
        photo: contactData.contact.photo,
        responsible_attendant: contactData.contact.user
          ? {
              id: contactData.contact.user.user_id,
              name: contactData.contact.user.name ?? '',
              photo: contactData.contact.user.photo ?? null,
            }
          : null,
        ignore: contactData.contact.ignore ?? 'not_ignore',
      },
      name: contactData.contactName,
      phone: contactData.fullPhone,
      photo: contactData.contact.photo,
      started_at: existingChat.started_at || currentDate,
      forward_to_output_chatbot: true,
    };
  }

  private async createNewChat(
    t: TFunction<'translation', undefined>,
    contactData: IContactData,
    requiredData: IRequiredData
  ): Promise<IChat> {
    const userData = requiredData.user;

    if (userData) {
      await this.validateSimultaneousAttendanceLimit(
        t,
        requiredData.account.id,
        requiredData.worker.id,
        userData.id
      );
    }

    const currentDate = new Date().toISOString();
    const remoteJid = this.resolveContactRemoteJid(contactData);

    const newChat: IChat = {
      chat_id: uuidv7(),
      message_key: {
        remote_jid: remoteJid || null,
        remote_jid_alt: null,
      },
      account: {
        id: requiredData.account.id,
        name: requiredData.account.name,
      },
      worker: {
        id: requiredData.worker.id,
        name: requiredData.worker.name,
        type_id: requiredData.worker.type_id ?? null,
        is_official: requiredData.worker.is_official ?? null,
      },
      sector: requiredData.sector,
      user: requiredData.user
        ? {
            ...requiredData.user,
            entered_at: currentDate,
          }
        : null,
      contact: {
        id: contactData.contact.contact_id,
        name: contactData.contactName,
        phone: contactData.phonePartial,
        phone_ddi: contactData.contact.phone_ddi,
        photo: contactData.contact.photo,
        responsible_attendant: contactData.contact.user
          ? {
              id: contactData.contact.user.user_id,
              name: contactData.contact.user.name ?? '',
              photo: contactData.contact.user.photo ?? null,
            }
          : null,
        ignore: contactData.contact.ignore ?? 'not_ignore',
      },
      name: contactData.contactName,
      phone: contactData.fullPhone,
      photo: contactData.contact.photo,
      status: EChatStatus.in_chat,
      date: currentDate,
      started_at: currentDate,
      forward_to_output_chatbot: true,
    };

    const chatWithProtocol =
      await this.chatService.ensureProtocolForNewChat(newChat);

    const result = await this.chatService.saveChat(chatWithProtocol, {
      refresh: true,
    });
    if (!result) {
      throw new Error('chat_create_error');
    }

    await this.attendanceInactivityService.startTrackingOnInChatEntry(
      chatWithProtocol
    );

    await this.publishChatUpdate(chatWithProtocol);

    return chatWithProtocol;
  }

  private async publishChatUpdate(chat: IChat): Promise<void> {
    const channelAccountId = chat.account.id;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        chat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        chat
      ),
    ]);
  }
}
