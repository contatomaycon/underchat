import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ConfigChannelsRecreateAllConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IConfigChannelsRecreateAllPayload> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ChannelsRecreatorAllUseCase)
    private readonly channelsRecreatorAllUseCase: ChannelsRecreatorAllUseCase,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();
    this.runner = new KafkaConsumerRunner<IConfigChannelsRecreateAllPayload>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-config-channels-recreate-all',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.account_id,
      handle: (data) => this.processRecreateAll(data),
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

  private parseMessage(
    value: Buffer | null
  ): IConfigChannelsRecreateAllPayload | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value.toString()) as IConfigChannelsRecreateAllPayload;
    } catch {
      return null;
    }
  }

  private async publishCompleted(
    accountId: string,
    success: number,
    errors: number
  ): Promise<void> {
    const payload: IConfigChannelsRecreateAllCompleted = {
      type: 'recreate_all_completed',
      account_id: accountId,
      success,
      errors,
    };

    await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);
  }

  private async processRecreateAll(
    data: IConfigChannelsRecreateAllPayload
  ): Promise<void> {
    try {
      const t = await createI18nInstance('pt');
      const result = await this.channelsRecreatorAllUseCase.execute(t, {
        status: data.status,
        type: data.type,
        account: data.account,
        name: data.name,
        number: data.number,
      });
      await this.publishCompleted(
        data.account_id,
        result.success,
        result.errors
      );
    } catch {
      await this.publishCompleted(data.account_id, 0, 1);
    }
  }
}
