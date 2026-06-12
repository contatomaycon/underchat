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
import { currentTime } from '@core/common/functions/currentTime';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

@singleton()
export class WorkerLifecycleConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IWorkerLifecycleQueueMessage> | null =
    null;
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
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.workerLifecycleRequest();
    this.runner = new KafkaConsumerRunner<IWorkerLifecycleQueueMessage>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-worker-lifecycle',
      parse: (message) => this.parsePayload(message.value),
      resolveEntityKey: (payload) => payload.worker_id,
      handle: (payload) => this.processPayload(payload),
      onInvalidMessage: () => {
        server.log.warn('Skipping invalid worker lifecycle payload');
      },
      onFailed: (payload, _context, error) => {
        server.log.error(
          {
            err: error,
            workerId: payload.worker_id,
            action: payload.action,
            operationId: payload.operation_id,
          },
          'Worker lifecycle consume failed'
        );
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000],
      logger: server.log,
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

  private async processPayload(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    void this.connectionLifecycleDebugService.log(
      'service.lifecycle_queue.consumed',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        action: payload.action,
        source: payload.source,
      }
    );
    const stale = await this.resolveStaleReason(payload);
    if (stale) {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.stale',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          action: payload.action,
          source: payload.source,
          reason: stale,
        }
      );
      return;
    }

    if (payload.action === 'activate_warm') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_activate_warm',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
          warm_pool_id: payload.warm_pool_id,
        }
      );
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
      debug_trace_id: payload.debug_trace_id,
    };

    if (payload.action === 'create') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_create_grpc',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
        }
      );
      await this.workerGrpcClientService.createWorker(workerPayload);
      return;
    }

    if (payload.action === 'recreate') {
      void this.connectionLifecycleDebugService.log(
        'service.lifecycle_queue.dispatch_recreate_grpc',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          server_id: payload.server_id,
        }
      );
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
          debug_trace_id: payload.debug_trace_id,
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
        debug_trace_id: payload.debug_trace_id,
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
