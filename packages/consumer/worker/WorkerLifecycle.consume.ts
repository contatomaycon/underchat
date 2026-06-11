import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import {
  IWorkerLifecycleQueueMessage,
  workerLifecycleQueueActionToWorkerAction,
} from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { currentTime } from '@core/common/functions/currentTime';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';

@singleton()
export class WorkerLifecycleConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerLifecycleRequest();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-worker-lifecycle'
    );

    this.consumer.on('data', async (message) => {
      const payload = this.parsePayload(message.value);
      if (!payload) {
        await this.commit(topic, message.partition, message.offset);
        return;
      }

      try {
        await this.processPayload(payload);
        await this.commit(topic, message.partition, message.offset);
      } catch (error) {
        server.log.error(
          {
            err: error,
            workerId: payload.worker_id,
            action: payload.action,
            operationId: payload.operation_id,
          },
          'Worker lifecycle consume failed'
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

  private async commit(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private async processPayload(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    const stale = await this.resolveStaleReason(payload);
    if (stale) {
      return;
    }

    if (payload.action === 'activate_warm') {
      await this.activateWarmOrFallback(payload);
      return;
    }

    const workerPayload = {
      action: workerLifecycleQueueActionToWorkerAction(payload.action),
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_status_id: payload.worker_status_id,
      worker_type_id: payload.worker_type_id,
      previous_worker_status_id: payload.previous_worker_status_id,
      remove_session: payload.remove_session,
      remove_volume: payload.remove_volume,
      lifecycle_operation_id: payload.operation_id,
    };

    if (payload.action === 'create') {
      await this.workerGrpcClientService.createWorker(workerPayload);
      return;
    }

    if (payload.action === 'recreate') {
      await this.workerGrpcClientService.recreateWorker(workerPayload);
      return;
    }

    await this.workerGrpcClientService.cleanupWorker({
      ...workerPayload,
      action: EWorkerAction.cleanup,
    });
  }

  private async activateWarmOrFallback(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    if (!payload.warm_pool_id || !payload.worker_type_id) {
      throw new Error('Missing warm_pool_id or worker_type_id');
    }

    try {
      await this.workerGrpcClientService.activateWarmWorker(
        payload.server_id,
        {
          warm_pool_id: payload.warm_pool_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          remove_session: payload.remove_session,
          remove_volume: payload.remove_volume,
          previous_worker_type_id: payload.previous_worker_type_id,
          previous_worker_status_id: payload.previous_worker_status_id,
        },
        120_000
      );
      return;
    } catch (error) {
      await this.reconcileFailedWarm(payload);
      await this.workerGrpcClientService.createWorker({
        action: EWorkerAction.create,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
      });

      console.error('Failed to activate warm worker, fallback to create', {
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        error,
      });
    }
  }

  private async reconcileFailedWarm(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.workerGrpcClientService.deleteWarmWorker(
        payload.server_id,
        {
          request_id: uuidv7(),
          warm_pool_id: payload.warm_pool_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          remove_volume: true,
          reason: 'pool_reconcile',
          requested_at: currentTime(),
        },
        60_000
      );
    } catch (deleteError) {
      console.error('Failed to delete warm worker during reconcile', {
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        error: deleteError,
      });
    }

    try {
      const settings = await this.workerWarmPoolSettingsService.view();
      if (settings.warmup_enabled && payload.worker_type_id) {
        await this.workerWarmPoolQueueService.publishReplenish({
          request_id: uuidv7(),
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          reason: 'pool_miss',
          requested_at: currentTime(),
        });
      } else {
      }
    } catch (replenishError) {
      console.error('Failed to publish replenish during reconcile', {
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        error: replenishError,
      });
    }
  }

  private async resolveStaleReason(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<string | undefined> {
    const current = await this.workerService.viewWorkerForMonitor(
      payload.worker_id
    );

    if (!current) {
      return 'worker_not_found';
    }

    if (current.account_id !== payload.account_id) {
      return 'account_mismatch';
    }

    if (current.lifecycle_operation_id !== payload.operation_id) {
      return 'lifecycle_operation_mismatch';
    }

    if (
      payload.action !== 'cleanup_previous_runtime' &&
      current.server_id !== payload.server_id
    ) {
      return 'server_mismatch';
    }

    if (
      payload.worker_type_id &&
      payload.action !== 'cleanup_previous_runtime' &&
      current.worker_type_id !== payload.worker_type_id
    ) {
      return 'worker_type_mismatch';
    }

    return undefined;
  }

  private parsePayload(
    value: Buffer | null
  ): IWorkerLifecycleQueueMessage | null {
    if (!value) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        value.toString('utf8')
      ) as Partial<IWorkerLifecycleQueueMessage>;
      if (
        !parsed.request_id ||
        !parsed.operation_id ||
        !parsed.action ||
        !parsed.worker_id ||
        !parsed.account_id ||
        !parsed.server_id ||
        !parsed.source ||
        !parsed.requested_at
      ) {
        return null;
      }
      return parsed as IWorkerLifecycleQueueMessage;
    } catch {
      return null;
    }
  }
}
