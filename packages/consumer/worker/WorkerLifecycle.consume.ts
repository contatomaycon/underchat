import { FastifyInstance } from 'fastify';
import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer, MessageHeader } from 'node-rdkafka';
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
import { runWithKafkaTraceContext } from '@core/plugins/telemetry/messageLifecycleDebug';
import {
  buildConnectionLifecycleContext,
  isConnectionLifecycleDebugEnabled,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
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
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.invalid_payload',
          decision: 'consume_worker_lifecycle',
          outcome: 'ignored',
          reason: 'invalid_payload',
          level: 'warn',
          queue_topic: topic,
          partition: message.partition,
          offset: message.offset,
          raw_payload: message.value?.toString('utf8'),
        });
        await this.commit(topic, message.partition, message.offset);
        recordConnectionLifecycle({
          stage:
            'connection.service.lifecycle_consumer.invalid_payload_committed',
          decision: 'commit_worker_lifecycle_offset',
          outcome: 'committed',
          reason: 'invalid_payload',
          queue_topic: topic,
          partition: message.partition,
          offset: message.offset,
        });
        return;
      }

      try {
        await runWithKafkaTraceContext(message.headers, () =>
          this.runWithLifecycleContext(payload, () =>
            this.processPayload(payload, message.headers)
          )
        );
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.process_success',
          decision: 'consume_worker_lifecycle',
          outcome: 'success',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          worker_status_id: payload.worker_status_id,
          lifecycle_operation_id: payload.operation_id,
          lifecycle_action: payload.action,
          queue_topic: topic,
          partition: message.partition,
          offset: message.offset,
        });
        await this.commit(topic, message.partition, message.offset);
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.commit_success',
          decision: 'commit_worker_lifecycle_offset',
          outcome: 'committed',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          lifecycle_action: payload.action,
          queue_topic: topic,
          partition: message.partition,
          offset: message.offset,
        });
      } catch (error) {
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.process_error',
          decision: 'consume_worker_lifecycle',
          outcome: 'error',
          reason: 'processing_failed',
          level: 'error',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          lifecycle_operation_id: payload.operation_id,
          lifecycle_action: payload.action,
          queue_topic: topic,
          partition: message.partition,
          offset: message.offset,
          error: error instanceof Error ? error.message : String(error),
        });
        if (isConnectionLifecycleDebugEnabled()) {
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
      }
    });

    const consumer = this.consumer;
    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.ready',
        decision: 'consume_worker_lifecycle',
        outcome: 'ready',
        queue_topic: topic,
      });
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

  private runWithLifecycleContext<T>(
    payload: IWorkerLifecycleQueueMessage,
    callback: () => T | Promise<T>
  ): T | Promise<T> {
    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: payload.connection_lifecycle_id,
      account_id: payload.account_id,
      worker_id: payload.worker_id,
      channel_id: payload.worker_id,
      worker_type: payload.worker_type_id,
      source_provider: 'service',
      connection_action: payload.action,
    });

    return runWithConnectionLifecycleContext(contextData, callback);
  }

  private async processPayload(
    payload: IWorkerLifecycleQueueMessage,
    headers?: MessageHeader[]
  ): Promise<void> {
    recordConnectionLifecycle({
      stage: 'connection.service.lifecycle_consumer.received',
      decision: 'consume_worker_lifecycle',
      outcome: 'received',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
      raw_payload: payload,
      has_kafka_headers: Boolean(headers?.length),
    });

    recordConnectionLifecycle({
      stage: 'connection.service.lifecycle_consumer.stale_check_start',
      decision: 'validate_worker_lifecycle_fence',
      outcome: 'started',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
    });
    const stale = await this.resolveStaleReason(payload);
    if (stale) {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.stale',
        decision: 'consume_worker_lifecycle',
        outcome: 'stale',
        reason: stale,
        level: 'warn',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        lifecycle_action: payload.action,
      });
      return;
    }
    recordConnectionLifecycle({
      stage: 'connection.service.lifecycle_consumer.stale_check_success',
      decision: 'validate_worker_lifecycle_fence',
      outcome: 'valid',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
    });

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
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.dispatch_create_start',
        decision: 'dispatch_worker_lifecycle_grpc',
        outcome: 'started',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
        lifecycle_action: payload.action,
      });
      await this.workerGrpcClientService.createWorker(workerPayload);
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.dispatch_create_success',
        decision: 'dispatch_worker_lifecycle_grpc',
        outcome: 'success',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
        lifecycle_action: payload.action,
      });
      return;
    }

    if (payload.action === 'recreate') {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.dispatch_recreate_start',
        decision: 'dispatch_worker_lifecycle_grpc',
        outcome: 'started',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
        lifecycle_action: payload.action,
        remove_session: payload.remove_session,
        remove_volume: payload.remove_volume,
      });
      await this.workerGrpcClientService.recreateWorker(workerPayload);
      recordConnectionLifecycle({
        stage:
          'connection.service.lifecycle_consumer.dispatch_recreate_success',
        decision: 'dispatch_worker_lifecycle_grpc',
        outcome: 'success',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
        lifecycle_action: payload.action,
        remove_session: payload.remove_session,
        remove_volume: payload.remove_volume,
      });
      return;
    }

    recordConnectionLifecycle({
      stage: 'connection.service.lifecycle_consumer.dispatch_cleanup_start',
      decision: 'dispatch_worker_lifecycle_grpc',
      outcome: 'started',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
      remove_session: payload.remove_session,
      remove_volume: payload.remove_volume,
    });
    await this.workerGrpcClientService.cleanupWorker({
      ...workerPayload,
      action: EWorkerAction.cleanup,
    });
    recordConnectionLifecycle({
      stage: 'connection.service.lifecycle_consumer.dispatch_cleanup_success',
      decision: 'dispatch_worker_lifecycle_grpc',
      outcome: 'success',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_status_id: payload.worker_status_id,
      lifecycle_operation_id: payload.operation_id,
      lifecycle_action: payload.action,
      remove_session: payload.remove_session,
      remove_volume: payload.remove_volume,
    });
  }

  private async activateWarmOrFallback(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    if (!payload.warm_pool_id || !payload.worker_type_id) {
      throw new Error('Missing warm_pool_id or worker_type_id');
    }

    try {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_activate_start',
        decision: 'activate_warm_worker',
        outcome: 'started',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        warm_pool_id: payload.warm_pool_id,
        previous_worker_type_id: payload.previous_worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        remove_session: payload.remove_session,
        remove_volume: payload.remove_volume,
      });
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
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_activate_success',
        decision: 'activate_warm_worker',
        outcome: 'success',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        warm_pool_id: payload.warm_pool_id,
        previous_worker_type_id: payload.previous_worker_type_id,
        lifecycle_operation_id: payload.operation_id,
        remove_session: payload.remove_session,
        remove_volume: payload.remove_volume,
      });
      return;
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_activate_error',
        decision: 'activate_warm_worker',
        outcome: 'error',
        reason: 'warm_activation_failed',
        level: 'warn',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.reconcileFailedWarm(payload);
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_fallback_start',
        decision: 'fallback_create_worker_after_warm_failure',
        outcome: 'started',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
      });
      await this.workerGrpcClientService.createWorker({
        action: EWorkerAction.create,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        lifecycle_operation_id: payload.operation_id,
      });
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_fallback_success',
        decision: 'fallback_create_worker_after_warm_failure',
        outcome: 'success',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
      });
    }
  }

  private async reconcileFailedWarm(
    payload: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_delete_start',
        decision: 'delete_failed_warm_worker',
        outcome: 'started',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
      });
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
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_delete_success',
        decision: 'delete_failed_warm_worker',
        outcome: 'success',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
      });
    } catch (deleteError) {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_delete_error',
        decision: 'delete_failed_warm_worker',
        outcome: 'error',
        reason: 'warm_delete_failed',
        level: 'warn',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
        error:
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError),
      });
    }

    try {
      const settings = await this.workerWarmPoolSettingsService.view();
      if (settings.warmup_enabled && payload.worker_type_id) {
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.warm_replenish_start',
          decision: 'enqueue_warm_replenish',
          outcome: 'started',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          warm_pool_id: payload.warm_pool_id,
          lifecycle_operation_id: payload.operation_id,
          reason: 'pool_miss',
        });
        await this.workerWarmPoolQueueService.publishReplenish({
          request_id: uuidv7(),
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          reason: 'pool_miss',
          requested_at: currentTime(),
        });
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.warm_replenish_success',
          decision: 'enqueue_warm_replenish',
          outcome: 'success',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          warm_pool_id: payload.warm_pool_id,
          lifecycle_operation_id: payload.operation_id,
          reason: 'pool_miss',
        });
      } else {
        recordConnectionLifecycle({
          stage: 'connection.service.lifecycle_consumer.warm_replenish_skipped',
          decision: 'enqueue_warm_replenish',
          outcome: 'skipped',
          reason: settings.warmup_enabled
            ? 'worker_type_missing'
            : 'warmup_disabled',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type: payload.worker_type_id,
          warm_pool_id: payload.warm_pool_id,
          lifecycle_operation_id: payload.operation_id,
        });
      }
    } catch (replenishError) {
      recordConnectionLifecycle({
        stage: 'connection.service.lifecycle_consumer.warm_replenish_error',
        decision: 'enqueue_warm_replenish',
        outcome: 'error',
        reason: 'warm_replenish_enqueue_failed',
        level: 'warn',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        warm_pool_id: payload.warm_pool_id,
        lifecycle_operation_id: payload.operation_id,
        error:
          replenishError instanceof Error
            ? replenishError.message
            : String(replenishError),
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
        !parsed.connection_lifecycle_id ||
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
