import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class ConfigChannelsRecreateAllConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly channelsRecreatorAllUseCase: ChannelsRecreatorAllUseCase,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.configChannelsRecreateAll();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-config-channels-recreate-all'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        const t = await createI18nInstance('pt');
        const result = await this.channelsRecreatorAllUseCase.execute(
          t,
          data.status
        );
        await this.publishCompleted(
          data.account_id,
          result.success,
          result.errors
        );
      } catch {
        await this.publishCompleted(data.account_id, 0, 1);
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
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
}
