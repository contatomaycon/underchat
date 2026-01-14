import { inject, injectable } from 'tsyringe';
import { SchedulePendingListerRepository } from '@core/repositories/schedule/SchedulePendingLister.repository';
import { ScheduleContactsValidatedListerRepository } from '@core/repositories/schedule/ScheduleContactsValidatedLister.repository';
import { ScheduleStatusUpdaterRepository } from '@core/repositories/schedule/ScheduleStatusUpdater.repository';
import { ContactService } from './contact.service';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { KafkaBaileysQueueService } from './kafkaBaileysQueue.service';
import { StreamProducerService } from './streamProducer.service';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { v7 as uuidv7 } from 'uuid';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';
import { ISchedulePendingData } from '@core/interfaces/repositories/schedule/ISchedulePendingData';
import { IScheduleMessageResult } from '@core/common/interfaces/IScheduleMessageResult';
import { IScheduleContactValidated } from '@core/common/interfaces/IScheduleContactValidated';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import { PlanAccountService } from './planAccount.service';
import moment from 'moment-timezone';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import {
  ScheduleDocument,
  ScheduleCreateResult,
  SchedulePatchScriptParams,
} from '@core/common/interfaces/IScheduleDocument';

@injectable()
export class ScheduleSendService {
  private readonly BATCH_SIZE = 10;
  private readonly DELAY_MIN_MS = 5000;
  private readonly DELAY_MAX_MS = 20000;

  private readonly BRAZIL_TIMEZONE = 'America/Sao_Paulo';

