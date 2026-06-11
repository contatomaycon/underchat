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

interface ActiveQrAttemptEnvelope {
  worker_type_id?: string;
  runtime_generation?: number;
  ack?: {
    connection_attempt_id?: string;
    worker_type_id?: string;
    runtime_generation?: number;
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
    const consumerName = this.redisQueueService.consumerName(
      workerId,
      EWorkerType.wwebjs
    );

    await this.redisQueueService.ensureGroup(workerId, EWorkerType.wwebjs);
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

    if (!this.isMessageForThisWorker(data)) {
      await this.ackAndDelete(message);
      return;
    }

    const active = await this.isActiveAttempt(data);
    if (!active) {
      await this.ackAndDelete(message);
      return;
    }

    try {
      const state = await this.requestLocalConnectionWithTimeout({
        worker_id: data.worker_id,
        status: EWorkerStatus.online,
        type: EBaileysConnectionType.qrcode,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation: data.runtime_generation,
        qr_pending: true,
      });

      await this.cacheQrAttemptState(state, data);

      if (this.isTerminalNoQrState(state)) {
        await this.releaseActiveAttemptIfCurrent(
          data.worker_id,
          data.connection_attempt_id
        );
        await this.redisQueueService.markProcessed(data);
        await this.ackAndDelete(message);
        return;
      }

      if (!this.shouldCompleteQrRequest(state)) {
        return;
      }

      await this.redisQueueService.markProcessed(data);

      await this.ackAndDelete(message);
    } catch (error) {
      if (this.isLocalRequestTimeoutError(error)) {
        await this.releaseActiveAttemptIfCurrent(
          data.worker_id,
          data.connection_attempt_id
        );
        await this.redisQueueService.markProcessed(data);
        await this.ackAndDelete(message);
      }
    }
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
