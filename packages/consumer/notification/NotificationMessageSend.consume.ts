import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { Kafka, Consumer } from 'kafkajs';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { BaileysPhoneValidationService } from '@core/services/baileys/methods/phoneValidation.service';

@singleton()
export class NotificationMessageSendConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly baileysPhoneValidationService: BaileysPhoneValidationService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-notification-send-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaBaileysQueueService.workerNotificationMessage(
      baileysEnvironment.baileysWorkerId
    );

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseNotificationMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.processNotificationMessage(data);
        } catch {
          stop();
          await this.commitNext(topic, partition, message.offset);
          return;
        } finally {
          stop();
        }

        stop();
        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
  }

  private parseNotificationMessage(
    value: Buffer | null
  ): INotificationMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as INotificationMessage;
      if (
        parsed &&
        'notification_id' in parsed &&
        'message_key' in parsed &&
        'message_whatsapp' in parsed &&
        parsed.message_key?.remote_jid
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async processNotificationMessage(
    data: INotificationMessage
  ): Promise<void> {
    if (!data.message_whatsapp) return;

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

    await this.sendPhoneJidUpdateRequest(data.user_id, result.jid);
  }

  private async sendPhoneJidUpdateRequest(
    userId: string,
    phoneJid: string
  ): Promise<void> {
    try {
      const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();

      await this.kafka.producer().send({
        topic,
        messages: [
          {
            value: JSON.stringify({
              user_id: userId,
              phone_jid: phoneJid,
            }),
          },
        ],
      });
    } catch (error) {
      console.error('Erro ao enviar atualização de phone_jid:', error);
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    await this.consumerOrThrow.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + BigInt(1)).toString(),
      },
    ]);
  }
}