  constructor(
    private readonly schedulePendingListerRepository: SchedulePendingListerRepository,
    private readonly scheduleContactsValidatedListerRepository: ScheduleContactsValidatedListerRepository,
    private readonly scheduleStatusUpdaterRepository: ScheduleStatusUpdaterRepository,
    private readonly contactService: ContactService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly planAccountService: PlanAccountService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private getRandomDelay(): number {
    const random = Math.random(); // NOSONAR: Math.random() is safe here as it's only used for non-security purposes (message timing)

    return Math.floor(
      random * (this.DELAY_MAX_MS - this.DELAY_MIN_MS) + this.DELAY_MIN_MS
    );
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
    const exists = await this.redis.get(lockKey);

    if (exists) {
      return false;
    }

    await this.redis.set(lockKey, '1', 'EX', 86400);
    return true;
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

  private async createTextMessage(
    schedule: ISchedulePendingData,
    baseMessage: IChatMessage,
    contact: IScheduleContactValidated
  ): Promise<IChatMessage> {
    const message = await this.replaceTags(schedule.message, schedule, contact);

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

    const message = await this.replaceTags(schedule.message, schedule, contact);

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

    const message = await this.replaceTags(schedule.message, schedule, contact);

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

  private createBaseMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string
  ): IChatMessage {
    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    const now = new Date().toISOString();
    const delay = this.getRandomDelay();

    return {
      message_id: uuidv7(),
      chat_id: `${schedule.account_id}:${jid}`,
      message_key: {
        remote_jid: jid,
        remote_jid_alt: null,
        is_view_once: false,
      },
      type_user: ETypeUserChat.system,
      account: {
        id: schedule.account_id,
        name: schedule.account_name,
      },
      worker: {
        id: schedule.worker_id,
        name: schedule.worker_name,
      },
      user: null,
      phone: phone ?? '',
      phone_ddi: contact.phone_ddi ?? null,
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
      send_delay_ms: delay,
    };
  }

  private async createChatMessage(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    jid: string
  ): Promise<IChatMessage> {
    const baseMessage = this.createBaseMessage(schedule, contact, jid);

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

  private createFailedMessage(schedule: ISchedulePendingData): IChatMessage {
    return {
      message_id: uuidv7(),
      chat_id: '',
      message_key: null,
      type_user: ETypeUserChat.system,
      account: {
        id: schedule.account_id,
        name: schedule.account_name,
      },
      worker: {
        id: schedule.worker_id,
        name: schedule.worker_name,
      },
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
    status: EScheduleStatus | string
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
      const jid = normalizePhoneToJid(phone, contact.phone_ddi);
      const now = new Date().toISOString();

      const document: ScheduleDocument = {
        id: message.message_id,
        schedule_id: schedule.schedule_id,
        message_key: {
          remote_jid: jid ?? null,
        },
        contact: {
          id: contact.contact_id,
          name: contact.name,
          phone: phone ?? null,
          phone_ddi: contact.phone_ddi ?? null,
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
        status,
        send_date: new Date(schedule.send_date).toISOString(),
        send_log: null,
        created_at: now,
        updated_at: now,
      };

      const createResult = await this.createScheduleIdempotent(
        document,
        message.message_id
      );

      if (createResult.created) {
        return true;
      }

      const patchParams = this.buildPatchScheduleMissingFieldsParams(document);
      return await this.patchExistingScheduleMissingFields(
        message.message_id,
        patchParams.patch
      );
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
    message: IChatMessage
  ): Promise<void> {
    const scheduleMessage: IScheduleMessage = {
      schedule_id: schedule.schedule_id,
      contact_id: contact.contact_id,
      message,
      is_validated: contact.is_validated,
    };

    const workerId = message.worker.id;
    const topic = this.kafkaBaileysQueueService.workerSendMessage(workerId);

    await this.streamProducerService.send(topic, scheduleMessage);
  }

  private async validateContactPhone(
    contact: IScheduleContactValidated
  ): Promise<string | null> {
    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    if (!phone) return null;

    const jid = normalizePhoneToJid(phone, contact.phone_ddi);
    if (!jid) return null;

    return jid;
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
    contact: IScheduleContactValidated
  ): Promise<IScheduleMessageResult> {
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

    const jid = await this.validateContactPhone(contact);

    if (!jid) {
      const failedMessage = this.createFailedMessage(schedule);
      const saved = await this.saveToElasticsearch(
        schedule,
        contact,
        failedMessage,
        EScheduleStatus.failed
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

    const message = await this.createChatMessage(schedule, contact, jid);

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
          EScheduleStatus.limit_exhausted
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

      const saved = await this.saveToElasticsearch(
        schedule,
        contact,
        message,
        EScheduleStatus.processing
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

      await this.sendMessageToKafka(schedule, contact, message);

      return {
        success: true,
        contactId: contact.contact_id,
      };
    } catch (error) {
      console.error(
        `Error sending message to Kafka for schedule ${schedule.schedule_id}, contact ${contact.contact_id}:`,
        error
      );

      await this.saveToElasticsearch(
        schedule,
        contact,
        message,
        EScheduleStatus.failed
      );

      return {
        success: false,
        contactId: contact.contact_id,
      };
    }
  }

  private async processContactsWithDelay(
    schedule: ISchedulePendingData,
    contacts: IScheduleContactValidated[]
  ): Promise<IScheduleMessageResult[]> {
    const results: IScheduleMessageResult[] = [];

    for (const contact of contacts) {
      const result = await this.sendScheduleMessage(schedule, contact);
      results.push(result);
    }

    return results;
  }

  private async processContactsInBatches(
    schedule: ISchedulePendingData,
    contacts: IScheduleContactValidated[]
  ): Promise<IScheduleMessageResult[]> {
    const allResults: IScheduleMessageResult[] = [];

    for (const contact of contacts) {
      const result = await this.sendScheduleMessage(schedule, contact);
      allResults.push(result);
    }

    return allResults;
  }

  private determineScheduleStatus(
    results: IScheduleMessageResult[]
  ): EScheduleStatus {
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

  private async processSingleSchedule(
    schedule: ISchedulePendingData
  ): Promise<void> {
    await withLock(
      this.redis,
      `schedule:process:${schedule.schedule_id}`,
      async () => {
        try {
          await this.scheduleStatusUpdaterRepository.updateScheduleStatus(
            schedule.schedule_id,
            EScheduleStatus.processing
          );

          const contacts =
            await this.scheduleContactsValidatedListerRepository.listValidatedContactsBySchedule(
              schedule.schedule_id,
              schedule.send_to,
              schedule.account_id
            );

          if (contacts.length === 0) {
            await this.scheduleStatusUpdaterRepository.updateScheduleStatus(
              schedule.schedule_id,
              EScheduleStatus.failed
            );
            return;
          }

          const results =
            contacts.length <= this.BATCH_SIZE
              ? await this.processContactsWithDelay(schedule, contacts)
              : await this.processContactsInBatches(schedule, contacts);

          const status = this.determineScheduleStatus(results);

          await this.scheduleStatusUpdaterRepository.updateScheduleStatus(
            schedule.schedule_id,
            status
          );
        } catch (error) {
          console.error(
            `Error processing schedule ${schedule.schedule_id}:`,
            error
          );

          await this.scheduleStatusUpdaterRepository.updateScheduleStatus(
            schedule.schedule_id,
            EScheduleStatus.failed
          );

          throw error;
        }
      },
      {
        ttlMs: 300000,
        retryMs: 500,
      }
    );
  }

  async processSchedules(): Promise<void> {
    const schedules =
      await this.schedulePendingListerRepository.listPendingSchedules();

    await Promise.all(
      schedules.map((schedule) => this.processSingleSchedule(schedule))
    );
  }
}
