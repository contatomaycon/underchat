import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';
import { BaileysPhoneValidationService } from '@core/services/baileys/methods/phoneValidation.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

@singleton()
export class NotificationMessageSendConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly baileysPhoneValidationService: BaileysPhoneValidationService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    try {
      const workerId = baileysEnvironment.baileysWorkerId;
      const groupId = `group-underchat-baileys-notification-send-${workerId}`;
      const topic =
        this.kafkaBaileysQueueService.workerNotificationMessage(workerId);

      this.consumer = createConsumer(this.kafka, groupId);

      await ensureKafkaTopic(this.kafka, topic);

      this.consumer.on('data', async (message) => {
        const data = this.parseNotificationMessage(message.value);

        if (!data) {
          await this.commitNext(topic, message.partition, message.offset);
          return;
        }

        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);
        try {
          await this.processNotificationMessage(data);
        } catch (error) {
          console.error('Erro ao processar mensagem:', error);
          stop();
          await this.commitNext(topic, message.partition, message.offset);
          return;
        } finally {
          stop();
        }

        stop();
        await this.commitNext(topic, message.partition, message.offset);
      });

      this.consumer.on('event.error', (err) => {
        console.error('Consumer error:', err);
      });

      this.consumer.subscribe([topic]);

      await new Promise<void>((resolve, reject) => {
        const consumer = this.consumer;
        if (!consumer) {
          reject(new Error('Consumer not initialized'));
          return;
        }
        consumer.connect({}, (err) => {
          if (err) {
            reject(err);
            return;
          }
          consumer.consume();
          this.isRunning = true;
          resolve();
        });
      });
    } catch (error) {
      console.error('Erro ao executar NotificationMessageSendConsume:', error);
      this.consumer = null;
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
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

  private async sendPhoneJidUpdateRequest(
    userId: string,
    phoneJid: string
  ): Promise<void> {
    try {
      const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();

      await this.streamProducerService.send(topic, {
        user_id: userId,
        phone_jid: phoneJid,
      });
    } catch (error) {
      console.error('Erro ao enviar atualização de phone_jid:', error);
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
  }
}
