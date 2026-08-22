import { inject, injectable } from 'tsyringe';
import { SchedulePendingListerRepository } from '@core/repositories/schedule/SchedulePendingLister.repository';
import { ScheduleContactsValidatedListerRepository } from '@core/repositories/schedule/ScheduleContactsValidatedLister.repository';
import { ScheduleStatusUpdaterRepository } from '@core/repositories/schedule/ScheduleStatusUpdater.repository';
import { ContactService } from './contact.service';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { KafkaServiceQueueService } from './kafkaServiceQueue.service';
import { StreamProducerService } from './streamProducer.service';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { v7 as uuidv7 } from 'uuid';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import Redis from 'ioredis';
import {
  LockAcquisitionTimeoutError,
  withLock,
} from '@core/common/functions/withLock';
import { ISchedulePendingData } from '@core/interfaces/repositories/schedule/ISchedulePendingData';
import { IScheduleMessageResult } from '@core/common/interfaces/IScheduleMessageResult';
import { IScheduleContactValidated } from '@core/common/interfaces/IScheduleContactValidated';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import {
  resolveWorkerCommandChatEntityKey,
  ensureMessageSendHash,
} from '@core/common/functions/messageIdentity';
import { WorkerCommandAdmissionService } from './workerCommandAdmission.service';
import { PlanAccountService } from './planAccount.service';
import moment from 'moment-timezone';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import {
  ScheduleDocument,
  ScheduleCreateResult,
  SchedulePatchScriptParams,
} from '@core/common/interfaces/IScheduleDocument';
import { delay } from '@core/common/functions/delay';
import { ChatService } from './chat.service';
import { ChatbotFlowRunnerService } from './chatbotFlowRunner.service';
import { EncryptService } from './encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';
import i18next from 'i18next';
import { IChat } from '@core/common/interfaces/IChat';
import {
  IUpsertMessage,
  IUpsertMessageEnvelope,
} from '@core/common/interfaces/IUpsertMessage';
import { ScheduleControlRepository } from '@core/repositories/schedule/ScheduleControl.repository';
import { PhoneValidationService } from './phoneValidation.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import {
  appendSecurityKeyToText,
  shouldApplySecurityKey,
} from '@core/common/functions/securityKeyConfig';
import { TSecurityKeyScope } from '@core/common/interfaces/ISecurityKeyConfig';
import { WorkerConfigService } from './workerConfig.service';
import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { OfficialWhatsappTemplateService } from './officialWhatsappTemplate.service';
import { IOfficialWhatsappTemplate } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import { buildOfficialWhatsappDisplayFromTemplate } from '@core/common/functions/officialWhatsappDisplay';
import { normalizeOfficialTemplateVariableValue } from '@core/common/functions/normalizeOfficialTemplateVariableValue';
import { ScheduleStatusCoordinationService } from './scheduleStatusCoordination.service';
import { CONTACT_VALIDATION_ORIGINS } from '@core/common/types/ContactValidationOrigin';
import { ScheduleOfficialMessageService } from './scheduleOfficialMessage.service';
import { resolveChatLifecycleEventTypes } from '@core/common/constants/outboundWebhookEvents';

@injectable()
export class ScheduleSendService {
  private readonly BRAZIL_TIMEZONE = APP_TIMEZONE;
  private readonly STATUS_POLL_INTERVAL_MS = 2000;

