import { inject, injectable } from 'tsyringe';
import { SchedulePendingListerRepository } from '@core/repositories/schedule/SchedulePendingLister.repository';
import { ScheduleContactsValidatedListerRepository } from '@core/repositories/schedule/ScheduleContactsValidatedLister.repository';
import { ScheduleStatusUpdaterRepository } from '@core/repositories/schedule/ScheduleStatusUpdater.repository';
import { ContactService } from './contact.service';
import { ChatService } from './chat.service';
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
import moment from 'moment-timezone';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

@injectable()
export class ScheduleSendService {
  private readonly BATCH_SIZE = 10;
  private readonly DELAY_MIN_MS = 1000;
  private readonly DELAY_MAX_MS = 4000;

  private readonly BRAZIL_TIMEZONE = 'America/Sao_Paulo';

  constructor(
    private readonly schedulePendingListerRepository: SchedulePendingListerRepository,
    private readonly scheduleContactsValidatedListerRepository: ScheduleContactsValidatedListerRepository,
    private readonly scheduleStatusUpdaterRepository: ScheduleStatusUpdaterRepository,
    private readonly contactService: ContactService,
    private readonly chatService: ChatService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private getRandomDelay(): number {
    return Math.floor(
      Math.random() * (this.DELAY_MAX_MS - this.DELAY_MIN_MS) +
        this.DELAY_MIN_MS
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

  private async getProtocol(
    accountId: string,
    workerId: string,
    phone: string
  ): Promise<string> {
    const chat = await this.chatService.findChatByPhone(
      accountId,
      workerId,
      phone
    );

    if (!chat) {
      return '';
    }

    if (chat.protocol_start && chat.protocol_start.length > 0) {
      return chat.protocol_start[chat.protocol_start.length - 1];
    }

    if (chat.protocol_transfer && chat.protocol_transfer.length > 0) {
      return chat.protocol_transfer[chat.protocol_transfer.length - 1];
    }

    if (chat.protocol_ura && chat.protocol_ura.length > 0) {
      return chat.protocol_ura[chat.protocol_ura.length - 1];
    }

    return '';
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
    const protocol = await this.getProtocol(
      schedule.account_id,
      schedule.worker_id,
      phone ?? ''
    );

    let replaced = message;

    replaced = replaced.replace(/\{\{ greeting \}\}/g, greeting);
    replaced = replaced.replace(/\{\{ name \}\}/g, contact.name || '');
    replaced = replaced.replace(/\{\{ protocol \}\}/g, protocol);
    replaced = replaced.replace(/\{\{ date \}\}/g, date);
    replaced = replaced.replace(/\{\{ time \}\}/g, time);
    replaced = replaced.replace(
      /\{\{ account_name \}\}/g,
      schedule.account_name
    );
    replaced = replaced.replace(/\{\{ phone \}\}/g, phoneFormatted);
    replaced = replaced.replace(
      /\{\{ channel_name \}\}/g,
      schedule.worker_name
    );

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

  private async saveToElasticsearch(
    schedule: ISchedulePendingData,
    contact: IScheduleContactValidated,
    message: IChatMessage,
    status: string
  ): Promise<boolean> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);
    const jid = normalizePhoneToJid(phone, contact.phone_ddi);

    const document = {
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
      type: schedule.type,
      message: message.content?.message || schedule.message,
      url: schedule.url,
      status,
      send_date: new Date(schedule.send_date).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return this.elasticDatabaseService.update(
      EElasticIndex.schedule,
      document,
      message.message_id
    );
  }

  private async sendMessageToKafka(
    message: IChatMessage,
    workerId: string
  ): Promise<void> {
    const topic = this.kafkaBaileysQueueService.workerSendMessage(workerId);
    await this.streamProducerService.send(topic, message);
  }

  private async validateContactPhone(
    contact: IScheduleContactValidated
  ): Promise<string | null> {
    const phone = this.contactService.getContactPhoneDecrypted(contact.phone);

    if (!phone) {
      return null;
    }

    const jid = normalizePhoneToJid(phone, contact.phone_ddi);

    if (!jid) {
      return null;
    }

    return jid;
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
        'failed'
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
      await this.sendMessageToKafka(message, schedule.worker_id);

      const saved = await this.saveToElasticsearch(
        schedule,
        contact,
        message,
        'sent'
      );

      if (!saved) {
        console.error(
          `Failed to save message to Elasticsearch for schedule ${schedule.schedule_id}, contact ${contact.contact_id}`
        );
      }

      return {
        success: saved,
        contactId: contact.contact_id,
      };
    } catch (error) {
      console.error(
        `Error sending message to Kafka for schedule ${schedule.schedule_id}, contact ${contact.contact_id}:`,
        error
      );

      await this.saveToElasticsearch(schedule, contact, message, 'failed');

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

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const result = await this.sendScheduleMessage(schedule, contact);
      results.push(result);

      if (i < contacts.length - 1) {
        const delay = this.getRandomDelay();
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  private async processContactsInBatches(
    schedule: ISchedulePendingData,
    contacts: IScheduleContactValidated[]
  ): Promise<IScheduleMessageResult[]> {
    const batches: IScheduleContactValidated[][] = [];

    for (let i = 0; i < contacts.length; i += this.BATCH_SIZE) {
      batches.push(contacts.slice(i, i + this.BATCH_SIZE));
    }

    const allResults: IScheduleMessageResult[] = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((contact) => this.sendScheduleMessage(schedule, contact))
      );

      allResults.push(...batchResults);

      if (batches.indexOf(batch) < batches.length - 1) {
        const delay = this.getRandomDelay();
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
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
              schedule.schedule_id
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
