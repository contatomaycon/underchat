import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IUserPhoneJidUpdate } from '@core/common/interfaces/IUserPhoneJidUpdate';
import { UserService } from '@core/services/user.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class UserPhoneJidUpdateConsume {
  private consumer: Consumer | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly userService: UserService
  ) {}

  private get consumerOrThrow(): Consumer {
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
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-user-phone-jid-update'
    );

    const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const offset = message.offset;

        this.processingChain = this.processingChain.then(async () => {
          const stop = startHeartbeat(heartbeat);

          try {
            await this.processUpdate(data);
          } catch (error) {
            console.error('Erro ao atualizar phone_jid:', error);
            await this.commitNext(topic, partition, message.offset);
          } finally {
            stop();
          }

          await this.commitNext(topic, partition, offset);
        });
      },
    });
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

  public async close(): Promise<void> {
    await this.processingChain;

    if (!this.consumer) {
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
  }
}