  constructor(
    @inject(SchedulePendingListerRepository)
    private readonly schedulePendingListerRepository: SchedulePendingListerRepository,
    @inject(ScheduleContactsValidatedListerRepository)
    private readonly scheduleContactsValidatedListerRepository: ScheduleContactsValidatedListerRepository,
    @inject(ScheduleStatusUpdaterRepository)
    private readonly scheduleStatusUpdaterRepository: ScheduleStatusUpdaterRepository,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(WorkerCommandAdmissionService)
    private readonly workerCommandAdmissionService: WorkerCommandAdmissionService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PhoneValidationService)
    private readonly phoneValidationService: PhoneValidationService,
    @inject(ScheduleControlRepository)
    private readonly scheduleControlRepository: ScheduleControlRepository,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(OfficialWhatsappTemplateService)
    private readonly officialWhatsappTemplateService: OfficialWhatsappTemplateService,
    @inject(ScheduleOfficialMessageService)
    private readonly scheduleOfficialMessageService: ScheduleOfficialMessageService,
    @inject('Redis') private readonly redis: Redis,
    @inject(ScheduleStatusCoordinationService)
    private readonly scheduleStatusCoordinationService: ScheduleStatusCoordinationService
  ) {}

  private getRandomDelayMs(sendSpeed: string | undefined): number {
    let minMs: number;
    let maxMs: number;
    if (sendSpeed === EScheduleSendSpeed.high) {
      minMs = 10000;
      maxMs = 20000;
    } else if (sendSpeed === EScheduleSendSpeed.medium) {
      minMs = 20000;
      maxMs = 40000;
    } else {
      minMs = 30000;
      maxMs = 60000;
    }
    const random = Math.random(); // NOSONAR: Math.random() is safe here as it's only used for non-security purposes (message timing)
    return Math.floor(random * (maxMs - minMs) + minMs);
  }

  private getGreeting(): string {
    const hour = moment().tz(this.BRAZIL_TIMEZONE).hour();

    if (hour >= 5 && hour < 12) {
      return 'Bom dia';
    }

    if (hour >= 12 && hour < 18) {
      return 'Boa tarde';
    }

    return 'Boa noite';
  }

  private getProtocol(): string {
    return generateProtocol();
  }

  private normalizePhoneDdi(phoneDdi: string | null | undefined): string {
    const digits = phoneDdi?.replaceAll(/\D/g, '') ?? '';
    return digits || '55';
  }

  private isExecutionAllowedStatus(status: EScheduleStatus | null): boolean {
    return (
      status === EScheduleStatus.pending ||
      status === EScheduleStatus.processing
    );
  }

  private async getCurrentScheduleStatus(
    scheduleId: string
  ): Promise<EScheduleStatus | null> {
    return this.scheduleControlRepository.getScheduleStatusById(scheduleId);
  }

  private async canContinueScheduleProcessing(
    scheduleId: string
  ): Promise<boolean> {
    const status = await this.getCurrentScheduleStatus(scheduleId);
    return this.isExecutionAllowedStatus(status);
  }

  private async waitForDispatchWindow(
    scheduleId: string,
    sendSpeed: string | undefined
  ): Promise<boolean> {
    const totalDelayMs = this.getRandomDelayMs(sendSpeed);
    if (totalDelayMs <= 0) {
      return this.canContinueScheduleProcessing(scheduleId);
    }

    let elapsed = 0;
    while (elapsed < totalDelayMs) {
      const status = await this.getCurrentScheduleStatus(scheduleId);
      if (!this.isExecutionAllowedStatus(status)) {
        return false;
      }

      const remaining = totalDelayMs - elapsed;
      const waitMs = Math.min(this.STATUS_POLL_INTERVAL_MS, remaining);
      await delay(waitMs);
      elapsed += waitMs;
    }

    return this.canContinueScheduleProcessing(scheduleId);
  }

  private async replaceTags(
    message: string | null,
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated
  ): Promise<string> {
    if (!message) {
      return '';
    }

    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    const phoneFormatted = phone ? formatPhoneBR(phone) : '';
    const now = moment().tz(this.BRAZIL_TIMEZONE);
    const date = now.format('DD/MM/YYYY');
    const time = now.format('HH:mm');
    const greeting = this.getGreeting();
    const protocol = this.getProtocol();

    let replaced = message;

    replaced = replaced.replaceAll('{{ greeting }}', greeting);
    replaced = replaced.replaceAll('{{ name }}', contact.name || '');
    replaced = replaced.replaceAll(
      '{{ nickname }}',
      contact.nickname || contact.name || ''
    );
    replaced = replaced.replaceAll('{{ protocol }}', protocol);
    replaced = replaced.replaceAll('{{ date }}', date);
    replaced = replaced.replaceAll('{{ time }}', time);
    replaced = replaced.replaceAll('{{ account_name }}', schedule.account_name);
    replaced = replaced.replaceAll('{{ phone }}', phoneFormatted);
    replaced = replaced.replaceAll('{{ channel_name }}', schedule.worker_name);

    return replaced;
  }

  private getDuplicateLockKey(scheduleId: string, contactId: string): string {
    return `schedule:duplicate:${scheduleId}:${contactId}`;
  }

  private async checkAndSetDuplicate(
    scheduleId: string,
    contactId: string
  ): Promise<boolean> {
    const lockKey = this.getDuplicateLockKey(scheduleId, contactId);
    const acquired = await this.redis.set(lockKey, '1', 'EX', 86400, 'NX');
    return acquired === 'OK';
  }

  private async checkMessageSent(
    scheduleId: string,
    contactId: string
  ): Promise<boolean> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const query = {
      size: 1,
      query: {
        bool: {
          must: [
            {
              term: {
                schedule_id: scheduleId,
              },
            },
            {
              nested: {
                path: 'contact',
                query: {
                  term: {
                    'contact.id': contactId,
                  },
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      hits: { total: { value: number } };
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return false;
    }

    const total = result.hits.total as { value: number } | number;

    if (typeof total === 'number') {
      return total > 0;
    }

    return total.value > 0;
  }

  private async listFailedMessageReferences(
    scheduleId: string,
    accountId: string,
    messageId?: string
  ): Promise<Array<{ message_id: string; contact_id: string }>> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const mustConditions: Record<string, unknown>[] = [
      {
        nested: {
          path: 'account',
          query: {
            term: {
              'account.id': accountId,
            },
          },
        },
      },
      {
        term: {
          schedule_id: scheduleId,
        },
      },
      {
        term: {
          status: EScheduleStatus.failed,
        },
      },
    ];

    if (messageId) {
      mustConditions.push({
        term: {
          id: messageId,
        },
      });
    }

    const query = {
      size: messageId ? 1 : 10000,
      query: {
        bool: {
          must: mustConditions,
          must_not: [
            {
              exists: {
                field: 'reprocessed_by_message_id',
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      id?: string;
      contact?: {
        id?: string;
      } | null;
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return [];
    }

    return result.hits.hits
      .map((hit) => {
        const source = hit._source;
        if (!source?.id || !source.contact?.id) {
          return null;
        }

        return {
          message_id: source.id,
          contact_id: source.contact.id,
        };
      })
      .filter(
        (
          item
        ): item is {
          message_id: string;
          contact_id: string;
        } => item !== null
      );
  }

  private getMessageReprocessLockKey(
    scheduleId: string,
    messageId: string
  ): string {
    return `schedule:message-reprocess:${scheduleId}:${messageId}`;
  }

  private async markFailedMessageAsReprocessed(
    scheduleId: string,
    accountId: string,
    contactId: string,
    sourceMessageId: string,
    replacementMessageId: string
  ): Promise<boolean> {
    const reprocessedAtEpochMillis =
      await this.scheduleStatusCoordinationService.currentTimeMilliseconds();
    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.schedule,
      sourceMessageId,
      {
        source: `
          if (
            ctx._source == null ||
            ctx._source.schedule_id != params.schedule_id ||
            ctx._source.account == null ||
            ctx._source.account.id != params.account_id ||
            ctx._source.contact == null ||
            ctx._source.contact.id != params.contact_id ||
            ctx._source.status != params.failed_status ||
            (
              ctx._source.containsKey('reprocessed_by_message_id') &&
              ctx._source.reprocessed_by_message_id != null
            )
          ) {
            ctx.op = 'noop';
          } else {
            ctx._source.reprocessed_by_message_id =
              params.replacement_message_id;
            ctx._source.reprocessed_at = params.reprocessed_at;
          }
        `,
        params: {
          schedule_id: scheduleId,
          account_id: accountId,
          contact_id: contactId,
          failed_status: EScheduleStatus.failed,
          replacement_message_id: replacementMessageId,
          reprocessed_at: new Date(reprocessedAtEpochMillis).toISOString(),
        },
      },
      {
        maxRetries: 5,
        refresh: true,
      }
    );

    return result === 'updated';
  }

  private async clearDuplicateLock(
    scheduleId: string,
    contactId: string
  ): Promise<void> {
    const lockKey = this.getDuplicateLockKey(scheduleId, contactId);
    await this.redis.del(lockKey);
  }

  private async appendScheduleSecurityKey(
    schedule: ISchedulePendingData,
    message: string,
    options?: { allowSecurityKeyOnly?: boolean }
  ): Promise<string> {
    if (!message.trim() && !options?.allowSecurityKeyOnly) {
      return message;
    }

    if (isOfficialWhatsappWorker(schedule.worker_type_id)) {
      return message;
    }

    const scopes: TSecurityKeyScope[] = ['schedule'];
    const securityKeyConfig = await this.workerConfigService.viewSecurityKey(
      schedule.worker_id
    );

    if (!shouldApplySecurityKey(securityKeyConfig, scopes)) {
      return message;
    }

    return appendSecurityKeyToText(message, options);
  }

  private buildScheduleWorker(schedule: ISchedulePendingData): IChat['worker'] {
    const isOfficial = isOfficialWhatsappWorker(schedule.worker_type_id);

    return {
      id: schedule.worker_id,
      name: schedule.worker_name,
      type_id: schedule.worker_type_id ?? null,
      is_official: isOfficial,
    };
  }

  private async createTextMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    const message = await this.appendScheduleSecurityKey(
      schedule,
      await this.replaceTags(schedule.message, schedule, contact),
      { allowSecurityKeyOnly: true }
    );

    return {
      ...baseMessage,
      content: {
        type: EMessageType.text,
        message,
      },
    };
  }

  private async createImageMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    if (!schedule.url) {
      return baseMessage;
    }

    const message = await this.appendScheduleSecurityKey(
      schedule,
      await this.replaceTags(schedule.message, schedule, contact),
      { allowSecurityKeyOnly: true }
    );

    return {
      ...baseMessage,
      content: {
        type: EMessageType.image,
        message,
        image: {
          url: schedule.url,
          caption: message,
          mimetype: schedule.mimetype ?? null,
          extension: null,
          size: null,
          width: schedule.width ?? null,
          height: schedule.height ?? null,
        },
      },
    };
  }

  private async createVideoMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    if (!schedule.url) {
      return baseMessage;
    }

    const message = await this.appendScheduleSecurityKey(
      schedule,
      await this.replaceTags(schedule.message, schedule, contact)
    );

    return {
      ...baseMessage,
      content: {
        type: EMessageType.video,
        message,
        video: {
          url: schedule.url,
          caption: message,
          name: null,
          mimetype: schedule.mimetype ?? null,
          extension: null,
          size: null,
          duration: schedule.duration ?? null,
          width: schedule.width ?? null,
          height: schedule.height ?? null,
          thumbnail: null,
        },
      },
    };
  }

  private async createAudioMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    if (!schedule.url) {
      return baseMessage;
    }

    const message = await this.replaceTags(schedule.message, schedule, contact);

    return {
      ...baseMessage,
      content: {
        type: EMessageType.audio,
        message,
        audio: {
          url: schedule.url,
          mimetype: schedule.mimetype ?? null,
          extension: null,
          size: null,
          duration: schedule.duration ?? null,
          ptt: false,
          waveform: null,
        },
      },
    };
  }

  private async createOfficialTemplateMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    const sourceTemplate = schedule.official_template;
    if (!sourceTemplate?.name || !sourceTemplate.language) {
      return baseMessage;
    }

    const variables = await Promise.all(
      (sourceTemplate.variables ?? []).map(async (variable) => ({
        ...variable,
        value: await this.replaceTags(
          normalizeOfficialTemplateVariableValue(variable.value),
          schedule,
          contact
        ),
      }))
    );
    const officialTemplate = {
      ...sourceTemplate,
      variables,
    };
    const templateForPreview: IOfficialWhatsappTemplate = {
      id: null,
      name: sourceTemplate.name,
      language: sourceTemplate.language,
      status: 'APPROVED',
      category: sourceTemplate.category ?? null,
      components: sourceTemplate.components ?? [],
      variables: [],
      preview: sourceTemplate.preview ?? {},
    };
    const message =
      this.officialWhatsappTemplateService.buildPreviewText(
        templateForPreview,
        variables
      ) || sourceTemplate.name;

    return {
      ...baseMessage,
      content: {
        type: EMessageType.official_template,
        message,
        official_template: officialTemplate,
        official: {
          provider: 'meta_whatsapp',
          type: 'template',
          display: buildOfficialWhatsappDisplayFromTemplate(
            officialTemplate,
            message
          ),
        },
      },
    };
  }

  private createBaseMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string,
    messageId?: string
  ): IChatMessage {
    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    const phoneDdi = this.normalizePhoneDdi(contact.phone_ddi);
    const now = new Date().toISOString();

    const message: IChatMessage = {
      message_id: messageId ?? uuidv7(),
      chat_id: `${schedule.account_id}:${jid}`,
      message_key: {
        remote_jid: jid,
        remote_jid_alt: null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.system,
      sent_from_platform: true,
      account: {
        id: schedule.account_id,
        name: schedule.account_name,
      },
      worker: this.buildScheduleWorker(schedule),
      user: null,
      phone: phone ?? '',
      phone_ddi: phoneDdi,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      date: now,
      hash: null,
      send_delay_ms: null,
    };

    ensureMessageSendHash(message);
    return message;
  }

  private async createChatMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string,
    messageId?: string
  ): Promise<IChatMessage> {
    const baseMessage = this.createBaseMessage(
      schedule,
      contact,
      jid,
      messageId
    );

    if (schedule.type === EScheduleType.chatbot) {
      return baseMessage;
    }

    if (schedule.type === EScheduleType.official_template) {
      return this.createOfficialTemplateMessage(schedule, baseMessage, contact);
    }

    if (schedule.type === EScheduleType.text) {
      return this.createTextMessage(schedule, baseMessage, contact);
    }

    if (schedule.type === EScheduleType.image) {
      return this.createImageMessage(schedule, baseMessage, contact);
    }

    if (schedule.type === EScheduleType.video) {
      return this.createVideoMessage(schedule, baseMessage, contact);
    }

    if (schedule.type === EScheduleType.audio) {
      return this.createAudioMessage(schedule, baseMessage, contact);
    }

    return baseMessage;
  }

  private createFailedMessage(
    schedule: ISchedulePendingData,
    messageId?: string
  ): IChatMessage {
    return {
      message_id: messageId ?? uuidv7(),
      chat_id: '',
      message_key: null,
      type_user: ETypeUserChat.system,
      sent_from_platform: true,
      account: {
        id: schedule.account_id,
        name: schedule.account_name,
      },
      worker: this.buildScheduleWorker(schedule),
      user: null,
      phone: '',
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: false,
      },
      deleted: false,
      has_quoted: false,
      date: new Date().toISOString(),
      hash: null,
    };
  }

  private async createScheduleIdempotent(
    document: ScheduleDocument,
    scheduleId: string
  ): Promise<ScheduleCreateResult> {
    const result = await this.elasticDatabaseService.createDocument(
      EElasticIndex.schedule,
      scheduleId,
      document
    );

    return {
      created: result === 'created',
    };
  }

  private buildPatchScheduleMissingFieldsScript(): string {
    return `
      if (ctx._source == null) {
        ctx.op = 'noop';
        return;
      }
      
      def changed = false;
      def patch = params.patch;
      
      if (patch.containsKey('schedule_id') && patch.schedule_id != null) {
        if (ctx._source.schedule_id == null) {
          ctx._source.schedule_id = patch.schedule_id;
          changed = true;
        }
      }
      
      if (patch.containsKey('message_key') && patch.message_key != null) {
        if (ctx._source.message_key == null) {
          ctx._source.message_key = patch.message_key;
          changed = true;
        } else {
          def messageKey = patch.message_key;
          if (messageKey.containsKey('remote_jid') && messageKey.remote_jid != null) {
            if (ctx._source.message_key.remote_jid == null) {
              ctx._source.message_key.remote_jid = messageKey.remote_jid;
              changed = true;
            }
          }
        }
      }
      
      if (patch.containsKey('contact') && patch.contact != null) {
        if (ctx._source.contact == null) {
          ctx._source.contact = patch.contact;
          changed = true;
        } else {
          def contact = patch.contact;
          if (contact.containsKey('id') && contact.id != null) {
            if (ctx._source.contact.id == null) {
              ctx._source.contact.id = contact.id;
              changed = true;
            }
          }
          if (contact.containsKey('name') && contact.name != null) {
            if (ctx._source.contact.name == null) {
              ctx._source.contact.name = contact.name;
              changed = true;
            }
          }
          if (contact.containsKey('phone') && contact.phone != null) {
            if (ctx._source.contact.phone == null) {
              ctx._source.contact.phone = contact.phone;
              changed = true;
            }
          }
          if (contact.containsKey('phone_ddi') && contact.phone_ddi != null) {
            if (ctx._source.contact.phone_ddi == null) {
              ctx._source.contact.phone_ddi = contact.phone_ddi;
              changed = true;
            }
          }
          if (contact.containsKey('phone_partial') && contact.phone_partial != null) {
            if (ctx._source.contact.phone_partial == null) {
              ctx._source.contact.phone_partial = contact.phone_partial;
              changed = true;
            }
          }
        }
      }
      
      if (patch.containsKey('account') && patch.account != null) {
        if (ctx._source.account == null) {
          ctx._source.account = patch.account;
          changed = true;
        } else {
          def account = patch.account;
          if (account.containsKey('id') && account.id != null) {
            if (ctx._source.account.id == null) {
              ctx._source.account.id = account.id;
              changed = true;
            }
          }
          if (account.containsKey('name') && account.name != null) {
            if (ctx._source.account.name == null) {
              ctx._source.account.name = account.name;
              changed = true;
            }
          }
        }
      }
      
      if (patch.containsKey('worker') && patch.worker != null) {
        if (ctx._source.worker == null) {
          ctx._source.worker = patch.worker;
          changed = true;
        } else {
          def worker = patch.worker;
          if (worker.containsKey('id') && worker.id != null) {
            if (ctx._source.worker.id == null) {
              ctx._source.worker.id = worker.id;
              changed = true;
            }
          }
          if (worker.containsKey('name') && worker.name != null) {
            if (ctx._source.worker.name == null) {
              ctx._source.worker.name = worker.name;
              changed = true;
            }
          }
        }
      }
      
      if (patch.containsKey('type') && patch.type != null) {
        if (ctx._source.type == null) {
          ctx._source.type = patch.type;
          changed = true;
        }
      }
      
      if (patch.containsKey('message') && patch.message != null) {
        if (ctx._source.message == null) {
          ctx._source.message = patch.message;
          changed = true;
        }
      }
      
      if (patch.containsKey('url') && patch.url != null) {
        if (ctx._source.url == null) {
          ctx._source.url = patch.url;
          changed = true;
        }
      }
      
      if (patch.containsKey('send_date') && patch.send_date != null) {
        if (ctx._source.send_date == null) {
          ctx._source.send_date = patch.send_date;
          changed = true;
        }
      }
      
      if (patch.containsKey('chatbot_name')) {
        if (ctx._source.chatbot_name == null && patch.chatbot_name != null) {
          ctx._source.chatbot_name = patch.chatbot_name;
          changed = true;
        }
      }
      
      if (patch.containsKey('send_log') && patch.send_log != null) {
        if (ctx._source.send_log == null) {
          ctx._source.send_log = patch.send_log;
          changed = true;
        }
      }
      
      if (!changed) {
        ctx.op = 'noop';
      }
    `;
  }

  private buildPatchScheduleMissingFieldsParams(
    document: ScheduleDocument
  ): SchedulePatchScriptParams {
    return {
      patch: {
        schedule_id: document.schedule_id,
        message_key: document.message_key,
        contact: document.contact,
        account: document.account,
        worker: document.worker,
        type: document.type,
        message: document.message,
        url: document.url,
        chatbot_name: document.chatbot_name,
        send_date: document.send_date,
        send_log: document.send_log,
      },
    };
  }

  private async patchExistingScheduleMissingFields(
    scheduleId: string,
    patch: Partial<ScheduleDocument>
  ): Promise<boolean> {
    const scriptSource = this.buildPatchScheduleMissingFieldsScript();
    const scriptParams: SchedulePatchScriptParams = {
      patch,
    };

    const result = await this.elasticDatabaseService.updateWithScriptOCC(
      EElasticIndex.schedule,
      scheduleId,
      {
        source: scriptSource,
        params: scriptParams,
      },
      {
        maxRetries: 5,
      }
    );

    return result === 'updated' || result === 'noop';
  }

  private async saveToElasticsearch(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    message: IChatMessage,
    status: EScheduleStatus | string,
    options?: {
      overrideOnConflict?: boolean;
      attemptId?: string;
      resetStatusIdentity?: boolean;
    }
  ): Promise<boolean> {
    if (!message.message_id) {
      return false;
    }

    try {
      await this.elasticDatabaseService.indices(
        EElasticIndex.schedule,
        scheduleMappings()
      );

      const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
      const phoneDdi = this.normalizePhoneDdi(contact.phone_ddi);
      const jid = normalizePhoneToJid(phone, phoneDdi);
      const nowEpochMillis =
        await this.scheduleStatusCoordinationService.currentTimeMilliseconds();
      const now = new Date(nowEpochMillis).toISOString();

      const document: ScheduleDocument = {
        id: message.message_id,
        schedule_id: schedule.schedule_id,
        attempt_id: options?.attemptId ?? null,
        message_key: {
          remote_jid: jid ?? null,
        },
        contact: {
          id: contact.contact_id,
          name: contact.name,
          phone: phone ?? null,
          phone_ddi: phoneDdi,
          phone_partial: contact.phone_partial ?? null,
        },
        account: {
          id: schedule.account_id,
          name: schedule.account_name,
        },
        worker: {
          id: schedule.worker_id,
          name: schedule.worker_name,
        },
        type: schedule.type as EScheduleType,
        message: message.content?.message || schedule.message || '',
        url: schedule.url,
        chatbot_name: schedule.chatbot_name ?? null,
        status,
        send_date: now,
        send_log: null,
        created_at: now,
        updated_at: now,
        updated_at_epoch_millis: nowEpochMillis,
        ...(options?.resetStatusIdentity
          ? {
              last_event_id: null,
              last_event_sort_key: null,
              status_rank: null,
            }
          : {}),
      };

      const createResult = await this.createScheduleIdempotent(
        document,
        message.message_id
      );

      let persisted = createResult.created;
      if (!persisted && options?.overrideOnConflict) {
        const updateResult = await this.elasticDatabaseService.updateWithOCC(
          EElasticIndex.schedule,
          message.message_id,
          document as unknown as Record<string, unknown>,
          {
            upsert: true,
            maxRetries: 5,
          }
        );

        persisted =
          updateResult === 'updated' ||
          updateResult === 'created' ||
          updateResult === 'noop';
      } else if (!persisted) {
        const patchParams =
          this.buildPatchScheduleMissingFieldsParams(document);
        persisted = await this.patchExistingScheduleMissingFields(
          message.message_id,
          patchParams.patch
        );
      }

      return persisted;
    } catch (error) {
      console.error(
        `Failed to save to Elasticsearch for schedule ${schedule.schedule_id}, contact ${contact.contact_id}:`,
        error
      );
      return false;
    }
  }

  private async sendMessageToKafka(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    message: IChatMessage,
    attemptId: string
  ): Promise<void> {
    const scheduleMessage: IScheduleMessage = {
      schedule_id: schedule.schedule_id,
      attempt_id: attemptId,
      account_id: schedule.account_id,
      contact_id: contact.contact_id,
      message,
      is_validated: contact.is_validated,
    };

    const workerId = message.worker.id;
    if (!workerId) {
      throw new Error('Worker ID is required to send schedule message');
    }
    if (isOfficialWhatsappWorker(schedule.worker_type_id)) {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.officialWhatsappSendMessage(),
        scheduleMessage,
        resolveWorkerCommandChatEntityKey(
          schedule.account_id,
          workerId,
          message
        )
      );
      return;
    }

    await this.workerCommandAdmissionService.admit({
      accountId: schedule.account_id,
      workerId,
      commandType: 'schedule_send',
      entityKey: resolveWorkerCommandChatEntityKey(
        schedule.account_id,
        workerId,
        message
      ),
      operationId: attemptId,
      scheduleProjection: {
        schedule_id: schedule.schedule_id,
        message_id: message.message_id,
        attempt_id: attemptId,
      },
      payload: scheduleMessage as unknown as Record<string, never>,
      source: 'schedule',
    });
  }

  private async validateContactPhone(
    contact: IScheduleContactValidated
  ): Promise<string | null> {
    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    if (!phone) return null;

    const phoneDdi = this.normalizePhoneDdi(contact.phone_ddi);
    const jid = normalizePhoneToJid(phone, phoneDdi);
    if (!jid) return null;

    return jid;
  }

  private isTechnicalValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
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

  private isInvalidValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('phone_number_not_valid_on_whatsapp') ||
      errorMessage.includes('phone number is not valid on whatsapp')
    );
  }

  private canUsePersistedValidationFallback(
    contact: IScheduleContactValidated,
    fallbackJid: string | null
  ): boolean {
    return (
      contact.is_validated &&
      contact.validation_origin !==
        CONTACT_VALIDATION_ORIGINS.officialAssumed &&
      !!fallbackJid
    );
  }

  private async resolveChatbotValidatedJid(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    fallbackJid: string | null
  ): Promise<string | null> {
    const decryptedPhone = this.contactService.getContactPhoneDecrypted(
      contact.phone
    );
    const phoneDdi = this.normalizePhoneDdi(contact.phone_ddi);

    if (!decryptedPhone) {
      if (this.canUsePersistedValidationFallback(contact, fallbackJid)) {
        return fallbackJid;
      }
      return null;
    }

    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        schedule.account_id,
        decryptedPhone,
        phoneDdi,
        undefined,
        { bypassCache: true }
      );

      if (!validationResult.valid) {
        await this.contactService.updateContactIsValided(
          contact.contact_id,
          false
        );
        return null;
      }

      let normalizedPhone = decryptedPhone;
      let normalizedPhoneDdi = phoneDdi;

      if (validationResult.phone) {
        const extracted = extractPhoneAndDdi(validationResult.phone);
        if (extracted) {
          normalizedPhone = extracted.phone;
          normalizedPhoneDdi = extracted.phone_ddi;
        }
      }

      const shouldSyncValidation =
        !contact.is_validated ||
        contact.validation_origin !==
          CONTACT_VALIDATION_ORIGINS.whatsappLookup ||
        normalizedPhone !== decryptedPhone ||
        normalizedPhoneDdi !== phoneDdi;

      if (shouldSyncValidation) {
        const updated = await this.contactService.updateContactValidation(
          contact.contact_id,
          `${normalizedPhoneDdi}${normalizedPhone}`,
          true,
          undefined,
          undefined,
          CONTACT_VALIDATION_ORIGINS.whatsappLookup
        );

        if (!updated) {
          console.warn(
            `[ScheduleSendService] Failed to sync validated phone for contact ${contact.contact_id}`
          );
        }
      }

      const validatedJid =
        validationResult.jid ??
        normalizePhoneToJid(normalizedPhone, normalizedPhoneDdi) ??
        fallbackJid;

      return validatedJid ?? null;
    } catch (error) {
      if (this.isInvalidValidationError(error)) {
        await this.contactService.updateContactIsValided(
          contact.contact_id,
          false
        );
        return null;
      }

      if (this.isTechnicalValidationError(error)) {
        if (this.canUsePersistedValidationFallback(contact, fallbackJid)) {
          return fallbackJid;
        }
        return null;
      }

      throw error;
    }
  }

  private async reportScheduleChatbotFailure(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    status: EScheduleStatus,
    messageId?: string
  ): Promise<IScheduleMessageResult> {
    const failedMessage = this.createFailedMessage(schedule, messageId);
    await this.saveToElasticsearch(schedule, contact, failedMessage, status);

    return { success: false, contactId: contact.contact_id };
  }

  private async reportScheduleChatbotIgnored(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    messageId?: string
  ): Promise<IScheduleMessageResult> {
    const failedMessage = this.createFailedMessage(schedule, messageId);
    await this.saveToElasticsearch(
      schedule,
      contact,
      failedMessage,
      EScheduleStatus.ignored
    );

    return { success: false, contactId: contact.contact_id };
  }

  private buildScheduleChatbotChat(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string,
    now: string
  ): IChat {
    const phoneFromJid = getPhoneFromJid(jid, null);
    const extractedFromJid = phoneFromJid
      ? extractPhoneAndDdi(phoneFromJid)
      : null;
    const fallbackPhone = this.contactService.getContactPhoneDecrypted(
      contact.phone
    );
    const phone = extractedFromJid?.phone ?? fallbackPhone ?? '';
    const phoneDdi =
      extractedFromJid?.phone_ddi ?? this.normalizePhoneDdi(contact.phone_ddi);
    const fullPhone = `${phoneDdi}${phone}`;
    const contactPhoneSanitized = phone
      ? this.encryptService.sanitize(phone, ETypeSanetize.phone)
      : '';

    return {
      chat_id: uuidv7(),
      message_key: { remote_jid: jid, remote_jid_alt: null },
      account: { id: schedule.account_id, name: schedule.account_name },
      worker: this.buildScheduleWorker(schedule),
      contact: {
        id: contact.contact_id,
        name: contact.name,
        phone: contactPhoneSanitized,
        phone_ddi: phoneDdi,
        responsible_attendant: null,
        ignore: 'not_ignore',
      },
      name: contact.name,
      phone: fullPhone,
      status: EChatStatus.ura_schedule,
      date: now,
      forward_to_output_chatbot: false,
      chatbot_schedule_id: schedule.chatbot_id,
    };
  }

  private buildScheduleChatbotMinimalData(
    schedule: ISchedulePendingData,
    jid: string
  ): IUpsertMessage {
    const bootstrapEnvelope: IUpsertMessageEnvelope = {
      key: {
        id: `schedule_bootstrap_${schedule.schedule_id}_${Date.now()}`,
        remoteJid: jid,
        fromMe: true,
      },
      message: {
        conversation: '',
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
    };

    return {
      account_id: schedule.account_id,
      worker_id: schedule.worker_id,
      type: EMessageType.text,
      message: bootstrapEnvelope,
      has_quoted: false,
    };
  }

  private async compensateScheduleChatbotStartFailure(
    schedule: ISchedulePendingData,
    chat: IChat
  ): Promise<void> {
    let closedChat: IChat | null = null;

    try {
      await this.elasticDatabaseService.refreshIndex(EElasticIndex.message);

      const lastPersistedMessage =
        await this.chatService.findLastMessageByChatId(
          schedule.account_id,
          chat.chat_id
        );
      if (lastPersistedMessage) {
        console.warn(
          '[ScheduleSendService] Chatbot start compensation skipped because the chat already has a persisted message',
          {
            schedule_id: schedule.schedule_id,
            chat_id: chat.chat_id,
            message_id: lastPersistedMessage.message_id,
          }
        );
        return;
      }

      const currentChat = await this.chatService.findChatByChatId(
        schedule.account_id,
        chat.chat_id
      );
      if (!currentChat || currentChat.status !== EChatStatus.ura_schedule) {
        return;
      }
      if (currentChat.summary?.last_message_id) {
        return;
      }

      const candidateClosedChat: IChat = {
        ...currentChat,
        status: EChatStatus.closed,
        closed_at: new Date().toISOString(),
      };
      const closed = await this.chatService.saveChat(candidateClosedChat, {
        refresh: true,
        expectedCurrentStatuses: [EChatStatus.ura_schedule],
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: null,
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: currentChat.summary?.revision ?? 0,
        outboundWebhook: {
          eventTypes: resolveChatLifecycleEventTypes({
            operation: 'status_changed',
            previousStatus: currentChat.status,
            currentStatus: EChatStatus.closed,
          }),
          idempotencyKey: `schedule-chatbot-start-failed:${schedule.schedule_id}:${chat.chat_id}`,
          source: 'schedule_chatbot_compensation',
          previousChat: currentChat,
          actor: { type: 'automation' },
          changes: {
            previous_status: currentChat.status,
            status: EChatStatus.closed,
            reason: 'chatbot_start_failed_before_first_message',
            schedule_id: schedule.schedule_id,
          },
        },
      });
      if (!closed) {
        return;
      }
      closedChat = candidateClosedChat;
    } catch (error) {
      console.error(
        '[ScheduleSendService] Failed to verify or close a failed chatbot start safely',
        {
          schedule_id: schedule.schedule_id,
          chat_id: chat.chat_id,
          error,
        }
      );
      return;
    }

    if (!closedChat) {
      return;
    }

    try {
      await Promise.all([
        this.chatService.invalidateChatCache(closedChat),
        this.chatbotFlowRunnerService.clearFlowCacheForChat(
          closedChat.account.id,
          closedChat.worker.id,
          closedChat.chat_id
        ),
      ]);
    } catch (error) {
      console.error(
        '[ScheduleSendService] Failed to clear caches after closing an empty failed chatbot chat',
        {
          schedule_id: schedule.schedule_id,
          chat_id: chat.chat_id,
          error,
        }
      );
    }
  }

  private async runScheduleChatbotFlow(
    t: ReturnType<typeof i18next.t>,
    minimalData: IUpsertMessage,
    chat: IChat,
    chatbotId: string,
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    messageId?: string
  ): Promise<IScheduleMessageResult | null> {
    try {
      await this.chatbotFlowRunnerService.execute(
        t,
        minimalData,
        chat,
        chatbotId,
        ['chatbot', 'schedule']
      );
      return null;
    } catch (err) {
      console.error(
        `[ScheduleSendService] Chatbot flow error schedule=${schedule.schedule_id} contact=${contact.contact_id}:`,
        err
      );
      await this.compensateScheduleChatbotStartFailure(schedule, chat);
      return this.reportScheduleChatbotFailure(
        schedule,
        contact,
        EScheduleStatus.failed,
        messageId
      );
    }
  }

  private buildScheduleChatbotSyntheticMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string,
    now: string,
    messageId?: string
  ): IChatMessage {
    const phoneFromJid = getPhoneFromJid(jid, null);
    const extractedFromJid = phoneFromJid
      ? extractPhoneAndDdi(phoneFromJid)
      : null;
    const phone = extractedFromJid?.phone
      ? extractedFromJid.phone
      : (this.contactService.getContactPhoneDecrypted(contact.phone) ?? '');
    const phoneDdi =
      extractedFromJid?.phone_ddi ?? this.normalizePhoneDdi(contact.phone_ddi);

    const message: IChatMessage = {
      message_id: messageId ?? uuidv7(),
      chat_id: `${schedule.account_id}:${jid}`,
      message_key: {
        remote_jid: jid,
        remote_jid_alt: null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.system,
      sent_from_platform: true,
      account: { id: schedule.account_id, name: schedule.account_name },
      worker: this.buildScheduleWorker(schedule),
      user: null,
      phone,
      phone_ddi: phoneDdi,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: true,
      },
      deleted: false,
      has_quoted: false,
      date: now,
      hash: null,
      content: { type: EMessageType.text, message: '' },
    };

    ensureMessageSendHash(message);
    return message;
  }

  private async persistScheduleChatbotSyntheticMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    syntheticMessage: IChatMessage,
    status: EScheduleStatus.sent | EScheduleStatus.processed
  ): Promise<void> {
    const saved = await this.saveToElasticsearch(
      schedule,
      contact,
      syntheticMessage,
      status
    );
    if (!saved) {
      console.error(
        `Failed to save schedule chatbot to Elasticsearch schedule=${schedule.schedule_id} contact=${contact.contact_id}`
      );
    }
  }

  private async sendScheduleChatbot(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string,
    messageId?: string
  ): Promise<IScheduleMessageResult> {
    if (!schedule.chatbot_id) {
      return this.reportScheduleChatbotFailure(
        schedule,
        contact,
        EScheduleStatus.failed,
        messageId
      );
    }

    const chatbotId = schedule.chatbot_id;

    const hasLimit = await this.checkMassSendingLimit(schedule.account_id, 1);
    if (!hasLimit) {
      return this.reportScheduleChatbotFailure(
        schedule,
        contact,
        EScheduleStatus.limit_exhausted,
        messageId
      );
    }

    const phoneFromJid = getPhoneFromJid(jid, null);
    const decrypted = this.contactService.getContactPhoneDecrypted(
      contact.phone
    );
    const ddi = this.normalizePhoneDdi(contact.phone_ddi);
    const phoneFromContact = decrypted ? `${ddi}${decrypted}` : null;
    const phone = phoneFromJid ?? phoneFromContact;
    const identityInput = { phone, remoteJid: jid };
    const existingChat = await this.chatService.findOpenChatByIdentity(
      schedule.account_id,
      schedule.worker_id,
      identityInput
    );

    if (existingChat) {
      return this.reportScheduleChatbotIgnored(schedule, contact, messageId);
    }

    const lockKey = buildChatIdentityLockKey(
      schedule.account_id,
      schedule.worker_id,
      identityInput
    );

    return withLock(
      this.redis,
      lockKey,
      async () => {
        const existingChat = await this.chatService.findOpenChatByIdentity(
          schedule.account_id,
          schedule.worker_id,
          identityInput
        );

        if (existingChat) {
          return this.reportScheduleChatbotIgnored(
            schedule,
            contact,
            messageId
          );
        }

        const now = new Date().toISOString();
        const chat = this.buildScheduleChatbotChat(schedule, contact, jid, now);
        const chatWithProtocol =
          await this.chatService.ensureProtocolForNewChat(chat);

        const savedChat = await this.chatService.saveChat(chatWithProtocol, {
          refresh: true,
          outboundWebhook: {
            eventTypes: [
              'chat.created',
              'chat.automation.started',
              ...(chatWithProtocol.protocol_start?.length
                ? (['chat.protocol.updated'] as const)
                : []),
            ],
            idempotencyKey: `schedule-chat-created:${schedule.schedule_id}:${contact.contact_id}:${chatWithProtocol.chat_id}`,
            source: 'schedule_chatbot',
            previousChat: null,
            actor: { type: 'automation' },
            changes: {
              initial_status: chatWithProtocol.status,
              schedule_id: schedule.schedule_id,
            },
          },
        });
        if (!savedChat) {
          return this.reportScheduleChatbotFailure(
            schedule,
            contact,
            EScheduleStatus.failed,
            messageId
          );
        }

        const t = i18next.t.bind(i18next);
        const minimalData = this.buildScheduleChatbotMinimalData(schedule, jid);

        const flowFailure = await this.runScheduleChatbotFlow(
          t,
          minimalData,
          chatWithProtocol,
          chatbotId,
          schedule,
          contact,
          messageId
        );
        if (flowFailure) {
          return flowFailure;
        }

        const syntheticMessage = this.buildScheduleChatbotSyntheticMessage(
          schedule,
          contact,
          jid,
          now,
          messageId
        );
        await this.persistScheduleChatbotSyntheticMessage(
          schedule,
          contact,
          syntheticMessage,
          EScheduleStatus.sent
        );

        return { success: true, contactId: contact.contact_id };
      },
      { ttlMs: 300000, retryMs: 500 }
    );
  }

  private async checkMassSendingLimit(
    accountId: string,
    currentSentCount: number
  ): Promise<boolean> {
    const [limit, totalSent] = await Promise.all([
      this.planAccountService.totalMassSendingLimitByAccountId(accountId),
      this.planAccountService.getMassSendingTotal(accountId),
    ]);

    const totalAfterSend = totalSent + currentSentCount;

    return totalAfterSend < limit;
  }

  private async sendScheduleMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    options?: {
      skipAlreadySentCheck?: boolean;
      skipDuplicateCheck?: boolean;
      messageId?: string;
      overrideDocumentOnConflict?: boolean;
    }
  ): Promise<IScheduleMessageResult> {
    const attemptId = uuidv7();

    if (!options?.skipAlreadySentCheck) {
      const alreadySent = await this.checkMessageSent(
        schedule.schedule_id,
        contact.contact_id
      );

      if (alreadySent) {
        return {
          success: false,
          contactId: contact.contact_id,
        };
      }
    }

    if (!options?.skipDuplicateCheck) {
      const canSend = await this.checkAndSetDuplicate(
        schedule.schedule_id,
        contact.contact_id
      );

      if (!canSend) {
        return {
          success: false,
          contactId: contact.contact_id,
        };
      }
    }

    let jid = await this.validateContactPhone(contact);
    const isOfficialWorker = isOfficialWhatsappWorker(schedule.worker_type_id);

    if (isOfficialWorker && !contact.is_validated) {
      const updated = await this.contactService.updateContactIsValided(
        contact.contact_id,
        true,
        undefined,
        undefined,
        CONTACT_VALIDATION_ORIGINS.officialAssumed
      );
      if (updated) {
        contact.is_validated = true;
        contact.validation_origin = CONTACT_VALIDATION_ORIGINS.officialAssumed;
      } else {
        jid = null;
      }
    }

    if (
      !isOfficialWorker &&
      (schedule.type === EScheduleType.chatbot ||
        contact.validation_origin ===
          CONTACT_VALIDATION_ORIGINS.officialAssumed)
    ) {
      jid = await this.resolveChatbotValidatedJid(schedule, contact, jid);
    }

    if (schedule.type === EScheduleType.chatbot) {
      if (!jid) {
        return this.reportScheduleChatbotIgnored(
          schedule,
          contact,
          options?.messageId
        );
      }

      return this.sendScheduleChatbot(
        schedule,
        contact,
        jid,
        options?.messageId
      );
    }

    if (!jid) {
      const failedMessage = this.createFailedMessage(
        schedule,
        options?.messageId
      );
      const saved = await this.saveToElasticsearch(
        schedule,
        contact,
        failedMessage,
        EScheduleStatus.failed,
        {
          overrideOnConflict: options?.overrideDocumentOnConflict,
          attemptId,
          resetStatusIdentity: true,
        }
      );

      if (!saved) {
        console.error(
          `Failed to save failed message to Elasticsearch for schedule ${schedule.schedule_id}, contact ${contact.contact_id}`
        );
      }

      return {
        success: false,
        contactId: contact.contact_id,
      };
    }

    const message = await this.createChatMessage(
      schedule,
      contact,
      jid,
      options?.messageId
    );

    try {
      const hasLimit = await this.checkMassSendingLimit(schedule.account_id, 1);

      if (!hasLimit) {
        console.error(
          '[ScheduleSendService] Limite de envio em massa excedido',
          {
            scheduleId: schedule.schedule_id,
            accountId: schedule.account_id,
          }
        );
        const saved = await this.saveToElasticsearch(
          schedule,
          contact,
          message,
          EScheduleStatus.limit_exhausted,
          {
            overrideOnConflict: options?.overrideDocumentOnConflict,
            attemptId,
            resetStatusIdentity: true,
          }
        );

        if (!saved) {
          console.error(
            `Failed to save limit exhausted message to Elasticsearch for schedule ${schedule.schedule_id}, contact ${contact.contact_id}`
          );
        }

        return {
          success: false,
          contactId: contact.contact_id,
        };
      }

      const queued =
        await this.scheduleStatusCoordinationService.queueMessageAttempt({
          scheduleId: schedule.schedule_id,
          accountId: schedule.account_id,
          workerId: message.worker.id,
          messageId: message.message_id,
          attemptId,
        });
      if (queued !== 'queued') {
        console.info(
          '[ScheduleSendService] Schedule message attempt is already active',
          {
            schedule_id: schedule.schedule_id,
            message_id: message.message_id,
            attempt_id: attemptId,
            state: queued,
          }
        );
        return {
          success: false,
          contactId: contact.contact_id,
        };
      }

      const saved = await this.saveToElasticsearch(
        schedule,
        contact,
        message,
        EScheduleStatus.processing,
        {
          overrideOnConflict: options?.overrideDocumentOnConflict,
          attemptId,
          resetStatusIdentity: true,
        }
      );

      if (!saved) {
        console.error(
          `Failed to save message to Elasticsearch for schedule ${schedule.schedule_id}, contact ${contact.contact_id}`
        );
        return {
          success: false,
          contactId: contact.contact_id,
        };
      }

      await this.sendMessageToKafka(schedule, contact, message, attemptId);

      return {
        success: true,
        contactId: contact.contact_id,
      };
    } catch (error) {
      console.error(
        `Error sending message to Kafka for schedule ${schedule.schedule_id}, contact ${contact.contact_id}:`,
        error
      );

      const terminalStatePersisted = await this.saveToElasticsearch(
        schedule,
        contact,
        message,
        EScheduleStatus.failed,
        {
          overrideOnConflict: true,
          attemptId,
          resetStatusIdentity: true,
        }
      );

      if (terminalStatePersisted) {
        const claimCompleted = await this.scheduleStatusCoordinationService
          .completeQueuedMessageAttempt({
            scheduleId: schedule.schedule_id,
            messageId: message.message_id,
            attemptId,
          })
          .catch((claimError) => {
            console.error(
              '[ScheduleSendService] Failed to complete persisted terminal schedule attempt',
              {
                schedule_id: schedule.schedule_id,
                message_id: message.message_id,
                attempt_id: attemptId,
                error: claimError,
              }
            );
            return false;
          });

        if (!claimCompleted) {
          console.warn(
            '[ScheduleSendService] Terminal state persisted but queued attempt remains recoverable',
            {
              schedule_id: schedule.schedule_id,
              message_id: message.message_id,
              attempt_id: attemptId,
            }
          );
        }
      } else {
        console.error(
          '[ScheduleSendService] Terminal state was not persisted; queued attempt remains recoverable',
          {
            schedule_id: schedule.schedule_id,
            message_id: message.message_id,
            attempt_id: attemptId,
          }
        );
      }

      return {
        success: false,
        contactId: contact.contact_id,
      };
    }
  }

  private async processContactsWithControl(
    schedule: ISchedulePendingData,
    contacts: IScheduleContactValidated[]
  ): Promise<{
    results: IScheduleMessageResult[];
    interrupted: boolean;
  }> {
    const allResults: IScheduleMessageResult[] = [];

    for (const contact of contacts) {
      const alreadySent = await this.checkMessageSent(
        schedule.schedule_id,
        contact.contact_id
      );
      if (alreadySent) {
        continue;
      }

      const canContinue = await this.canContinueScheduleProcessing(
        schedule.schedule_id
      );
      if (!canContinue) {
        return {
          results: allResults,
          interrupted: true,
        };
      }

      const canDispatch = isOfficialWhatsappWorker(schedule.worker_type_id)
        ? await this.canContinueScheduleProcessing(schedule.schedule_id)
        : await this.waitForDispatchWindow(
            schedule.schedule_id,
            schedule.send_speed
          );
      if (!canDispatch) {
        return {
          results: allResults,
          interrupted: true,
        };
      }

      const result = await this.sendScheduleMessage(schedule, contact, {
        skipAlreadySentCheck: true,
      });
      allResults.push(result);

      const canContinueAfterSend = await this.canContinueScheduleProcessing(
        schedule.schedule_id
      );
      if (!canContinueAfterSend) {
        return {
          results: allResults,
          interrupted: true,
        };
      }
    }

    return {
      results: allResults,
      interrupted: false,
    };
  }

  private async assertOfficialChatbotScheduleCanExecute(
    schedule: ISchedulePendingData
  ): Promise<void> {
    if (
      schedule.type !== EScheduleType.chatbot ||
      !isOfficialWhatsappWorker(schedule.worker_type_id)
    ) {
      return;
    }

    const t = i18next.t.bind(i18next);
    if (!schedule.chatbot_id) {
      throw new Error(t('schedule_chatbot_required'));
    }

    await this.scheduleOfficialMessageService.assertOfficialScheduleChatbotStart(
      {
        t,
        accountId: schedule.account_id,
        workerId: schedule.worker_id,
        chatbotId: schedule.chatbot_id,
      }
    );
  }

  private async hasAnyQueuedMessageForSchedule(
    scheduleId: string
  ): Promise<boolean> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const query = {
      size: 0,
      query: {
        bool: {
          must: [
            {
              term: {
                schedule_id: scheduleId,
              },
            },
            {
              terms: {
                status: [EScheduleStatus.processing, EScheduleStatus.sent],
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      hits: { total: { value: number } | number };
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return false;
    }

    const total = result.hits.total as { value: number } | number;
    if (typeof total === 'number') {
      return total > 0;
    }

    return total.value > 0;
  }

  private async determineScheduleStatus(
    scheduleId: string,
    results: IScheduleMessageResult[]
  ): Promise<EScheduleStatus> {
    if (results.some((result) => result.success)) {
      return EScheduleStatus.sent;
    }

    const hasQueuedMessages =
      await this.hasAnyQueuedMessageForSchedule(scheduleId);
    if (hasQueuedMessages) {
      return EScheduleStatus.sent;
    }

    const allFailed = results.every((r) => !r.success);
    const allSuccess = results.every((r) => r.success);

    if (allFailed) {
      return EScheduleStatus.failed;
    }

    if (allSuccess) {
      return EScheduleStatus.sent;
    }

    return EScheduleStatus.sent;
  }

  private uniqueSchedulesById(
    schedules: ISchedulePendingData[]
  ): ISchedulePendingData[] {
    const uniqueMap = new Map<string, ISchedulePendingData>();

    for (const schedule of schedules) {
      if (!uniqueMap.has(schedule.schedule_id)) {
        uniqueMap.set(schedule.schedule_id, schedule);
      }
    }

    return Array.from(uniqueMap.values());
  }

  private async processSingleSchedule(
    schedule: ISchedulePendingData
  ): Promise<void> {
    try {
      await withLock(
        this.redis,
        `schedule:process:${schedule.schedule_id}`,
        async () => {
          try {
            const currentStatus = await this.getCurrentScheduleStatus(
              schedule.schedule_id
            );
            if (!this.isExecutionAllowedStatus(currentStatus)) {
              return;
            }

            const movedToProcessing =
              await this.scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent(
                schedule.schedule_id,
                EScheduleStatus.processing,
                [EScheduleStatus.pending, EScheduleStatus.processing]
              );
            if (!movedToProcessing) {
              return;
            }

            await this.assertOfficialChatbotScheduleCanExecute(schedule);

            const contacts =
              await this.scheduleContactsValidatedListerRepository.listValidatedContactsBySchedule(
                schedule.schedule_id,
                schedule.send_to,
                schedule.account_id
              );

            if (contacts.length === 0) {
              await this.scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent(
                schedule.schedule_id,
                EScheduleStatus.failed,
                [EScheduleStatus.processing]
              );
              return;
            }

            const { results, interrupted } =
              await this.processContactsWithControl(schedule, contacts);

            if (interrupted) {
              return;
            }

            const status = await this.determineScheduleStatus(
              schedule.schedule_id,
              results
            );

            await this.scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent(
              schedule.schedule_id,
              status,
              [EScheduleStatus.processing]
            );
          } catch (error) {
            console.error(
              `Error processing schedule ${schedule.schedule_id}:`,
              error
            );

            await this.scheduleStatusUpdaterRepository.updateScheduleStatusIfCurrent(
              schedule.schedule_id,
              EScheduleStatus.failed,
              [EScheduleStatus.processing]
            );

            throw error;
          }
        },
        {
          ttlMs: 300000,
          retryMs: 500,
          maxWaitMs: 1000,
          preventDuplicate: true,
          duplicateTtlSeconds: 300,
        }
      );
    } catch (error) {
      if (error instanceof LockAcquisitionTimeoutError) {
        return;
      }

      throw error;
    }
  }

  private async reprocessFailedMessageReference(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    failedMessage: { message_id: string; contact_id: string }
  ): Promise<IScheduleMessageResult | null> {
    const lockKey = this.getMessageReprocessLockKey(
      schedule.schedule_id,
      failedMessage.message_id
    );

    try {
      return await withLock(
        this.redis,
        lockKey,
        async () => {
          const [currentFailedMessage] = await this.listFailedMessageReferences(
            schedule.schedule_id,
            schedule.account_id,
            failedMessage.message_id
          );

          if (
            !currentFailedMessage ||
            currentFailedMessage.contact_id !== contact.contact_id
          ) {
            return null;
          }

          const replacementMessageId = uuidv7();
          const claimed = await this.markFailedMessageAsReprocessed(
            schedule.schedule_id,
            schedule.account_id,
            failedMessage.contact_id,
            failedMessage.message_id,
            replacementMessageId
          );

          if (!claimed) {
            return null;
          }

          await this.clearDuplicateLock(
            schedule.schedule_id,
            failedMessage.contact_id
          );

          return this.sendScheduleMessage(schedule, contact, {
            skipAlreadySentCheck: true,
            messageId: replacementMessageId,
          });
        },
        {
          ttlMs: 300000,
          retryMs: 100,
          maxWaitMs: 1000,
        }
      );
    } catch (error) {
      if (error instanceof LockAcquisitionTimeoutError) {
        return null;
      }

      throw error;
    }
  }

  async reprocessFailedMessages(
    scheduleId: string,
    accountId: string
  ): Promise<{
    total: number;
    reprocessed: number;
  }> {
    const schedule =
      await this.schedulePendingListerRepository.viewScheduleById(scheduleId);

    if (!schedule || schedule.account_id !== accountId) {
      return {
        total: 0,
        reprocessed: 0,
      };
    }

    await this.assertOfficialChatbotScheduleCanExecute(schedule);

    const failedMessages = await this.listFailedMessageReferences(
      scheduleId,
      accountId
    );

    if (!failedMessages.length) {
      return {
        total: 0,
        reprocessed: 0,
      };
    }

    const targetContactIds = new Set(
      failedMessages.map((item) => item.contact_id)
    );

    const contacts =
      await this.scheduleContactsValidatedListerRepository.listValidatedContactsBySchedule(
        scheduleId,
        schedule.send_to,
        accountId
      );

    const contactsById = new Map(
      contacts
        .filter((contact) => targetContactIds.has(contact.contact_id))
        .map((contact) => [contact.contact_id, contact])
    );

    let reprocessed = 0;

    for (const failedMessage of failedMessages) {
      const contact = contactsById.get(failedMessage.contact_id);
      if (!contact) {
        continue;
      }

      const result = await this.reprocessFailedMessageReference(
        schedule,
        contact,
        failedMessage
      );

      if (result?.success) {
        reprocessed++;
      }
    }

    return {
      total: failedMessages.length,
      reprocessed,
    };
  }

  async reprocessScheduleMessage(
    scheduleId: string,
    messageId: string,
    accountId: string
  ): Promise<boolean> {
    const schedule =
      await this.schedulePendingListerRepository.viewScheduleById(scheduleId);

    if (!schedule || schedule.account_id !== accountId) {
      return false;
    }

    await this.assertOfficialChatbotScheduleCanExecute(schedule);

    const [failedMessage] = await this.listFailedMessageReferences(
      scheduleId,
      accountId,
      messageId
    );

    if (!failedMessage) {
      return false;
    }

    const contacts =
      await this.scheduleContactsValidatedListerRepository.listValidatedContactsBySchedule(
        scheduleId,
        schedule.send_to,
        accountId
      );

    const contact = contacts.find(
      (item) => item.contact_id === failedMessage.contact_id
    );

    if (!contact) {
      return false;
    }

    const result = await this.reprocessFailedMessageReference(
      schedule,
      contact,
      failedMessage
    );

    return result?.success ?? false;
  }

  async processScheduleById(scheduleId: string): Promise<void> {
    const schedule =
      await this.schedulePendingListerRepository.listPendingScheduleById(
        scheduleId
      );

    if (!schedule) {
      return;
    }

    await this.processSingleSchedule(schedule);
  }

  async processSchedules(): Promise<void> {
    const schedules =
      await this.schedulePendingListerRepository.listPendingSchedules();
    const uniqueSchedules = this.uniqueSchedulesById(schedules);

    const results = await Promise.allSettled(
      uniqueSchedules.map((schedule) => this.processSingleSchedule(schedule))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Error in schedule batch processing:', result.reason);
      }
    }
  }
}
