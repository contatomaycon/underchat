import { singleton, inject } from 'tsyringe';
import {
  baileysEnvironment,
  generalEnvironment,
} from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { BaileysPhoneValidationService } from '@core/services/baileys/methods/phoneValidation.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class NotificationMessageSendConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<INotificationMessage> | null = null;
  private isRunning = false;
  private readonly NOTIFICATION_DEDUPE_PREFIX =
    'notification-send:idempotency:v1';
  private readonly NOTIFICATION_DEDUPE_TTL_SECONDS =
    generalEnvironment.automationSendDedupeTtlSeconds;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(BaileysMessageTextService)
    private readonly baileysMessageTextService: BaileysMessageTextService,
    @inject(BaileysPhoneValidationService)
    private readonly baileysPhoneValidationService: BaileysPhoneValidationService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    try {
      const workerId = baileysEnvironment.baileysWorkerId;
      const groupId = `group-underchat-baileys-notification-send-${workerId}`;
      const topic =
        this.kafkaBaileysQueueService.workerNotificationMessage(workerId);

      this.runner = new KafkaConsumerRunner<INotificationMessage>({
        kafka: this.kafka,
        topic,
        groupId,
        parse: (message) => this.parseNotificationMessage(message.value),
        resolveEntityKey: (data) => this.buildNotificationQueueKey(data),
        preserveEntityOrder: true,
        handle: (data) => this.processNotificationMessage(data),
        onInvalidMessage: () => {
          console.warn('Skipping invalid notification message payload');
        },
        onFailed: (_payload, _context, error) => {
          console.error('Erro ao processar mensagem:', error);
        },
        logger: console,
      });

      await this.runner.start(() => {
        this.isRunning = true;
      });
      this.consumer = this.runner.consumer;
    } catch (error) {
      console.error('Erro ao executar NotificationMessageSendConsume:', error);
      this.consumer = null;
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private parseNotificationMessage(
    value: Buffer | null
  ): INotificationMessage | null {
    if (!value) return null;

    const raw = value.toString('utf8').trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as INotificationMessage;

      if (
        parsed &&
        'notification_id' in parsed &&
        'message_key' in parsed &&
        'message_whatsapp' in parsed &&
        parsed.message_whatsapp &&
        (parsed.message_key?.remote_jid ||
          (parsed.message_key?.phone_ddi && parsed.message_key?.phone_number))
      ) {
        return parsed;
      }

      return null;
    } catch (error) {
      console.error('parseNotificationMessage: erro ao fazer parse:', error);

      return null;
    }
  }

  private async processNotificationMessage(
    data: INotificationMessage
  ): Promise<void> {
    if (!data.message_whatsapp) return;

    const claimStatus = await this.claimNotificationSendAttempt(data);
    if (claimStatus === 'duplicate') {
      return;
    }
    if (claimStatus !== 'acquired') {
      throw new Error(`notification_send_idempotency_${claimStatus}`);
    }

    if (data.message_key?.remote_jid) {
      await this.baileysMessageTextService.sendText(
        data.message_key.remote_jid,
        data.message_whatsapp
      );

      return;
    }

    const result = await this.baileysPhoneValidationService.validatePhone(
      data.message_key.phone_ddi,
      data.message_key.phone_number
    );

    if (!result.valid || !result.jid) return;

    await this.baileysMessageTextService.sendText(
      result.jid,
      data.message_whatsapp
    );

    if (data?.user_id) {
      await this.sendPhoneJidUpdateRequest(data.user_id, result.jid);
    }
  }

  private buildNotificationDestination(data: INotificationMessage): string {
    const remoteJid = data.message_key?.remote_jid?.trim();
    if (remoteJid) {
      return `jid:${remoteJid}`;
    }

    const phoneDdi = data.message_key?.phone_ddi?.trim();
    const phoneNumber = data.message_key?.phone_number?.trim();
    if (phoneDdi && phoneNumber) {
      return `phone:${phoneDdi}:${phoneNumber}`;
    }

    return '';
  }

  private buildNotificationQueueKey(data: INotificationMessage): string {
    const destination = this.buildNotificationDestination(data);
    if (destination) {
      const accountId = data.account?.id?.trim() ?? 'unknown';
      return `chat:${accountId}:${destination}`;
    }

    return this.buildNotificationDedupeKey(data);
  }

  private buildNotificationDedupeKey(data: INotificationMessage): string {
    const accountId = data.account?.id?.trim() ?? 'unknown';
    const notificationId = data.notification_id?.trim() ?? '';
    const destination = this.buildNotificationDestination(data);
    return `${this.NOTIFICATION_DEDUPE_PREFIX}:baileys:${accountId}:${notificationId}:${destination}`;
  }

  private async claimNotificationSendAttempt(
    data: INotificationMessage
  ): Promise<'acquired' | 'duplicate' | 'missing_identity' | 'error'> {
    const notificationId = data.notification_id?.trim();
    const destination = this.buildNotificationDestination(data);

    if (!notificationId || !destination) {
      return 'missing_identity';
    }

    const dedupeKey = this.buildNotificationDedupeKey(data);
    try {
      const acquired = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        this.NOTIFICATION_DEDUPE_TTL_SECONDS,
        'NX'
      );

      return acquired === 'OK' ? 'acquired' : 'duplicate';
    } catch {
      return 'error';
    }
  }

  private async sendPhoneJidUpdateRequest(
    userId: string,
    phoneJid: string
  ): Promise<void> {
    const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();

    await this.streamProducerService.send(topic, {
      user_id: userId,
      phone_jid: phoneJid,
    });
  }
}
