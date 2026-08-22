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
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import {
  WorkerConnectionQrCodeRedisQueueService,
  WorkerConnectionQrCodeRedisStreamMessage,
} from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import {
  isRetryableWorkerRuntimeTransitionError,
  workerErrorDiagnostics,
  workerErrorFailureReason,
} from '@core/common/functions/workerErrorDiagnostics';

interface ActiveQrAttemptEnvelope {
  worker_type_id?: string;
  runtime_generation?: number | string;
  authorized_connection_epoch?: string;
  ack?: {
    connection_attempt_id?: string;
    worker_type_id?: string;
    runtime_generation?: number | string;
    authorized_connection_epoch?: string;
  };
}

const QR_ATTEMPT_SUPERSEDED_ERROR = 'worker_qr_attempt_superseded';
const ACTIVE_ATTEMPT_IDENTITY_MISSING = '__underchat_missing_identity__';
const RELEASE_ACTIVE_ATTEMPT_IF_CURRENT_SCRIPT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then
    return 0
  end

  local decoded_ok, envelope = pcall(cjson.decode, raw)
  if not decoded_ok or type(envelope) ~= 'table'
    or type(envelope['ack']) ~= 'table'
  then
    return 0
  end

  local ack = envelope['ack']
  local missing = ARGV[5]
  local function coalesce_identity(primary, fallback)
    if primary == nil or primary == cjson.null then
      return fallback
    end
    return primary
  end
  local function normalize_identity(value)
    if value == nil or value == cjson.null then
      return missing
    end
    return tostring(value)
  end

  local active_attempt_id = ack['connection_attempt_id']
  local active_authorized_epoch = coalesce_identity(
    envelope['authorized_connection_epoch'],
    ack['authorized_connection_epoch']
  )
  local active_worker_type = coalesce_identity(
    envelope['worker_type_id'],
    ack['worker_type_id']
  )
  local active_runtime_generation = coalesce_identity(
    envelope['runtime_generation'],
    ack['runtime_generation']
  )

  if normalize_identity(active_attempt_id) ~= ARGV[1]
    or normalize_identity(active_authorized_epoch) ~= ARGV[2]
    or normalize_identity(active_worker_type) ~= ARGV[3]
    or normalize_identity(active_runtime_generation) ~= ARGV[4]
  then
    return 0
  end

  return redis.call('DEL', KEYS[1])
