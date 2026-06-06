import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { IWorkerWarmDeleteRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

@singleton()
export class WorkerWarmDeleteConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  async execute(_server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerWarmDeleteRequest();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-worker-warm-delete'
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

      const startedAt = Date.now();
      try {
        await this.workerGrpcClientService.deleteWarmWorker(payload.server_id, {
          ...payload,
          container_id: payload.container_id ?? undefined,
          container_name: payload.container_name ?? undefined,
          session_volume_name: payload.session_volume_name ?? undefined,
          worker_type_id: payload.worker_type_id ?? undefined,
          warm_pool_id: payload.warm_pool_id ?? undefined,
        });

        recordConnectionLifecycle({
          stage: 'connection.service.warm_pool.delete_completed',
          decision: 'delete_warm_worker',
          outcome: 'success',
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          worker_type_id: payload.worker_type_id,
          worker_id: payload.worker_id,
          warm_pool_id: payload.warm_pool_id,
          container_id: payload.container_id,
          container_name: payload.container_name,
          session_volume_name: payload.session_volume_name,
          remove_volume: payload.remove_volume,
          reason: payload.reason,
          duration_ms: Date.now() - startedAt,
        });
      } catch (error) {
        recordConnectionLifecycle({
          stage: 'connection.service.warm_pool.delete_error',
          decision: 'delete_warm_worker',
          outcome: 'error',
          reason: 'warm_worker_delete_failed',
          level: 'error',
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          worker_type_id: payload.worker_type_id,
          worker_id: payload.worker_id,
          warm_pool_id: payload.warm_pool_id,
          error: error instanceof Error ? error.message : String(error),
          duration_ms: Date.now() - startedAt,
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
