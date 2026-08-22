import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { IChat } from '@core/common/interfaces/IChat';
import { resolveChatLifecycleEventTypes } from '@core/common/constants/outboundWebhookEvents';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  OfficialTemplateMessageRequest,
  StartChatWithContactRequest,
} from '@core/schema/chat/startChatWithContact/request.schema';
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
  createChatbotOfficialResponsePendingCacheKey,
} from '@core/common/functions/createCacheKey';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { withLock } from '@core/common/functions/withLock';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { buildOfficialWhatsappDisplayFromTemplate } from '@core/common/functions/officialWhatsappDisplay';
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
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { ContactPhoneValidationPolicyService } from '@core/services/contactPhoneValidationPolicy.service';
import { CONTACT_VALIDATION_ORIGINS } from '@core/common/types/ContactValidationOrigin';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';

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
    @inject('Redis') private readonly redis: Redis,
    @inject(OfficialWhatsappConversationWindowService)
    private readonly officialWindowService: OfficialWhatsappConversationWindowService = {
      recordTemplateSentForChat: async (chat: IChat) => chat,
    } as unknown as OfficialWhatsappConversationWindowService,
    @inject(ContactPhoneValidationPolicyService)
    private readonly contactPhoneValidationPolicyService: Pick<
      ContactPhoneValidationPolicyService,
      'viewValidationState'
    > = {
      viewValidationState: async () => null,
    }
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    body: StartChatWithContactRequest,
    userChannels: { id: string; name: string }[] = [],
    options: StartChatWithContactExecuteOptions = {},
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<IChat> {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!body.worker_id || !channelIds.includes(body.worker_id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const [requiredData, workerType] = await Promise.all([
      this.fetchRequiredData(
        t,
        accountId,
        userId,
        body.worker_id,
        body.sector_id
      ),
      this.workerService.viewWorkerType(accountId, body.worker_id),
    ]);
    const isOfficialWorker =
      workerType?.worker_type_id === EWorkerType.whatsapp;
    requiredData.worker = {
      ...requiredData.worker,
      type_id: workerType?.worker_type_id ?? null,
      is_official: isOfficialWorker,
    };

    const contactData = await this.validateAndGetContactData(
      t,
      body.contact_id,
      accountId,
      isOfficialWorker
    );

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(body.worker_id);

    if (workerConfigFields?.allow_attendance_only_online) {
      const userStatus =
        await this.chatUserViewerRepository.findStatusByUserId(userId);

      if (userStatus !== EChatUserStatus.online) {
        throw new Error(t('attendance_only_online_allowed'));
      }
    }

    const remoteJid = this.resolveContactRemoteJid(contactData);
    const lockKey = buildChatIdentityLockKey(
      accountId,
      requiredData.worker.id,
      {
        phone: contactData.fullPhone,
        remoteJid,
      }
    );

    return withLock(
      this.redis,
      lockKey,
      async () => {
        const resolveWindowStrong = () =>
          this.officialWindowService.resolveAuthoritativeForIdentity(
            {
              accountId,
              workerId: requiredData.worker.id,
              contactId: contactData.contact.contact_id,
              phone: contactData.fullPhone,
              remoteJid,
            },
            new Date()
          );
        let officialWindow = isOfficialWorker
          ? await resolveWindowStrong()
          : null;

        if (officialWindow?.state === 'send_uncertain') {
          throw new Error(t('whatsapp_official_template_send_uncertain'));
        }
        if (officialWindow?.state === 'awaiting_contact_reply') {
          throw new Error(t('whatsapp_official_waiting_contact_reply'));
        }
        if (officialWindow?.state === 'closed' && !body.official_template) {
          throw new Error(t('official_window_requires_template_refresh'));
        }
        let preflightTemplate =
          officialWindow?.state === 'closed' && body.official_template
            ? await this.preflightOfficialTemplate(
                t,
                body.worker_id,
                body.official_template
              )
            : null;

        if (isOfficialWorker) {
          officialWindow = await resolveWindowStrong();
          if (officialWindow.state === 'send_uncertain') {
            throw new Error(t('whatsapp_official_template_send_uncertain'));
          }
          if (officialWindow.state === 'awaiting_contact_reply') {
            throw new Error(t('whatsapp_official_waiting_contact_reply'));
          }
          if (officialWindow.state === 'closed' && !body.official_template) {
            throw new Error(t('official_window_requires_template_refresh'));
          }
          if (
            officialWindow.state === 'closed' &&
            body.official_template &&
            !preflightTemplate
          ) {
            preflightTemplate = await this.preflightOfficialTemplate(
              t,
              body.worker_id,
              body.official_template
            );
            officialWindow = await resolveWindowStrong();
          }
          if (officialWindow.state !== 'closed') {
            preflightTemplate = null;
          }
        }

        const mustSendTemplate = officialWindow?.state === 'closed';

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
            if (
              options.onExistingInChat === 'reuse_and_takeover' ||
              (isOfficialWorker &&
                existingChat.user?.id === requiredData.user?.id)
            ) {
              this.validateOfficialTemplateTagsBeforeMutation({
                t,
                templateInput: mustSendTemplate
                  ? body.official_template
                  : undefined,
                template: preflightTemplate,
                contactData,
                requiredData,
                existingChat,
              });
              const chat = await this.updateExistingChat(
                t,
                existingChat,
                contactData,
                requiredData,
                webhookSource
              );
              return this.finishOfficialOpeningInsideLock({
                t,
                chat,
                templateInput: mustSendTemplate
                  ? body.official_template
                  : undefined,
                template: preflightTemplate,
                officialWindow,
              });
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
            this.validateOfficialTemplateTagsBeforeMutation({
              t,
              templateInput: mustSendTemplate
                ? body.official_template
                : undefined,
              template: preflightTemplate,
              contactData,
              requiredData,
              existingChat,
            });
            const chat = await this.updateExistingChat(
              t,
              existingChat,
              contactData,
              requiredData,
              webhookSource
            );
            return this.finishOfficialOpeningInsideLock({
              t,
              chat,
              templateInput: mustSendTemplate
                ? body.official_template
                : undefined,
              template: preflightTemplate,
              officialWindow,
            });
          }
        }

        this.validateOfficialTemplateTagsBeforeMutation({
          t,
          templateInput: mustSendTemplate ? body.official_template : undefined,
          template: preflightTemplate,
          contactData,
          requiredData,
          existingChat: null,
        });
        const chat = await this.createNewChat(
          t,
          contactData,
          requiredData,
          webhookSource
        );
        return this.finishOfficialOpeningInsideLock({
          t,
          chat,
          templateInput: mustSendTemplate ? body.official_template : undefined,
          template: preflightTemplate,
          officialWindow,
        });
      },
      { ttlMs: 30_000, retryMs: 100, maxWaitMs: 30_000 }
    );
  }

  private validateOfficialTemplateTagsBeforeMutation(input: {
    t: TFunction<'translation', undefined>;
    templateInput?: OfficialTemplateMessageRequest;
    template: IOfficialWhatsappTemplate | null;
    contactData: IContactData;
    requiredData: IRequiredData;
    existingChat: IChat | null;
  }): void {
    if (!input.templateInput || !input.template) {
      return;
    }

    const currentDate = new Date().toISOString();
    const baseChat: IChat = input.existingChat ?? {
      chat_id: 'official-template-preflight',
      account: {
        id: input.requiredData.account.id,
        name: input.requiredData.account.name,
      },
      worker: {
        id: input.requiredData.worker.id,
        name: input.requiredData.worker.name,
        type_id: input.requiredData.worker.type_id ?? null,
        is_official: input.requiredData.worker.is_official ?? null,
      },
      name: input.contactData.contactName,
      phone: input.contactData.fullPhone,
      status: EChatStatus.in_chat,
      date: currentDate,
    };
    const candidateChat = this.buildUpdatedChat(
      baseChat,
      input.contactData,
      input.requiredData,
      currentDate
    );

    this.resolveOfficialTemplateValues(
      input.t,
      input.template,
      input.templateInput,
      candidateChat
    );
  }

  private async finishOfficialOpeningInsideLock(input: {
    t: TFunction<'translation', undefined>;
    chat: IChat;
    templateInput?: OfficialTemplateMessageRequest;
    template: IOfficialWhatsappTemplate | null;
    officialWindow: IChat['official_window'] | null;
  }): Promise<IChat> {
    if (!input.officialWindow) {
      return input.chat;
    }

    if (!input.templateInput || !input.template) {
      return this.officialWindowService.applySnapshotToChat(
        input.chat,
        input.officialWindow
      );
    }

    const officialTemplate = this.resolveOfficialTemplateValues(
      input.t,
      input.template,
      input.templateInput,
      input.chat
    );
    const message = this.buildOfficialOpeningTemplateMessage(
      input.chat,
      officialTemplate
    );
    const reservedChat =
      await this.officialWindowService.recordTemplateSentForChat(input.chat, {
        messageId: message.message_id,
        sentAt: message.date,
      });

    try {
      const accepted =
        await this.chatMessageService.publishPreparedMessage(message);
      if (!accepted) {
        throw new Error('official_template_queue_not_accepted');
      }
    } catch (error) {
      await this.officialWindowService.recordTemplateFailureForMessage(message);
      throw error;
    }

    const authoritativeWindow =
      await this.officialWindowService.resolveAuthoritativeForChat(
        input.chat,
        new Date()
      );
    return {
      ...(reservedChat ?? input.chat),
      official_window: authoritativeWindow,
    };
  }

  private async preflightOfficialTemplate(
    t: TFunction<'translation', undefined>,
    workerId: string,
    input: OfficialTemplateMessageRequest
  ): Promise<IOfficialWhatsappTemplate> {
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
      input
    );

    if (!template) {
      throw new Error(t('official_template_not_approved_or_not_found'));
    }

    this.validateOfficialTemplateVariables(t, template, input.variables);
    return template;
  }

  private resolveOfficialTemplateValues(
    t: TFunction<'translation', undefined>,
    template: IOfficialWhatsappTemplate,
    input: OfficialTemplateMessageRequest,
    chat: IChat
  ): IOfficialWhatsappTemplateMessage {
    const resolvedValues = input.variables?.map((variable) => ({
      ...variable,
      value: replaceMessageTags({
        message: this.officialWhatsappTemplateService.normalizeVariableValue(
          variable.value
        ),
        chat,
        t,
      }),
    }));
    const variables = this.validateOfficialTemplateVariables(
      t,
      template,
      resolvedValues
    );

    return this.buildOfficialTemplateMessage(template, variables);
  }

  private validateOfficialTemplateVariables(
    t: TFunction<'translation', undefined>,
    template: IOfficialWhatsappTemplate,
    values: IOfficialWhatsappTemplateMessage['variables']
  ): IOfficialWhatsappTemplateMessage['variables'] {
    try {
      return this.officialWhatsappTemplateService.validateVariableValues({
        template,
        values,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'official_template_variables_required' ||
          error.message === 'official_template_variable_value_invalid' ||
          error.message === 'official_template_variables_invalid')
      ) {
        throw new Error(t('official_template_variables_required'));
      }

      throw error;
    }
  }

  private buildOfficialTemplateMessage(
    template: IOfficialWhatsappTemplate,
    variables: IOfficialWhatsappTemplateMessage['variables']
  ): IOfficialWhatsappTemplateMessage {
    return {
      name: template.name,
      language: template.language,
      status: template.status,
      parameter_format: template.parameter_format,
      category: template.category,
      components: template.components,
      variables,
      preview: template.preview,
    };
  }

  private buildOfficialOpeningTemplateMessage(
    chat: IChat,
    template: IOfficialWhatsappTemplateMessage
  ): IChatMessage {
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

    const message: IChatMessage = {
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
        official: {
          provider: 'meta_whatsapp',
          type: 'template',
          display: buildOfficialWhatsappDisplayFromTemplate(
            template,
            messageText
          ),
        },
      },
      date: new Date().toISOString(),
    };

    return message;
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
    accountId: string,
    isOfficialWorker: boolean
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
    const validationState =
      await this.contactPhoneValidationPolicyService.viewValidationState(
        accountId,
        contactId
      );
    const isPersistedAsValid =
      validationState?.is_valided ?? contact.is_valided === true;
    const validationOrigin = validationState?.validation_origin ?? null;

    if (isOfficialWorker) {
      if (!isPersistedAsValid) {
        const updated = await this.contactService.updateContactIsValided(
          contactId,
          true,
          undefined,
          undefined,
          CONTACT_VALIDATION_ORIGINS.officialAssumed
        );
        if (!updated) {
          throw new Error(t('contact_must_be_validated'));
        }
      }

      return this.buildContactData(
        contact,
        sensitiveData.phone,
        phoneDdiToValidate,
        sensitiveData.email,
        null
      );
    }

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
            isPersistedAsValid &&
            validationOrigin !== CONTACT_VALIDATION_ORIGINS.officialAssumed &&
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
        isPersistedAsValid &&
        validationOrigin !== CONTACT_VALIDATION_ORIGINS.officialAssumed &&
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
      validationOrigin !== CONTACT_VALIDATION_ORIGINS.whatsappLookup ||
      normalizedPhone !== sensitiveData.phone ||
      normalizedPhoneDdi !== (contact.phone_ddi ?? '');

    if (shouldUpdateContact) {
      const updated = await this.contactService.validateContact(
        contact.contact_id,
        normalizedPhone,
        normalizedPhoneDdi,
        undefined,
        undefined,
        CONTACT_VALIDATION_ORIGINS.whatsappLookup
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
    requiredData: IRequiredData,
    webhookSource: OutboundWebhookRequestSource
  ): Promise<IChat> {
    const currentDate = new Date().toISOString();
    const userData = requiredData.user;

    const updatedChat = this.buildUpdatedChat(
      existingChat,
      contactData,
      requiredData,
      currentDate
    );

    // `reuse_and_takeover` is also used by message forwarding. A retry that
    // already owns the exact target chat must not consume the simultaneous
    // attendance quota again or emit another assignment webhook.
    if (this.isExistingChatStartAlreadyApplied(existingChat, updatedChat)) {
      return existingChat;
    }

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

    const lifecycleEvents = resolveChatLifecycleEventTypes({
      operation:
        existingChat.status === EChatStatus.in_chat
          ? 'status_changed'
          : 'attended',
      previousStatus: existingChat.status,
      currentStatus: EChatStatus.in_chat,
    });
    const saved = await this.chatService.saveChat(updatedChat, {
      refresh: true,
      outboundWebhook: {
        eventTypes:
          lifecycleEvents.length > 0
            ? lifecycleEvents
            : ['chat.assignment.changed'],
        idempotencyKey: `chat-start-existing:${existingChat.chat_id}:${userData?.id ?? 'unassigned'}:${currentDate}`,
        source: webhookSource,
        previousChat: existingChat,
        actor: userData ? { type: 'user', id: userData.id } : null,
        changes: {
          previous_status: existingChat.status,
          status: EChatStatus.in_chat,
          primary_user_id: userData?.id ?? null,
        },
      },
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
    const officialResponsePendingCacheKey =
      createChatbotOfficialResponsePendingCacheKey(accountId, workerId, chatId);
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
      this.redis.del(officialResponsePendingCacheKey),
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
            entered_at:
              existingChat.user?.id === userData.id
                ? (existingChat.user.entered_at ?? currentDate)
                : currentDate,
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

  private canonicalJson(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, nestedValue: unknown) => {
      if (
        nestedValue === null ||
        Array.isArray(nestedValue) ||
        typeof nestedValue !== 'object'
      ) {
        return nestedValue;
      }
      return Object.fromEntries(
        Object.entries(nestedValue as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      );
    });
  }

  private isExistingChatStartAlreadyApplied(
    currentChat: IChat,
    intendedChat: IChat
  ): boolean {
    const selectState = (chat: IChat): Record<string, unknown> => ({
      message_key: chat.message_key ?? null,
      status: chat.status,
      worker: chat.worker,
      sector: chat.sector ?? null,
      user: chat.user ?? null,
      contact: chat.contact ?? null,
      name: chat.name,
      phone: chat.phone,
      photo: chat.photo ?? null,
      started_at: chat.started_at ?? null,
      forward_to_output_chatbot: chat.forward_to_output_chatbot ?? null,
    });

    return (
      this.canonicalJson(selectState(currentChat)) ===
      this.canonicalJson(selectState(intendedChat))
    );
  }

  private async createNewChat(
    t: TFunction<'translation', undefined>,
    contactData: IContactData,
    requiredData: IRequiredData,
    webhookSource: OutboundWebhookRequestSource
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
      outboundWebhook: {
        eventTypes: [
          'chat.created',
          'chat.attended',
          ...(chatWithProtocol.protocol_start?.length
            ? (['chat.protocol.updated'] as const)
            : []),
        ],
        idempotencyKey: `chat-created:${chatWithProtocol.chat_id}`,
        source: webhookSource,
        previousChat: null,
        actor: requiredData.user
          ? { type: 'user', id: requiredData.user.id }
          : null,
        changes: {
          initial_status: chatWithProtocol.status,
        },
      },
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
