import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { IWorkerWarmReplenishRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class WorkerWarmReplenishConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerWarmReplenishRequest();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-worker-warm-replenish'
    );

    this.consumer.on('data', async (message) => {
      const payload = this.parsePayload(message.value);
      if (!payload) {
        await commitOffset(
          this.consumerOrThrow,
          topic,
          message.partition,
          message.offset
        );
        return;
      }

      const settings = await this.workerWarmPoolSettingsService.view();
      if (!settings.warmup_enabled) {
        await commitOffset(
          this.consumerOrThrow,
          topic,
          message.partition,
          message.offset
        );
        return;
      }

      try {
        await this.workerGrpcClientService.createWarmWorker(
          payload.server_id,
          {
            request_id: payload.request_id,
            warm_pool_id: payload.request_id,
            server_id: payload.server_id,
            worker_type_id: payload.worker_type_id,
          },
          120_000
        );
      } catch (error) {
        console.error('Failed to create warm worker', {
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          error,
        });
      } finally {
        await commitOffset(
          this.consumerOrThrow,
          topic,
          message.partition,
          message.offset
        );
      }
    });

    const consumer = this.consumer;
    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }
    this.isRunning = false;
    await new Promise<void>((resolve) => {
      this.consumer?.unsubscribe();
      this.consumer?.disconnect(resolve);
    });
    this.consumer = null;
  }

  private parsePayload(
    value: Buffer | null
  ): IWorkerWarmReplenishRequest | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as Partial<IWorkerWarmReplenishRequest>;
      if (!parsed.request_id || !parsed.server_id || !parsed.worker_type_id) {
        return null;
      }
      return parsed as IWorkerWarmReplenishRequest;
    } catch {
      return null;
    }
  }
}
