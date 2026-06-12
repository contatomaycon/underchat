import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { IWorkerWarmDeleteRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class WorkerWarmDeleteConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IWorkerWarmDeleteRequest> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerWarmDeleteRequest();
    this.runner = new KafkaConsumerRunner<IWorkerWarmDeleteRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-worker-warm-delete',
      parse: (message) => this.parsePayload(message.value),
      resolveEntityKey: (payload) =>
        payload.warm_pool_id ?? payload.worker_id ?? payload.request_id,
      handle: (payload) => this.deleteWarmWorker(payload),
      onInvalidMessage: () => {
        console.warn('Skipping invalid worker warm delete payload');
      },
      onFailed: (payload, _context, error) => {
        console.error('Failed to delete warm worker', {
          worker_id: payload.worker_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          warm_pool_id: payload.warm_pool_id,
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

  private async deleteWarmWorker(
    payload: IWorkerWarmDeleteRequest
  ): Promise<void> {
    await this.workerGrpcClientService.deleteWarmWorker(payload.server_id, {
      ...payload,
      container_id: payload.container_id ?? undefined,
      container_name: payload.container_name ?? undefined,
      session_volume_name: payload.session_volume_name ?? undefined,
      worker_type_id: payload.worker_type_id ?? undefined,
      warm_pool_id: payload.warm_pool_id ?? undefined,
    });
  }

  private parsePayload(value: Buffer | null): IWorkerWarmDeleteRequest | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as Partial<IWorkerWarmDeleteRequest>;
      if (!parsed.request_id || !parsed.server_id) {
        return null;
      }
      return parsed as IWorkerWarmDeleteRequest;
    } catch {
      return null;
    }
  }
}
