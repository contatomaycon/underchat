import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { IWorkerWarmReplenishRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class WorkerWarmReplenishConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IWorkerWarmReplenishRequest> | null =
    null;
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

  async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerWarmReplenishRequest();
    this.runner = new KafkaConsumerRunner<IWorkerWarmReplenishRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-worker-warm-replenish',
      parse: (message) => this.parsePayload(message.value),
      resolveEntityKey: (payload) =>
        `${payload.server_id}:${payload.worker_type_id}`,
      handle: (payload) => this.replenishWarmWorker(payload),
      onInvalidMessage: () => {
        console.warn('Skipping invalid worker warm replenish payload');
      },
      onFailed: (payload, _context, error) => {
        console.error('Failed to create warm worker', {
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          error,
        });
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000],
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private async replenishWarmWorker(
    payload: IWorkerWarmReplenishRequest
  ): Promise<void> {
    const settings = await this.workerWarmPoolSettingsService.view();
    if (!settings.warmup_enabled) {
      return;
    }

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
