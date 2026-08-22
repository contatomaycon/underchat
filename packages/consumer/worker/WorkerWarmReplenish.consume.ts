import { inject, singleton } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { IWorkerWarmReplenishRequest } from '@core/common/interfaces/IWorkerWarmPoolQueue';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';

/*
 * Replenishment records are regenerative capacity signals, not irreplaceable
 * commands. Keep the synchronous gRPC window below the minimum configurable
 * warming-stale window (30s) so one unavailable Balance cannot hold a Kafka
 * entity/contiguous partition commit for minutes. Two attempts plus the retry
 * delay bound the normal transport-failure path to about 21 seconds.
 */
const WARM_CREATE_GRPC_DEADLINE_MS = 10_000;
const WARM_CREATE_MAX_ATTEMPTS = 2;
const WARM_CREATE_RETRY_DELAYS_MS = [1_000];
const WARM_REPLENISH_MAX_IN_FLIGHT_TOTAL = 8;
const WARM_REPLENISH_MAX_IN_FLIGHT_PER_PARTITION = 4;
const TRANSIENT_GRPC_STATUS_CODES = new Set([1, 2, 4, 8, 10, 13, 14]);

function grpcStatusCode(error: unknown): number | undefined {
  const value = (error as { code?: unknown } | null)?.code;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isTransientWarmCreationError(error: unknown): boolean {
  const code = grpcStatusCode(error);
  if (code !== undefined) {
    return TRANSIENT_GRPC_STATUS_CODES.has(code);
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  return /deadline|timed? ?out|unavailable|econn|connect|socket|temporar/u.test(
    message
  );
}

function resolveWarmReplenishCoalesceKey(
  payload: IWorkerWarmReplenishRequest
): string {
  /*
   * A request id represents one capacity slot. Coalesce only a redelivery of
   * that exact slot: distinct deficit claims for the same server/provider must
   * all reach the advisory-lock + target CAS below, otherwise a 0 -> N scan or
   * a recreate-all batch converges only one container per scheduler interval.
   */
  return `${payload.server_id}:${payload.worker_type_id}:${payload.request_id}`;
}

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
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository
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
      resolveCoalesceKey: resolveWarmReplenishCoalesceKey,
      resolveEntityKey: (payload) =>
        `${payload.server_id}:${payload.worker_type_id}`,
      preserveEntityOrder: true,
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
      onDiscarded: async (payload, _context, error) => {
        /*
         * The capacity claim is created before the gRPC call. If transport
         * failure prevents the Balance from recording the failure, leaving
         * the row in `warming` makes it count against the target until a later
         * reconciliation pass. Persist the terminal attempt immediately so a
         * subsequent scan can replenish the missing capacity.
         */
        await this.workerWarmPoolRepository.recordPostgresCreationError({
          warmPoolId: payload.request_id,
          serverId: payload.server_id,
          workerTypeId: payload.worker_type_id,
          error:
            error instanceof Error
              ? error.message
              : String(error ?? 'warm_worker_creation_failed'),
        });
      },
      /*
       * The same durable request_id is safe to retry once. Non-transient
       * authentication/configuration failures cannot improve inside this
       * handler and are finalized immediately. On exhaustion, onDiscarded
       * persists the exact claim failure before the offset is committed; if
       * that persistence fails, failOnDiscardedHookError leaves it uncommitted.
       * The next scheduled scan then emits a fresh capacity signal.
       */
      classifyError: (_payload, _context, error) =>
        isTransientWarmCreationError(error) ? 'retryable' : 'terminal',
      failOnDiscardedHookError: true,
      maxInFlightTotal: WARM_REPLENISH_MAX_IN_FLIGHT_TOTAL,
      maxInFlightPerPartition: WARM_REPLENISH_MAX_IN_FLIGHT_PER_PARTITION,
      maxRetries: WARM_CREATE_MAX_ATTEMPTS,
      retryDelaysMs: WARM_CREATE_RETRY_DELAYS_MS,
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

    const target = this.resolveTarget(settings, payload.worker_type_id);
    if (target === null) {
      return;
    }

    const retryAfter = new Date(
      Date.now() - settings.warming_stale_after_seconds * 1000
    ).toISOString();
    const claimed =
      await this.workerWarmPoolRepository.claimCapacityForReplenish({
        warmPoolId: payload.request_id,
        serverId: payload.server_id,
        workerTypeId: payload.worker_type_id,
        sessionVolumeName: `warm-${payload.request_id}`,
        target,
        retryAfter,
      });
    if (!claimed) {
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
      WARM_CREATE_GRPC_DEADLINE_MS
    );
  }

  private resolveTarget(
    settings: IWorkerWarmPoolSettings,
    workerTypeId: string
  ): number | null {
    if (workerTypeId === EWorkerType.baileys) {
      return settings.target_ready_baileys;
    }
    if (workerTypeId === EWorkerType.wwebjs) {
      return settings.target_ready_wwebjs;
    }
    if (workerTypeId === EWorkerType.whatsmeow) {
      return settings.target_ready_whatsmeow;
    }

    return null;
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
