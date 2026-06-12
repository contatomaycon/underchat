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
  WorkerConnectionQrCodeRedisQueueService,
  WorkerConnectionQrCodeRedisStreamMessage,
} from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

interface ActiveQrAttemptEnvelope {
  worker_type_id?: string;
  runtime_generation?: number | string;
  ack?: {
    connection_attempt_id?: string;
    worker_type_id?: string;
    runtime_generation?: number | string;
  };
}

@singleton()
export class WorkerConnectionQrCodeWwebjsConsume {
  private static readonly ACTIVE_ATTEMPT_REDIS_TIMEOUT_MS = 1_000;
  private static readonly QR_CACHE_TTL_SECONDS = Math.max(
    1,
    Math.min(
      600,
      Number(process.env.CONNECTION_QRCODE_CACHE_TTL_SECONDS) || 115
    )
  );
  private static readonly QR_MAX_AGE_MS = Math.max(
    30_000,
    Math.min(
      600_000,
      Number(process.env.CONNECTION_QRCODE_MAX_AGE_MS) || 120_000
    )
  );
  private static readonly LOCAL_REQUEST_TIMEOUT_MS = Math.max(
    10_000,
    Math.min(
      180_000,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_LOCAL_REQUEST_TIMEOUT_MS) ||
        45_000
    )
  );
  private static readonly LOCAL_REQUEST_MAX_ATTEMPTS = Math.max(
    1,
    Math.min(
      4,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_LOCAL_MAX_ATTEMPTS) || 2
    )
  );
  private static readonly LOCAL_REQUEST_RETRY_DELAY_MS = Math.max(
    250,
    Math.min(
      30_000,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_LOCAL_RETRY_DELAY_MS) || 2_000
    )
  );
  private isRunning = false;
  private stopped = true;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService,
    @inject(WorkerConnectionStatusWwebjsConsume)
    private readonly workerConnectionStatusConsume: WorkerConnectionStatusWwebjsConsume,
    @inject('Redis') private readonly redis: Redis,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  public async execute(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const consumerName = this.redisQueueService.consumerName(
      workerId,
      EWorkerType.wwebjs
    );

    await this.redisQueueService.ensureGroup(workerId, EWorkerType.wwebjs);
    void this.connectionLifecycleDebugService.log(
      'wwebjs.qr_stream.consumer_started',
      {
        layer: 'wwebjs',
        worker_id: workerId,
        account_id: wwebjsEnvironment.wwebjsAccountId,
        worker_type_id: EWorkerType.wwebjs,
        consumer_name: consumerName,
      }
    );
    this.stopped = false;
    this.isRunning = true;

    this.loopPromise = this.consumeLoop(workerId, consumerName).catch(() => {
      this.isRunning = false;
    });
  }

  private async consumeLoop(
    workerId: string,
    consumerName: string
  ): Promise<void> {
    while (!this.stopped) {
      try {
        const claimed = await this.redisQueueService.claimPending(
          workerId,
          EWorkerType.wwebjs,
          consumerName
        );
        if (claimed.length > 0) {
          await this.processMessages(claimed);
          continue;
        }

        const messages = await this.redisQueueService.readNew(
          workerId,
          EWorkerType.wwebjs,
          consumerName
        );
        await this.processMessages(messages);
      } catch {
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
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.invalid_payload',
        {
          layer: 'wwebjs',
          stream_id: message.stream_id,
          stream_key: message.stream_key,
        }
      );
      await this.ackAndDelete(message);
      return;
    }

    const deliveryCount =
      message.delivery_count ??
      (await this.redisQueueService.getDeliveryCount(
        data.worker_id,
        data.worker_type_id,
        message.stream_id
      ));
    await this.processMessage({
      ...message,
      delivery_count: deliveryCount,
    });
  }

  private async processMessage(
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<void> {
    const data = message.payload;
    if (!data) {
      await this.ackAndDelete(message);
      return;
    }

    void this.connectionLifecycleDebugService.log('wwebjs.qr_stream.received', {
      trace_id: data.debug_trace_id,
      layer: 'wwebjs',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      stream_id: message.stream_id,
      reclaimed: message.reclaimed,
      delivery_count: message.delivery_count,
      queue_latency_ms: message.queue_latency_ms,
    });

    if (!this.isMessageForThisWorker(data)) {
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.skipped_wrong_worker',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          connection_attempt_id: data.connection_attempt_id,
          runtime_generation: data.runtime_generation,
          stream_id: message.stream_id,
        }
      );
      await this.ackAndDelete(message);
      return;
    }

    const active = await this.isActiveAttempt(data);
    if (!active) {
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.skipped_inactive_attempt',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          connection_attempt_id: data.connection_attempt_id,
          runtime_generation: data.runtime_generation,
          stream_id: message.stream_id,
        }
      );
      await this.ackAndDelete(message);
      return;
    }

    try {
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.request_connection',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          connection_attempt_id: data.connection_attempt_id,
          runtime_generation: data.runtime_generation,
          stream_id: message.stream_id,
        }
      );
      const state = await this.requestLocalConnectionWithRetries(data, message);

      await this.cacheQrAttemptState(state, data);
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.connection_response',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: state.worker_type_id ?? data.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? data.connection_attempt_id,
          runtime_generation:
            state.runtime_generation ?? data.runtime_generation,
          status: state.status,
          code: state.code,
          reason: state.reason,
          qrcode: state.qrcode,
          pairing_code: state.pairing_code,
          stream_id: message.stream_id,
        }
      );

      if (this.isTerminalNoQrState(state)) {
        await this.releaseActiveAttemptIfCurrent(
          data.worker_id,
          data.connection_attempt_id
        );
        await this.redisQueueService.markProcessed(data);
        await this.ackAndDelete(message);
        void this.connectionLifecycleDebugService.log(
          'wwebjs.qr_stream.completed_terminal_no_qr',
          {
            trace_id: data.debug_trace_id,
            layer: 'wwebjs',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            connection_attempt_id: data.connection_attempt_id,
            runtime_generation: data.runtime_generation,
            stream_id: message.stream_id,
            reason: state.reason,
          }
        );
        return;
      }

      if (!this.shouldCompleteQrRequest(state)) {
        return;
      }

      await this.redisQueueService.markProcessed(data);

      await this.ackAndDelete(message);
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.completed',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          connection_attempt_id: data.connection_attempt_id,
          runtime_generation: data.runtime_generation,
          stream_id: message.stream_id,
        }
      );
    } catch (error) {
      if (this.isLocalRequestTimeoutError(error)) {
        await this.releaseActiveAttemptIfCurrent(
          data.worker_id,
          data.connection_attempt_id
        );
        await this.redisQueueService.markProcessed(data);
        await this.ackAndDelete(message);
      }
      void this.connectionLifecycleDebugService.log('wwebjs.qr_stream.error', {
        trace_id: data.debug_trace_id,
        layer: 'wwebjs',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation: data.runtime_generation,
        stream_id: message.stream_id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async requestLocalConnectionWithRetries(
    data: IWorkerConnectionQrCodeQueueMessage,
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<IBaileysConnectionState> {
    let lastTerminalNoQrState: IBaileysConnectionState | null = null;

    for (
      let attempt = 1;
      attempt <= WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const state = await this.requestLocalConnectionWithTimeout({
          worker_id: data.worker_id,
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: data.connection_attempt_id,
          debug_trace_id: data.debug_trace_id,
          runtime_generation: data.runtime_generation,
          qr_pending: true,
        });

        if (!this.isTerminalNoQrState(state)) {
          return state;
        }

        lastTerminalNoQrState = state;
        if (
          attempt >=
          WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS
        ) {
          return state;
        }

        void this.connectionLifecycleDebugService.log(
          'wwebjs.qr_stream.retry_after_terminal_no_qr',
          {
            trace_id: data.debug_trace_id,
            layer: 'wwebjs',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            connection_attempt_id: data.connection_attempt_id,
            runtime_generation: data.runtime_generation,
            stream_id: message.stream_id,
            local_attempt: attempt,
            next_local_attempt: attempt + 1,
            max_local_attempts:
              WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS,
            reason: state.reason,
          }
        );
      } catch (error) {
        if (
          !this.isLocalRequestTimeoutError(error) ||
          attempt >=
            WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS
        ) {
          throw error;
        }

        void this.connectionLifecycleDebugService.log(
          'wwebjs.qr_stream.retry_after_local_timeout',
          {
            trace_id: data.debug_trace_id,
            layer: 'wwebjs',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            connection_attempt_id: data.connection_attempt_id,
            runtime_generation: data.runtime_generation,
            stream_id: message.stream_id,
            local_attempt: attempt,
            next_local_attempt: attempt + 1,
            max_local_attempts:
              WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS,
            reason: error instanceof Error ? error.message : String(error),
          }
        );
      }

      await this.delay(
        WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_RETRY_DELAY_MS
      );
    }

    if (lastTerminalNoQrState) {
      return lastTerminalNoQrState;
    }

    throw new Error('WWebJS local QR request did not return a state');
  }

  private requestLocalConnectionWithTimeout(
    payload: StatusConnectionWorkerRequest
  ): Promise<IBaileysConnectionState> {
    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.workerConnectionStatusConsume.cancelConnectionAttempt();
        reject(
          new Error(
            `WWebJS local QR request timed out after ${WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_TIMEOUT_MS}ms`
          )
        );
      }, WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_TIMEOUT_MS);

      this.workerConnectionStatusConsume.requestConnection(payload).then(
        (state) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          resolve(state);
        },
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  private isTerminalNoQrState(state: IBaileysConnectionState): boolean {
    if (state.qrcode || state.pairing_code) {
      return false;
    }

    return (
      state.reason === 'qr_event_timeout' ||
      state.reason === 'first_qr_timeout' ||
      state.reason === 'connection_attempt_guard_timeout'
    );
  }

  private isLocalRequestTimeoutError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('WWebJS local QR request timed out')
    );
  }

  private shouldCompleteQrRequest(state: IBaileysConnectionState): boolean {
    if (state.qrcode || state.pairing_code) {
      return true;
    }

    if (state.status === EBaileysConnectionStatus.connected) {
      return true;
    }

    return (
      state.status === EBaileysConnectionStatus.disconnected &&
      typeof state.attempt === 'number' &&
      typeof state.max_attempts === 'number' &&
      state.max_attempts > 0 &&
      state.attempt > state.max_attempts
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

  private activeAttemptKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`;
  }

  private qrAttemptCacheKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:attempt`;
  }

  private async isActiveAttempt(
    data: IWorkerConnectionQrCodeQueueMessage
  ): Promise<boolean> {
    if (!this.isRedisReady()) {
      return true;
    }

    try {
      const processed = await this.redisGetWithTimeout(
        this.redisQueueService.processedAttemptKey(
          data.worker_id,
          data.worker_type_id,
          data.connection_attempt_id
        ),
        'processed_attempt'
      );
      if (processed) {
        return false;
      }

      const raw = await this.redisGetWithTimeout(
        this.activeAttemptKey(data.worker_id, data.worker_type_id),
        'active_attempt'
      );
      if (!raw) {
        return false;
      }

      try {
        const parsed = JSON.parse(raw) as ActiveQrAttemptEnvelope;
        const activeRuntimeGeneration =
          parsed.runtime_generation ?? parsed.ack?.runtime_generation;
        const activeWorkerTypeId =
          parsed.worker_type_id ?? parsed.ack?.worker_type_id;
        const active =
          parsed.ack?.connection_attempt_id === data.connection_attempt_id &&
          (!activeWorkerTypeId || activeWorkerTypeId === data.worker_type_id) &&
          !(
            data.runtime_generation !== undefined &&
            activeRuntimeGeneration === undefined
          ) &&
          (activeRuntimeGeneration === undefined ||
            activeRuntimeGeneration === data.runtime_generation);
        return active;
      } catch {
        return false;
      }
    } catch {
      return false;
    }
  }

  private async releaseActiveAttemptIfCurrent(
    workerId: string,
    connectionAttemptId: string
  ): Promise<void> {
    if (!this.isRedisReady()) {
      return;
    }

    try {
      const key = this.activeAttemptKey(workerId, EWorkerType.wwebjs);
      const raw = await this.redisGetWithTimeout(key, 'active_attempt_release');
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as ActiveQrAttemptEnvelope;
      if (parsed.ack?.connection_attempt_id !== connectionAttemptId) {
        return;
      }

      await this.redis.del(key);
    } catch {}
  }

  private async cacheQrAttemptState(
    state: IBaileysConnectionState,
    data: IWorkerConnectionQrCodeQueueMessage
  ): Promise<void> {
    if (!state.qrcode && !state.pairing_code) {
      return;
    }

    if (state.worker_type_id && state.worker_type_id !== EWorkerType.wwebjs) {
      return;
    }

    const normalized: IBaileysConnectionState = {
      ...state,
      worker_id: state.worker_id || data.worker_id,
      account_id: state.account_id || data.account_id,
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id:
        state.connection_attempt_id || data.connection_attempt_id,
      debug_trace_id: state.debug_trace_id ?? data.debug_trace_id,
      runtime_generation: state.runtime_generation ?? data.runtime_generation,
      qr_pending: false,
      qr_generated_at: state.qr_generated_at || new Date().toISOString(),
    };
    normalized.expires_at ??= this.qrExpiresAt(normalized);
    const ttlSeconds = this.qrCacheTtlForState(normalized);

    try {
      await this.redis.set(
        this.qrAttemptCacheKey(normalized.worker_id, EWorkerType.wwebjs),
        JSON.stringify(normalized),
        'EX',
        ttlSeconds
      );
    } catch {}
  }

  private qrCacheTtlForState(state: IBaileysConnectionState): number {
    if (!state.qrcode || !state.qr_generated_at) {
      return WorkerConnectionQrCodeWwebjsConsume.QR_CACHE_TTL_SECONDS;
    }

    const generatedAtMs = Date.parse(state.qr_generated_at);
    if (!Number.isFinite(generatedAtMs)) {
      return WorkerConnectionQrCodeWwebjsConsume.QR_CACHE_TTL_SECONDS;
    }

    const remainingSeconds = Math.max(
      1,
      Math.floor(
        (WorkerConnectionQrCodeWwebjsConsume.QR_MAX_AGE_MS -
          Math.max(0, Date.now() - generatedAtMs)) /
          1000
      )
    );

    return Math.min(
      WorkerConnectionQrCodeWwebjsConsume.QR_CACHE_TTL_SECONDS,
      remainingSeconds
    );
  }

  private qrExpiresAt(state: IBaileysConnectionState): string | undefined {
    if (!state.qr_generated_at) {
      return undefined;
    }

    const generatedAtMs = Date.parse(state.qr_generated_at);
    if (!Number.isFinite(generatedAtMs)) {
      return undefined;
    }

    return new Date(
      generatedAtMs + WorkerConnectionQrCodeWwebjsConsume.QR_MAX_AGE_MS
    ).toISOString();
  }

  private async ackAndDelete(
    message: WorkerConnectionQrCodeRedisStreamMessage
  ): Promise<void> {
    await this.redisQueueService.ackAndDelete(
      message.payload?.worker_id ?? wwebjsEnvironment.wwebjsWorkerId,
      message.payload?.worker_type_id ?? EWorkerType.wwebjs,
      message.stream_id
    );
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
