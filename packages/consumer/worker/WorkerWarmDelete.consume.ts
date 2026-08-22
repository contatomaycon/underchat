import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { IWorkerWarmDeleteRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import {
  WorkerWarmPoolRepository,
  type WarmPoolDeleteDispatchTarget,
} from '@core/repositories/worker/WorkerWarmPool.repository';
import type { KafkaConsumerRunnerContext } from '@core/common/interfaces/KafkaConsumerRunnerOptions';

const WARM_DELETE_GRPC_DEADLINE_MS = 300_000;

function compactError(error: unknown): {
  code?: string | number;
  message: string;
} {
  const value = error as {
    code?: string | number;
    details?: unknown;
    message?: unknown;
  };
  const message =
    (typeof value?.details === 'string' && value.details) ||
    (typeof value?.message === 'string' && value.message) ||
    String(error);

  return {
    code: value?.code,
    message: message.slice(0, 700),
  };
}

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
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository
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
      handle: (payload, context) => this.deleteWarmWorker(payload, context),
      preserveEntityOrder: true,
      onInvalidMessage: () => {
        console.warn('Skipping invalid worker warm delete payload');
      },
      onFailed: (payload, context, error) => {
        const failure = compactError(error);
        console.error('Warm worker delete coordination failed; retrying', {
          worker_id: payload.worker_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          warm_pool_id: payload.warm_pool_id,
          request_id: payload.request_id,
          attempt: context.attempt,
          error_code: failure.code,
          error_message: failure.message,
        });
      },
      shouldContinueRetryWithoutCommit: (payload) =>
        Boolean(payload.warm_pool_id),
      maxRetries: 3,
      retryDelaysMs: [1000, 5000, 15_000, 30_000],
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
    payload: IWorkerWarmDeleteRequest,
    context: KafkaConsumerRunnerContext<IWorkerWarmDeleteRequest>
  ): Promise<void> {
    let canonicalTarget: WarmPoolDeleteDispatchTarget | null = null;
    if (payload.warm_pool_id) {
      const dispatch =
        await this.workerWarmPoolRepository.prepareDeleteDispatch({
          warmPoolId: payload.warm_pool_id,
          serverId: payload.server_id,
        });
      if (dispatch.decision === 'protected_runtime') {
        context.assertActive();
        const reconciled =
          await this.workerWarmPoolRepository.reconcileDeletingRuntimeLineage(
            payload.warm_pool_id
          );
        if (!reconciled) {
          throw new Error('warm_delete_runtime_lineage_reconcile_failed');
        }
        return;
      }
      if (dispatch.decision !== 'dispatch') {
        return;
      }
      canonicalTarget = dispatch.target;
    }

    const serverId = canonicalTarget?.server_id ?? payload.server_id;
    const workerTypeId =
      canonicalTarget?.worker_type_id ?? payload.worker_type_id;
    context.assertActive();
    try {
      await this.workerGrpcClientService.deleteWarmWorker(
        serverId,
        {
          ...payload,
          server_id: serverId,
          worker_type_id: workerTypeId ?? undefined,
          warm_pool_id:
            canonicalTarget?.warm_pool_id ?? payload.warm_pool_id ?? undefined,
          container_id:
            (canonicalTarget
              ? canonicalTarget.container_id
              : payload.container_id) ?? undefined,
          container_name:
            (canonicalTarget
              ? canonicalTarget.container_name
              : payload.container_name) ?? undefined,
          session_volume_name:
            (canonicalTarget
              ? canonicalTarget.session_volume_name
              : payload.session_volume_name) ?? undefined,
        },
        WARM_DELETE_GRPC_DEADLINE_MS
      );
    } catch (error) {
      if (!payload.warm_pool_id) {
        throw error;
      }

      context.assertActive();
      const failure = compactError(error);
      const parked =
        await this.workerWarmPoolRepository.recordDeleteRetryFailure(
          payload.warm_pool_id,
          [
            'warm_delete_grpc_deferred',
            failure.code === undefined ? null : `code=${failure.code}`,
            `message=${failure.message}`,
          ]
            .filter(Boolean)
            .join(' ')
        );

      console.warn('Warm worker deletion deferred for durable redrive', {
        server_id: serverId,
        worker_type_id: workerTypeId,
        warm_pool_id: payload.warm_pool_id,
        request_id: payload.request_id,
        parked,
        error_code: failure.code,
        error_message: failure.message,
      });
    }
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