`;

@singleton()
export class WorkerConnectionQrCodeWwebjsConsume {
  private static readonly RETRYABLE_TERMINAL_NO_QR_REASONS = new Set([
    'qr_event_timeout',
    'first_qr_timeout',
    'connection_attempt_guard_timeout',
  ]);
  private static readonly RETRYABLE_INFRASTRUCTURE_ERROR_CODES = new Set([
    '40001',
    '40p01',
    '53300',
    '53400',
    '55p03',
    '57014',
    '57p01',
    '57p02',
    '57p03',
    'eai_again',
    'econnaborted',
    'econnrefused',
    'econnreset',
    'ehostunreach',
    'enetdown',
    'enetunreach',
    'enotfound',
    'epipe',
    'etimedout',
    'err_socket_closed',
    'err_stream_premature_close',
    'p1001',
    'p1002',
    'p1008',
    'p1017',
    'p2024',
  ]);
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
  private static readonly FIRST_QR_SETUP_TIMEOUT_MS = Math.max(
    30_000,
    Math.min(
      300_000,
      Number(process.env.CONNECTION_QRCODE_FIRST_QR_SETUP_TIMEOUT_MS) || 120_000
    )
  );
  private static readonly STREAM_MAX_DELIVERIES = Math.max(
    1,
    Math.min(
      20,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_STREAM_MAX_DELIVERIES) || 5
    )
  );
  private static readonly STREAM_RETRY_BASE_DELAY_MS = Math.max(
    1_000,
    Math.min(
      30_000,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_STREAM_RETRY_BASE_DELAY_MS) ||
        5_000
    )
  );
  private static readonly STREAM_RETRY_MAX_DELAY_MS = Math.max(
    WorkerConnectionQrCodeWwebjsConsume.STREAM_RETRY_BASE_DELAY_MS,
    Math.min(
      60_000,
      Number(process.env.CONNECTION_QRCODE_WWEBJS_STREAM_RETRY_MAX_DELAY_MS) ||
        30_000
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
      worker_type_id: EWorkerType.wwebjs,
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

      if (!(await this.cacheQrAttemptState(state, data))) {
        this.workerConnectionStatusConsume.cancelConnectionAttempt();
        await this.ackAndDelete(message);
        return;
      }
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
          stream_id: message.stream_id,
        }
      );

      if (this.isTerminalNoQrState(state)) {
        await this.releaseActiveAttemptIfCurrent(
          data.worker_id,
          data.connection_attempt_id,
          data.authorized_connection_epoch,
          data.runtime_generation
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
      if (
        error instanceof Error &&
        error.message === QR_ATTEMPT_SUPERSEDED_ERROR
      ) {
        this.workerConnectionStatusConsume.cancelConnectionAttempt();
        await this.ackAndDelete(message);
        return;
      }
      const deliveryCount = Math.max(1, message.delivery_count ?? 1);
      const retryableInfrastructureFailure =
        this.isRetryableInfrastructureError(error);
      const exhausted =
        deliveryCount >=
        WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES;
      const setupDeadlineExceeded = this.isQrSetupDeadlineExceeded(data);
      const terminal =
        !retryableInfrastructureFailure ||
        (setupDeadlineExceeded &&
          (this.isLocalRequestTimeoutError(error) || exhausted));

      if (terminal) {
        await this.finalizeFailedAttempt(data, message, error, deliveryCount);
      } else {
        const retryDelayMs = this.streamRetryDelayMs(deliveryCount);
        void this.connectionLifecycleDebugService.log(
          'wwebjs.qr_stream.retry_deferred',
          {
            trace_id: data.debug_trace_id,
            layer: 'wwebjs',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            connection_attempt_id: data.connection_attempt_id,
            runtime_generation: data.runtime_generation,
            stream_id: message.stream_id,
            delivery_count: deliveryCount,
            max_deliveries:
              WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES,
            retry_delay_ms: retryDelayMs,
            ...workerErrorDiagnostics(error),
          }
        );
        await this.delay(retryDelayMs);
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
        delivery_count: deliveryCount,
        max_deliveries:
          WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES,
        retryable: retryableInfrastructureFailure,
        terminal,
        ...workerErrorDiagnostics(error),
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
        if (!(await this.isActiveAttempt(data))) {
          throw new Error(QR_ATTEMPT_SUPERSEDED_ERROR);
        }
        const state = await this.requestLocalConnectionWithTimeout({
          worker_id: data.worker_id,
          status: EWorkerStatus.online,
          type: EBaileysConnectionType.qrcode,
          connection_attempt_id: data.connection_attempt_id,
          authorized_connection_epoch: data.authorized_connection_epoch,
          debug_trace_id: data.debug_trace_id,
          runtime_generation: data.runtime_generation,
          qr_pending: true,
        });
        if (!(await this.isActiveAttempt(data))) {
          throw new Error(QR_ATTEMPT_SUPERSEDED_ERROR);
        }

        if (!this.isTerminalNoQrState(state)) {
          return state;
        }

        lastTerminalNoQrState = state;
        if (!this.isRetryableTerminalNoQrState(state)) {
          return state;
        }
        if (
          attempt >=
          WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS
        ) {
          return this.isQrSetupDeadlineExceeded(data)
            ? state
            : this.buildPendingNoQrState(data, state);
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
          (!this.isLocalRequestTimeoutError(error) &&
            !this.isRetryableInfrastructureError(error)) ||
          attempt >=
            WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_MAX_ATTEMPTS
        ) {
          if (
            this.isLocalRequestTimeoutError(error) &&
            !this.isQrSetupDeadlineExceeded(data)
          ) {
            return this.buildPendingNoQrState(
              data,
              lastTerminalNoQrState,
              error
            );
          }
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
            ...workerErrorDiagnostics(error),
          }
        );
      }

      await this.delay(
        WorkerConnectionQrCodeWwebjsConsume.LOCAL_REQUEST_RETRY_DELAY_MS
      );
    }

    if (lastTerminalNoQrState) {
      return this.isQrSetupDeadlineExceeded(data)
        ? lastTerminalNoQrState
        : this.buildPendingNoQrState(data, lastTerminalNoQrState);
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
      state.status === EBaileysConnectionStatus.disconnected ||
      this.isRetryableTerminalNoQrState(state)
    );
  }

  private isRetryableTerminalNoQrState(
    state: IBaileysConnectionState
  ): boolean {
    return WorkerConnectionQrCodeWwebjsConsume.RETRYABLE_TERMINAL_NO_QR_REASONS.has(
      state.reason ?? ''
    );
  }

  private buildPendingNoQrState(
    data: IWorkerConnectionQrCodeQueueMessage,
    state?: IBaileysConnectionState | null,
    error?: unknown
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitConnection,
      status: EBaileysConnectionStatus.connecting,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.disponible,
      connection_attempt_id: data.connection_attempt_id,
      authorized_connection_epoch: data.authorized_connection_epoch,
      runtime_generation: data.runtime_generation,
      debug_trace_id: data.debug_trace_id,
      qr_pending: true,
      retryable: true,
      reason: 'first_qr_pending',
      degraded_reason:
        state?.reason ??
        (error instanceof Error ? error.message : 'first_qr_pending'),
    };
  }

  private isQrSetupDeadlineExceeded(
    data: IWorkerConnectionQrCodeQueueMessage
  ): boolean {
    const requestedAt = Date.parse(data.requested_at);
    if (!Number.isFinite(requestedAt)) {
      return true;
    }

    return (
      Date.now() - requestedAt >=
      WorkerConnectionQrCodeWwebjsConsume.FIRST_QR_SETUP_TIMEOUT_MS
    );
  }

  private isLocalRequestTimeoutError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('WWebJS local QR request timed out')
    );
  }

  private isRetryableInfrastructureError(error: unknown): boolean {
    if (isRetryableWorkerRuntimeTransitionError(error)) {
      return true;
    }

    const { error_code: errorCode } = workerErrorDiagnostics(error);
    if (/^08[a-z0-9]{3}$/.test(errorCode)) {
      return true;
    }

    return WorkerConnectionQrCodeWwebjsConsume.RETRYABLE_INFRASTRUCTURE_ERROR_CODES.has(
      errorCode
    );
  }

  private streamRetryDelayMs(deliveryCount: number): number {
    const exponent = Math.max(0, Math.min(6, deliveryCount - 1));
    return Math.min(
      WorkerConnectionQrCodeWwebjsConsume.STREAM_RETRY_MAX_DELAY_MS,
      WorkerConnectionQrCodeWwebjsConsume.STREAM_RETRY_BASE_DELAY_MS *
        2 ** exponent
    );
  }

  private async finalizeFailedAttempt(
    data: IWorkerConnectionQrCodeQueueMessage,
    message: WorkerConnectionQrCodeRedisStreamMessage,
    error: unknown,
    deliveryCount: number
  ): Promise<void> {
    const reason = workerErrorFailureReason(
      'wwebjs_qr_connection_temporarily_unavailable',
      error
    );
    let state: IBaileysConnectionState;
    try {
      state =
        await this.workerConnectionStatusConsume.publishQrCodeAttemptFailed(
          {
            worker_id: data.worker_id,
            status: EWorkerStatus.online,
            type: EBaileysConnectionType.qrcode,
            connection_attempt_id: data.connection_attempt_id,
            authorized_connection_epoch: data.authorized_connection_epoch,
            debug_trace_id: data.debug_trace_id,
            runtime_generation: data.runtime_generation,
            qr_pending: false,
          },
          {
            attempt:
              WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES + 1,
            maxAttempts:
              WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES,
            reason,
            degradedReason: reason,
          }
        );
    } catch (publishError) {
      void this.connectionLifecycleDebugService.log(
        'wwebjs.qr_stream.failed_attempt_projection_deferred',
        {
          trace_id: data.debug_trace_id,
          layer: 'wwebjs',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: data.worker_type_id,
          connection_attempt_id: data.connection_attempt_id,
          runtime_generation: data.runtime_generation,
          stream_id: message.stream_id,
          delivery_count: deliveryCount,
          retry_delay_ms:
            WorkerConnectionQrCodeWwebjsConsume.STREAM_RETRY_MAX_DELAY_MS,
          ...workerErrorDiagnostics(publishError),
        }
      );
      await this.delay(
        WorkerConnectionQrCodeWwebjsConsume.STREAM_RETRY_MAX_DELAY_MS
      );
      throw publishError;
    }

    await this.releaseActiveAttemptIfCurrent(
      data.worker_id,
      data.connection_attempt_id,
      data.authorized_connection_epoch,
      data.runtime_generation
    );
    await this.redisQueueService.markProcessed(data);
    await this.ackAndDelete(message);
    void this.connectionLifecycleDebugService.log(
      'wwebjs.qr_stream.failed_attempt_finalized',
      {
        trace_id: data.debug_trace_id,
        layer: 'wwebjs',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        connection_attempt_id: data.connection_attempt_id,
        runtime_generation: data.runtime_generation,
        stream_id: message.stream_id,
        delivery_count: deliveryCount,
        max_deliveries:
          WorkerConnectionQrCodeWwebjsConsume.STREAM_MAX_DELIVERIES,
        status: state.status,
        code: state.code,
        reason: state.reason,
        retryable: state.retryable,
        ...workerErrorDiagnostics(error),
      }
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
        const activeAuthorizedConnectionEpoch =
          parsed.authorized_connection_epoch ??
          parsed.ack?.authorized_connection_epoch;
        const active =
          parsed.ack?.connection_attempt_id === data.connection_attempt_id &&
          activeAuthorizedConnectionEpoch ===
            data.authorized_connection_epoch &&
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
    connectionAttemptId: string,
    authorizedConnectionEpoch?: string,
    runtimeGeneration?: number
  ): Promise<void> {
    if (!this.isRedisReady()) {
      return;
    }

    try {
      const key = this.activeAttemptKey(workerId, EWorkerType.wwebjs);
      await this.runRedisWithTimeout('EVAL active_attempt_release', () =>
        this.redis.eval(
          RELEASE_ACTIVE_ATTEMPT_IF_CURRENT_SCRIPT,
          1,
          key,
          connectionAttemptId,
          authorizedConnectionEpoch ?? ACTIVE_ATTEMPT_IDENTITY_MISSING,
          EWorkerType.wwebjs,
          runtimeGeneration === undefined
            ? ACTIVE_ATTEMPT_IDENTITY_MISSING
            : String(runtimeGeneration),
          ACTIVE_ATTEMPT_IDENTITY_MISSING
        )
      );
    } catch {}
  }

  private async cacheQrAttemptState(
    state: IBaileysConnectionState,
    data: IWorkerConnectionQrCodeQueueMessage
  ): Promise<boolean> {
    if (!state.qrcode && !state.pairing_code) {
      return true;
    }

    if (state.worker_type_id && state.worker_type_id !== EWorkerType.wwebjs) {
      return true;
    }

    const normalized: IBaileysConnectionState = {
      ...state,
      worker_id: state.worker_id || data.worker_id,
      account_id: state.account_id || data.account_id,
      worker_type_id: EWorkerType.wwebjs,
      connection_attempt_id:
        state.connection_attempt_id || data.connection_attempt_id,
      authorized_connection_epoch:
        state.authorized_connection_epoch ?? data.authorized_connection_epoch,
      debug_trace_id: state.debug_trace_id ?? data.debug_trace_id,
      runtime_generation: state.runtime_generation ?? data.runtime_generation,
      qr_pending: false,
      qr_generated_at: state.qr_generated_at || new Date().toISOString(),
    };
    normalized.expires_at ??= this.qrExpiresAt(normalized);
    const ttlSeconds = this.qrCacheTtlForState(normalized);

    if (!this.isRedisReady()) {
      return true;
    }
    return this.redisQueueService.cacheAttemptStateIfActive(
      data,
      JSON.stringify(normalized),
      ttlSeconds
    );
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
