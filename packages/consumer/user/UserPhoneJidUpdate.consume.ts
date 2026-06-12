import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IUserPhoneJidUpdate } from '@core/common/interfaces/IUserPhoneJidUpdate';
import { UserService } from '@core/services/user.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class UserPhoneJidUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUserPhoneJidUpdate> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(UserService)
    private readonly userService: UserService
  ) {}

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

    const topic = this.kafkaBaileysQueueService.userPhoneJidUpdate();
    this.runner = new KafkaConsumerRunner<IUserPhoneJidUpdate>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-user-phone-jid-update',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.user_id,
      handle: async (data) => {
        try {
          await this.processUpdate(data);
        } catch (error) {
          console.error('Erro ao atualizar phone_jid:', error);
        }
      },
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }
}
