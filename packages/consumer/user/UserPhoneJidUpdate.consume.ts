import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IUserPhoneJidUpdate } from '@core/common/interfaces/IUserPhoneJidUpdate';
import { UserService } from '@core/services/user.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class UserPhoneJidUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly userService: UserService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IUserPhoneJidUpdate | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(value.toString()) as IUserPhoneJidUpdate;

      if (
        'user_id' in parsed &&
        'phone_jid' in parsed &&
        typeof parsed.user_id === 'string' &&
        typeof parsed.phone_jid === 'string'
      ) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async processUpdate(data: IUserPhoneJidUpdate): Promise<void> {
    await this.userService.updateUserPhoneJid(data.user_id, data.phone_jid);
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-user-phone-jid-update'
    );

    const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();

    await ensureKafkaTopic(this.kafka, topic);

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const offset = message.offset;

      this.processingChain = this.processingChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.processUpdate(data);
        } catch (error) {
          console.error('Erro ao atualizar phone_jid:', error);
          await this.commitNext(topic, message.partition, message.offset);
        } finally {
          stop();
        }

        await this.commitNext(topic, message.partition, offset);
      });
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
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        consumer.consume();
        this.isRunning = true;
        resolve();
      });
    });
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

  public async close(): Promise<void> {
    await this.processingChain;

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
}
