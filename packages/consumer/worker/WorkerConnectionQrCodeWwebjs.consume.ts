import { singleton, inject } from 'tsyringe';
import Redis from 'ioredis';
import { wwebjsEnvironment } from '@core/config/environments';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import {
  WorkerConnectionQrCodeRedisQueueService,
  WorkerConnectionQrCodeRedisStreamMessage,
} from '@core/services/workerConnectionQrCodeRedisQueue.service';

interface ActiveQrAttemptEnvelope {
  ack?: {
    connection_attempt_id?: string;
  };
}

@singleton()
export class WorkerConnectionQrCodeWwebjsConsume {
  private static readonly ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS = 1_000;
  private isRunning = false;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService,
    @inject(WorkerConnectionStatusWwebjsConsume)
    private readonly workerConnectionStatusConsume: WorkerConnectionStatusWwebjsConsume,
    @inject('Redis') private readonly redis: Redis
  ) {}

  public async execute(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const streamKey = this.redisQueueService.streamKey(workerId);
    const consumerGroup = this.redisQueueService.consumerGroup(workerId);
    const consumerName = this.redisQueueService.consumerName(
      workerId,
      EWorkerType.wwebjs
    );

    await this.redisQueueService.ensureGroup(workerId);
    this.stopped = false;
    this.isRunning = true;

    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_redis_stream.listener_start',
      decision: 'start_qrcode_redis_stream_listener',
      outcome: 'started',
      worker_id: workerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
      stream_key: streamKey,
      consumer_group: consumerGroup,
      consumer_name: consumerName,
      redis_status: this.redisStatus(),
    });

    this.loopPromise = this.consumeLoop(workerId, consumerName).catch(
      (error) => {
        this.isRunning = false;
        recordConnectionLifecycle({
          stage: 'connection.wwebjs.qrcode_redis_stream.listener_error',
          decision: 'run_qrcode_redis_stream_listener',
          outcome: 'error',
          reason: 'listener_stopped_by_error',
          level: 'error',
          worker_id: workerId,
          account_id: wwebjsEnvironment.wwebjsAccountId,
          worker_type: EWorkerType.wwebjs,
          worker_type_id: EWorkerType.wwebjs,
          stream_key: streamKey,
          consumer_group: consumerGroup,
          consumer_name: consumerName,
          redis_status: this.redisStatus(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  }

  private async consumeLoop(
    workerId: string,
    consumerName: string
  ): Promise<void> {
    while (!this.stopped) {
      try {
        const claimed = await this.redisQueueService.claimPending(
          workerId,
          consumerName
        );
        if (claimed.length > 0) {
          await this.processMessages(claimed);
          continue;
        }

        const messages = await this.redisQueueService.readNew(
          workerId,
          consumerName
        );
        await this.processMessages(messages);
      } catch (error) {
        recordConnectionLifecycle({
          stage: 'connection.wwebjs.qrcode_redis_stream.read_error',
          decision: 'read_qrcode_redis_stream',
          outcome: 'error',
          reason: 'redis_stream_read_failed',
          level: 'warn',
          worker_id: workerId,
          account_id: wwebjsEnvironment.wwebjsAccountId,
          worker_type: EWorkerType.wwebjs,
          worker_type_id: EWorkerType.wwebjs,
          stream_key: this.redisQueueService.streamKey(workerId),
          consumer_group: this.redisQueueService.consumerGroup(workerId),
          consumer_name: consumerName,
          redis_status: this.redisStatus(),
          error: error instanceof Error ? error.message : String(error),
        });
        await this.delay(1000);
      }
    }
  }

  private async processMessages(
    messages: WorkerConnectionQrCodeRedisStreamMessage[]
  ): Promise<void> {
    for (const message of messages) {
      if (this.stopped) {
        return;
      }
      await this.handleMessage(message);
    }
  }

  private async handleMessage(
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<void> {
    const data = message.payload;
    if (!data) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.ignored_invalid',
        decision: 'consume_connection_qrcode_request',
        outcome: 'ignored',
        reason: 'invalid_payload',
        level: 'warn',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        reclaimed: message.reclaimed,
        redis_status: this.redisStatus(),
      });
      await this.ackAndDelete(message, 'invalid_payload');
      return;
    }

    const deliveryCount =
      message.delivery_count ??
      (await this.redisQueueService.getDeliveryCount(
        data.worker_id,
        message.stream_id
      ));
    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: data.connection_lifecycle_id,
      account_id: data.account_id,
      worker_id: data.worker_id,
      channel_id: data.worker_id,
      worker_type: EWorkerType.wwebjs,
      source_provider: 'wwebjs',
      connection_type: EBaileysConnectionType.qrcode,
      connection_action: 'consume_qrcode_request',
    });

    await runWithConnectionLifecycleContext(contextData, () =>
      this.processMessage({
        ...message,
        delivery_count: deliveryCount,
      })
    );
  }

  private async processMessage(
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<void> {
    const data = message.payload;
    if (!data) {
      await this.ackAndDelete(message, 'invalid_payload');
      return;
    }

    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_redis_stream.received',
      decision: 'consume_connection_qrcode_request',
      outcome: 'received',
      stream_key: message.stream_key,
      stream_id: message.stream_id,
      consumer_group: message.consumer_group,
      consumer_name: message.consumer_name,
      delivery_count: message.delivery_count,
      reclaimed: message.reclaimed,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      source: data.source,
      requested_at: data.requested_at,
      queue_latency_ms: message.queue_latency_ms,
      redis_status: this.redisStatus(),
    });

    if (!this.isMessageForThisWorker(data)) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.ignored_foreign',
        decision: 'validate_connection_qrcode_request_scope',
        outcome: 'ignored',
        reason: 'worker_or_account_or_type_mismatch',
        level: 'warn',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        request_worker_id: data.worker_id,
        request_account_id: data.account_id,
        request_worker_type_id: data.worker_type_id,
        worker_id: wwebjsEnvironment.wwebjsWorkerId,
        account_id: wwebjsEnvironment.wwebjsAccountId,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
      });
      await this.ackAndDelete(message, 'ignored_foreign');
      return;
    }

    const active = await this.isActiveAttempt(data, message);
    if (!active) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.ignored_stale',
        decision: 'validate_active_connection_attempt',
        outcome: 'ignored',
        reason: 'stale_or_duplicate_connection_attempt',
        level: 'warn',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
      });
      await this.ackAndDelete(message, 'ignored_stale');
      return;
    }

    try {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.local_request_start',
        decision: 'request_local_connection_qrcode',
        outcome: 'started',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        requested_at: data.requested_at,
        queue_latency_ms: message.queue_latency_ms,
      });
      const state = await this.workerConnectionStatusConsume.requestConnection({
        worker_id: data.worker_id,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        qr_pending: true,
      });
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.local_request_success',
        decision: 'request_local_connection_qrcode',
        outcome: 'success',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        status: state.status,
        code: state.code,
        worker_status_id: state.worker_status_id,
        connection_attempt_id:
          state.connection_attempt_id ?? data.connection_attempt_id,
        connection_lifecycle_id:
          state.connection_lifecycle_id ?? data.connection_lifecycle_id,
        requested_at: data.requested_at,
        queue_latency_ms: message.queue_latency_ms,
        has_qr: Boolean(state.qrcode),
        has_pairing_code: Boolean(state.pairing_code),
        qr_pending: state.qr_pending === true,
        reason: state.reason,
        time_to_first_qr_ms: state.time_to_first_qr_ms,
      });

      if (!this.shouldCompleteQrRequest(state)) {
        recordConnectionLifecycle({
          stage:
            'connection.wwebjs.qrcode_redis_stream.local_request_pending_retry',
          decision: 'request_local_connection_qrcode',
          outcome: 'pending',
          reason: state.reason ?? 'qrcode_not_available_yet',
          level: 'warn',
          stream_key: message.stream_key,
          stream_id: message.stream_id,
          consumer_group: message.consumer_group,
          consumer_name: message.consumer_name,
          delivery_count: message.delivery_count,
          status: state.status,
          code: state.code,
          worker_status_id: state.worker_status_id,
          connection_attempt_id:
            state.connection_attempt_id ?? data.connection_attempt_id,
          connection_lifecycle_id:
            state.connection_lifecycle_id ?? data.connection_lifecycle_id,
          requested_at: data.requested_at,
          queue_latency_ms: message.queue_latency_ms,
          has_qr: false,
          has_pairing_code: false,
          qr_pending: state.qr_pending === true,
          time_to_first_qr_ms: state.time_to_first_qr_ms,
          retry_after_idle_ms:
            WorkerConnectionQrCodeRedisQueueService.CLAIM_MIN_IDLE_MS,
        });
        return;
      }

      await this.redisQueueService.markProcessed(data);
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.mark_processed_success',
        decision: 'mark_qrcode_attempt_processed',
        outcome: 'success',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
      });

      await this.ackAndDelete(message, 'processed');
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.wwebjs.qrcode_redis_stream.process_error',
        decision: 'request_local_connection_qrcode',
        outcome: 'error',
        reason: 'local_connection_request_failed',
        level: 'error',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private shouldCompleteQrRequest(state: IBaileysConnectionState): boolean {
    if (state.qrcode || state.pairing_code) {
      return true;
    }

    if (state.status === EBaileysConnectionStatus.connected) {
      return true;
    }

    return (
      state.qr_pending !== true &&
      state.status === EBaileysConnectionStatus.disconnected
    );
  }

  private isMessageForThisWorker(
    data: IWorkerConnectionQrCodeQueueMessage
  ): boolean {
    return (
      data.worker_id === wwebjsEnvironment.wwebjsWorkerId &&
      data.account_id === wwebjsEnvironment.wwebjsAccountId &&
      data.worker_type_id === EWorkerType.wwebjs
    );
  }

  private activeAttemptKey(workerId: string): string {
    return `connection:qrcode:${workerId}:active_attempt`;
  }

  private async isActiveAttempt(
    data: IWorkerConnectionQrCodeQueueMessage,
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<boolean> {
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_redis_stream.active_attempt_check_start',
      decision: 'validate_active_connection_attempt',
      outcome: 'started',
      stream_key: message.stream_key,
      stream_id: message.stream_id,
      consumer_group: message.consumer_group,
      consumer_name: message.consumer_name,
      delivery_count: message.delivery_count,
      connection_attempt_id: data.connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
    });

    if (!this.isRedisReady()) {
      recordConnectionLifecycle({
        stage:
          'connection.wwebjs.qrcode_redis_stream.active_attempt_check_error',
        decision: 'validate_active_connection_attempt',
        outcome: 'error',
        reason: 'redis_not_ready',
        level: 'warn',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
        redis_status: this.redisStatus(),
      });
      return true;
    }

    try {
      const processed = await this.redisGetWithTimeout(
        this.redisQueueService.processedAttemptKey(
          data.worker_id,
          data.connection_attempt_id
        ),
        'processed_attempt'
      );
      if (processed) {
        this.logActiveAttemptCheckResult(data, message, {
          active: false,
          reason: 'already_processed_attempt',
        });
        return false;
      }

      const raw = await this.redisGetWithTimeout(
        this.activeAttemptKey(data.worker_id),
        'active_attempt'
      );
      if (!raw) {
        this.logActiveAttemptCheckResult(data, message, {
          active: false,
          reason: 'active_attempt_missing',
        });
        return false;
      }

      try {
        const parsed = JSON.parse(raw) as ActiveQrAttemptEnvelope;
        const active =
          parsed.ack?.connection_attempt_id === data.connection_attempt_id;
        this.logActiveAttemptCheckResult(data, message, {
          active,
          reason: active ? 'active_attempt_matches' : 'active_attempt_mismatch',
          active_connection_attempt_id: parsed.ack?.connection_attempt_id,
        });
        return active;
      } catch (error) {
        this.logActiveAttemptCheckResult(data, message, {
          active: false,
          reason: 'active_attempt_parse_error',
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    } catch (error) {
      recordConnectionLifecycle({
        stage:
          'connection.wwebjs.qrcode_redis_stream.active_attempt_check_error',
        decision: 'validate_active_connection_attempt',
        outcome: 'error',
        reason: 'active_attempt_validation_unavailable',
        level: 'warn',
        stream_key: message.stream_key,
        stream_id: message.stream_id,
        consumer_group: message.consumer_group,
        consumer_name: message.consumer_name,
        delivery_count: message.delivery_count,
        connection_attempt_id: data.connection_attempt_id,
        connection_lifecycle_id: data.connection_lifecycle_id,
        worker_type: EWorkerType.wwebjs,
        worker_type_id: EWorkerType.wwebjs,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  private logActiveAttemptCheckResult(
    data: IWorkerConnectionQrCodeQueueMessage,
    message: WorkerConnectionQrCodeRedisStreamMessage,
    result: {
      active: boolean;
      reason: string;
      active_connection_attempt_id?: string;
      error?: string;
    }
  ): void {
    recordConnectionLifecycle({
      stage:
        'connection.wwebjs.qrcode_redis_stream.active_attempt_check_result',
      decision: 'validate_active_connection_attempt',
      outcome: result.active ? 'active' : 'ignored',
      reason: result.reason,
      level: result.active ? 'info' : 'warn',
      stream_key: message.stream_key,
      stream_id: message.stream_id,
      consumer_group: message.consumer_group,
      consumer_name: message.consumer_name,
      delivery_count: message.delivery_count,
      connection_attempt_id: data.connection_attempt_id,
      active_connection_attempt_id: result.active_connection_attempt_id,
      connection_lifecycle_id: data.connection_lifecycle_id,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
      error: result.error,
    });
  }

  private async ackAndDelete(
    message: WorkerConnectionQrCodeRedisStreamMessage,
    reason: string
  ): Promise<void> {
    const result = await this.redisQueueService.ackAndDelete(
      message.payload?.worker_id ?? wwebjsEnvironment.wwebjsWorkerId,
      message.stream_id
    );
    recordConnectionLifecycle({
      stage: 'connection.wwebjs.qrcode_redis_stream.ack_delete_success',
      decision: 'ack_delete_qrcode_redis_stream_message',
      outcome: 'success',
      reason,
      stream_key: message.stream_key,
      stream_id: message.stream_id,
      consumer_group: message.consumer_group,
      consumer_name: message.consumer_name,
      delivery_count: message.delivery_count,
      connection_attempt_id: message.payload?.connection_attempt_id,
      connection_lifecycle_id: message.payload?.connection_lifecycle_id,
      worker_type: EWorkerType.wwebjs,
      worker_type_id: EWorkerType.wwebjs,
      redis_ack_count: result.acked,
      redis_delete_count: result.deleted,
    });
  }

  private async redisGetWithTimeout(
    key: string,
    operation: string
  ): Promise<string | null> {
    return this.runRedisWithTimeout(`GET ${operation}`, () =>
      this.redis.get(key)
    );
  }

  private isRedisReady(): boolean {
    return this.redisStatus() === 'ready';
  }

  private redisStatus(): string | undefined {
    return (this.redis as unknown as { status?: string }).status;
  }

  private runRedisWithTimeout<T>(
    operation: string,
    action: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          new Error(
            `Redis ${operation} timeout after ${WorkerConnectionQrCodeWwebjsConsume.ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS}ms`
          )
        );
      }, WorkerConnectionQrCodeWwebjsConsume.ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS);

      const finish = (): boolean => {
        if (settled) {
          return false;
        }
        settled = true;
        clearTimeout(timeout);
        return true;
      };

      const succeed = (value: T): void => {
        if (finish()) {
          resolve(value);
        }
      };

      const fail = (error: unknown): void => {
        if (finish()) {
          reject(error);
        }
      };

      try {
        action().then(succeed, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async close(): Promise<void> {
    this.stopped = true;

    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
    }

    this.isRunning = false;
    this.loopPromise = null;
  }
}
