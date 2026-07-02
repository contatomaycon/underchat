import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import {
  IWorkerConnectionQrCodeQueueMessage,
  WorkerConnectionQrCodeQueueSource,
} from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { WorkerService } from '@core/services/worker.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';

interface ActiveQrAttempt {
  ack: IBaileysConnectionState;
  queued_at: string;
  stream_key: string;
  stream_id?: string;
  consumer_group: string;
  source: WorkerConnectionQrCodeQueueSource;
  worker_type_id?: string;
  runtime_generation?: number;
}

function optionalRuntimeGeneration(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
  }

  return undefined;
}

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
  private readonly activeAttemptTtlSeconds = Math.max(
    180,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_TTL_SECONDS) || 600
  );
  private readonly activeAttemptDedupeMaxAgeMs = Math.max(
    30_000,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_DEDUPE_MAX_AGE_MS) ||
      120_000
  );
  private readonly cachedQrMaxAgeMs = 120_000;
  private readonly supportedWorkerTypes = new Set<string>([
    EWorkerType.baileys,
    EWorkerType.wwebjs,
    EWorkerType.whatsmeow,
  ]);
  private readonly qrRequestableWorkerStatuses = new Set<string>([
    EWorkerStatus.disponible,
    EWorkerStatus.creating,
    EWorkerStatus.recreating,
  ]);

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis,
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService = new WorkerConnectionQrCodeRedisQueueService(
      redis
    ),
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    source: WorkerConnectionQrCodeQueueSource = 'manager',
    debugTraceIdInput?: string
  ): Promise<IBaileysConnectionState> {
    return this.executeWithLifecycle(
      t,
      accountId,
      workerId,
      source,
      debugTraceIdInput
    );
  }

  private async executeWithLifecycle(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    source: WorkerConnectionQrCodeQueueSource,
    debugTraceIdInput?: string
  ): Promise<IBaileysConnectionState> {
    const debugTraceId =
      debugTraceIdInput ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('qr_request')
        : undefined);

    void this.connectionLifecycleDebugService.log('manager.qr_request.start', {
      trace_id: debugTraceId,
      layer: 'manager',
      worker_id: workerId,
      account_id: accountId,
      source,
    });

    const existsWorkerAccountById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerAccountById) {
      throw new Error(t('worker_not_found'));
    }

    const view = await this.workerService.viewWorker(accountId, workerId);
    const workerTypeId = view?.type?.id;
    const workerStatusId = view?.status?.id;
    const serverId = view?.server?.id;
    const runtimeGeneration =
      await this.resolveRuntimeGenerationSafely(workerId);

    void this.connectionLifecycleDebugService.log(
      'manager.qr_request.worker_resolved',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        status: workerStatusId,
        runtime_generation: runtimeGeneration,
        server_id: serverId,
      }
    );

    if (!view || !serverId || !workerTypeId) {
      throw new Error(t('worker_not_found'));
    }

    if (!this.supportedWorkerTypes.has(workerTypeId)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (
      !workerStatusId ||
      !this.qrRequestableWorkerStatuses.has(workerStatusId)
    ) {
      throw new Error(t('worker_qrcode_not_ready'));
    }

    let existing = await this.getActiveAttempt(workerId, workerTypeId);
    if (existing) {
      const invalidReason = await this.getActiveAttemptInvalidReason(
        workerId,
        workerTypeId,
        existing,
        runtimeGeneration
      );

      if (invalidReason) {
        await this.redis.del(this.activeAttemptKey(workerId, workerTypeId));
        void this.connectionLifecycleDebugService.log(
          'manager.qr_request.active_attempt_invalidated',
          {
            trace_id: debugTraceId,
            layer: 'manager',
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: workerTypeId,
            runtime_generation: runtimeGeneration,
            connection_attempt_id: existing.ack.connection_attempt_id,
            reason: invalidReason,
          }
        );
        existing = null;
      }
    }

    const cachedQr = await this.getCachedQrAttemptState(
      workerId,
      accountId,
      workerTypeId,
      workerStatusId,
      runtimeGeneration
    );
    if (cachedQr && this.hasConnectionCredential(cachedQr)) {
      const response = {
        ...this.hydrateCachedQrResponse(cachedQr, existing),
        debug_trace_id: debugTraceId,
      };

      await this.publishCachedQr(response);
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.cached_qr_returned',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerTypeId,
          runtime_generation: runtimeGeneration,
          connection_attempt_id: response.connection_attempt_id,
          has_qr: Boolean(response.qrcode),
          has_passkey_public_key: Boolean(response.passkey_public_key),
          has_passkey_confirmation_code: Boolean(
            response.passkey_confirmation_code
          ),
          qr_generated_at: response.qr_generated_at,
          reason: response.reason,
        }
      );

      return response;
    }

    if (existing) {
      const existingConnectionAttemptId = existing.ack.connection_attempt_id;
      if (!existingConnectionAttemptId) {
        await this.redis.del(this.activeAttemptKey(workerId, workerTypeId));
      } else {
        const response = {
          ...existing.ack,
          debug_trace_id: debugTraceId,
          worker_type_id: workerTypeId as EWorkerType,
          worker_status_id: workerStatusId as EWorkerStatus | undefined,
          reason: 'queued',
          qr_pending: true,
          qrcode: undefined,
          pairing_code: undefined,
          passkey_public_key: undefined,
          passkey_confirmation_code: undefined,
          passkey_pending: undefined,
          runtime_generation:
            existing.ack.runtime_generation ?? runtimeGeneration,
        };

        await this.publishPendingAck(response);
        void this.connectionLifecycleDebugService.log(
          'manager.qr_request.active_attempt_returned',
          {
            trace_id: debugTraceId,
            layer: 'manager',
            worker_id: workerId,
            account_id: accountId,
            worker_type_id: workerTypeId,
            runtime_generation: response.runtime_generation,
            connection_attempt_id: response.connection_attempt_id,
            status: response.status,
            reason: response.reason,
          }
        );

        return response;
      }
    }

    const connectionAttemptId = uuidv7();
    const streamKey = this.redisQueueService.streamKey(workerId, workerTypeId);
    const consumerGroup = this.redisQueueService.consumerGroup(
      workerId,
      workerTypeId
    );
    const ack = this.buildPendingResponse(
      accountId,
      workerId,
      connectionAttemptId,
      workerTypeId,
      workerStatusId,
      runtimeGeneration,
      debugTraceId
    );

    const activeAttempt: ActiveQrAttempt = {
      ack,
      queued_at: new Date().toISOString(),
      stream_key: streamKey,
      consumer_group: consumerGroup,
      source,
      worker_type_id: workerTypeId,
      runtime_generation: runtimeGeneration,
    };

    const claimed = await this.claimActiveAttempt(
      workerId,
      workerTypeId,
      activeAttempt
    );
    void this.connectionLifecycleDebugService.log(
      'manager.qr_request.active_attempt_claimed',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        runtime_generation: runtimeGeneration,
        connection_attempt_id: connectionAttemptId,
        claimed,
      }
    );
    if (!claimed) {
      const current = await this.getActiveAttempt(workerId, workerTypeId);
      if (current) {
        return {
          ...current.ack,
          worker_type_id: workerTypeId as EWorkerType,
          worker_status_id: workerStatusId as EWorkerStatus | undefined,
          reason: 'queued',
          qr_pending: true,
          qrcode: undefined,
          pairing_code: undefined,
          passkey_public_key: undefined,
          passkey_confirmation_code: undefined,
          passkey_pending: undefined,
          runtime_generation:
            current.ack.runtime_generation ?? runtimeGeneration,
        };
      }

      throw new Error(t('worker_qrcode_not_ready'));
    }

    const requestedAt = new Date();
    const payload: IWorkerConnectionQrCodeQueueMessage = {
      request_id: uuidv7(),
      connection_attempt_id: connectionAttemptId,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
      source,
      requested_at: requestedAt.toISOString(),
      expires_at: new Date(
        requestedAt.getTime() + this.activeAttemptDedupeMaxAgeMs
      ).toISOString(),
    };

    try {
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.enqueue',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerTypeId,
          runtime_generation: runtimeGeneration,
          connection_attempt_id: connectionAttemptId,
          stream_key: streamKey,
        }
      );
      const streamId = await this.redisQueueService.enqueue(payload);
      await this.storeActiveAttemptStreamId(
        workerId,
        workerTypeId,
        connectionAttemptId,
        streamId
      );
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.enqueued',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerTypeId,
          runtime_generation: runtimeGeneration,
          connection_attempt_id: connectionAttemptId,
          stream_id: streamId,
        }
      );
    } catch (error) {
      await this.clearActiveAttempt(
        workerId,
        workerTypeId,
        connectionAttemptId
      );
      throw error;
    }

    await this.publishPendingAck(ack);
    void this.connectionLifecycleDebugService.log(
      'manager.qr_request.pending_ack_published',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        runtime_generation: runtimeGeneration,
        connection_attempt_id: connectionAttemptId,
        status: ack.status,
        reason: ack.reason,
      }
    );

    return ack;
  }

  private activeAttemptKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`;
  }

  private async resolveRuntimeGenerationSafely(
    workerId: string
  ): Promise<number | undefined> {
    if (!this.workerRuntimeRepository) {
      return undefined;
    }

    try {
      const runtime =
        await this.workerRuntimeRepository.viewByWorkerId(workerId);
      return runtime?.runtime_generation;
    } catch {
      return undefined;
    }
  }

  private qrExpiresAt(qrGeneratedAt?: string): string | undefined {
    if (!qrGeneratedAt) {
      return undefined;
    }

    const generatedAtMs = Date.parse(qrGeneratedAt);
    if (!Number.isFinite(generatedAtMs)) {
      return undefined;
    }

    return new Date(generatedAtMs + this.cachedQrMaxAgeMs).toISOString();
  }

  private processedAttemptKey(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:processed:${connectionAttemptId}`;
  }

  private qrAttemptCacheKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:attempt`;
  }

  private async getActiveAttemptInvalidReason(
    workerId: string,
    workerTypeId: string,
    attempt: ActiveQrAttempt,
    runtimeGeneration?: number
  ): Promise<string | undefined> {
    const connectionAttemptId = attempt.ack.connection_attempt_id;
    if (!connectionAttemptId) {
      return 'active_attempt_missing_connection_attempt_id';
    }

    if (attempt.worker_type_id && attempt.worker_type_id !== workerTypeId) {
      return 'active_attempt_worker_type_mismatch';
    }

    const activeRuntimeGeneration =
      attempt.runtime_generation ?? attempt.ack.runtime_generation;
    if (
      runtimeGeneration !== undefined &&
      activeRuntimeGeneration === undefined
    ) {
      return 'active_attempt_missing_runtime_generation';
    }

    if (
      activeRuntimeGeneration !== undefined &&
      runtimeGeneration !== undefined &&
      activeRuntimeGeneration !== runtimeGeneration
    ) {
      return 'active_attempt_runtime_generation_mismatch';
    }

    const processed = await this.redis.get(
      this.processedAttemptKey(workerId, workerTypeId, connectionAttemptId)
    );
    if (processed) {
      return 'active_attempt_already_processed';
    }

    const activeAttemptAgeMs = this.getActiveAttemptAgeMs(attempt);
    if (
      activeAttemptAgeMs !== undefined &&
      activeAttemptAgeMs >= this.activeAttemptDedupeMaxAgeMs
    ) {
      return 'active_attempt_pending_too_old';
    }

    return undefined;
  }

  private async storeActiveAttemptStreamId(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string,
    streamId: string
  ): Promise<void> {
    const current = await this.getActiveAttempt(workerId, workerTypeId);
    if (current?.ack.connection_attempt_id !== connectionAttemptId) {
      return;
    }

    await this.redis.set(
      this.activeAttemptKey(workerId, workerTypeId),
      JSON.stringify({
        ...current,
        stream_id: streamId,
      }),
      'EX',
      this.activeAttemptTtlSeconds
    );
  }

  private async getActiveAttempt(
    workerId: string,
    workerTypeId: string
  ): Promise<ActiveQrAttempt | null> {
    const raw = await this.redis.get(
      this.activeAttemptKey(workerId, workerTypeId)
    );
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ActiveQrAttempt;
      if (!parsed?.ack?.connection_attempt_id) {
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(this.activeAttemptKey(workerId, workerTypeId));
      return null;
    }
  }

  private async getCachedQrAttemptState(
    workerId: string,
    accountId: string,
    workerTypeId: string,
    workerStatusId?: string,
    runtimeGeneration?: number
  ): Promise<IBaileysConnectionState | null> {
    const raw = await this.redis.get(
      this.qrAttemptCacheKey(workerId, workerTypeId)
    );
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<IBaileysConnectionState>;
      if (parsed.worker_id !== workerId || parsed.account_id !== accountId) {
        return null;
      }

      if (!parsed.worker_type_id || parsed.worker_type_id !== workerTypeId) {
        return null;
      }

      if (!this.hasConnectionCredential(parsed)) {
        return null;
      }

      if (
        runtimeGeneration !== undefined &&
        parsed.runtime_generation === undefined
      ) {
        return null;
      }

      const parsedRuntimeGeneration = optionalRuntimeGeneration(
        parsed.runtime_generation
      );
      if (
        parsedRuntimeGeneration !== undefined &&
        runtimeGeneration !== undefined &&
        parsedRuntimeGeneration !== runtimeGeneration
      ) {
        return null;
      }

      if (this.isCachedQrExpired(parsed)) {
        return null;
      }

      return {
        ...parsed,
        code: this.codeForCachedCredential(parsed),
        status: EBaileysConnectionStatus.connecting,
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId as EWorkerType,
        worker_status_id: workerStatusId as EWorkerStatus | undefined,
        runtime_generation: parsedRuntimeGeneration ?? runtimeGeneration,
        expires_at:
          parsed.expires_at ?? this.qrExpiresAt(parsed.qr_generated_at),
        qr_pending: false,
      } as IBaileysConnectionState;
    } catch {
      return null;
    }
  }

  private isCachedQrExpired(state: Partial<IBaileysConnectionState>): boolean {
    if (state.passkey_public_key || state.passkey_confirmation_code) {
      return false;
    }

    if (!state.qrcode) {
      return true;
    }

    if (!state.qr_generated_at) {
      return true;
    }

    const generatedAtMs = Date.parse(state.qr_generated_at);
    if (!Number.isFinite(generatedAtMs)) {
      return true;
    }

    return Date.now() - generatedAtMs >= this.cachedQrMaxAgeMs;
  }

  private hydrateCachedQrResponse(
    cached: IBaileysConnectionState,
    activeAttempt: ActiveQrAttempt | null
  ): IBaileysConnectionState {
    return {
      ...cached,
      connection_attempt_id:
        cached.connection_attempt_id ??
        activeAttempt?.ack.connection_attempt_id,
      runtime_generation:
        cached.runtime_generation ??
        activeAttempt?.runtime_generation ??
        activeAttempt?.ack.runtime_generation,
      expires_at: cached.expires_at ?? this.qrExpiresAt(cached.qr_generated_at),
      qr_pending: false,
      reason: cached.reason ?? 'cached_qr_available',
    };
  }

  private hasConnectionCredential(
    state: Partial<IBaileysConnectionState>
  ): boolean {
    return Boolean(
      state.qrcode ||
      state.pairing_code ||
      state.passkey_public_key ||
      state.passkey_confirmation_code
    );
  }

  private codeForCachedCredential(
    state: Partial<IBaileysConnectionState>
  ): ECodeMessage {
    if (state.passkey_public_key) {
      return ECodeMessage.awaitingPasskey;
    }
    if (state.passkey_confirmation_code) {
      return ECodeMessage.awaitingPasskeyConfirmation;
    }
    if (state.pairing_code) {
      return ECodeMessage.awaitingPairingCode;
    }
    return ECodeMessage.awaitingReadQrCode;
  }

  private async claimActiveAttempt(
    workerId: string,
    workerTypeId: string,
    attempt: ActiveQrAttempt
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.activeAttemptKey(workerId, workerTypeId),
      JSON.stringify(attempt),
      'EX',
      this.activeAttemptTtlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  private getActiveAttemptAgeMs(attempt: ActiveQrAttempt): number | undefined {
    const queuedAtMs = Date.parse(attempt.queued_at);
    if (!Number.isFinite(queuedAtMs)) {
      return undefined;
    }

    return Math.max(0, Date.now() - queuedAtMs);
  }

  private async clearActiveAttempt(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): Promise<void> {
    const current = await this.getActiveAttempt(workerId, workerTypeId);
    if (current?.ack.connection_attempt_id !== connectionAttemptId) {
      return;
    }
    await this.redis.del(this.activeAttemptKey(workerId, workerTypeId));
  }

  private async publishPendingAck(ack: IBaileysConnectionState): Promise<void> {
    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(ack.account_id),
        ack
      );
    } catch {}
  }

  private async publishCachedQr(state: IBaileysConnectionState): Promise<void> {
    try {
      await this.centrifugoService.publishSub(
        workerCentrifugoQueue(state.account_id),
        state
      );
    } catch {}
  }

  private buildPendingResponse(
    accountId: string,
    workerId: string,
    connectionAttemptId: string,
    workerTypeId: string,
    workerStatusId?: string,
    runtimeGeneration?: number,
    debugTraceId?: string
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId as EWorkerType,
      worker_status_id: workerStatusId as EWorkerStatus | undefined,
      connection_attempt_id: connectionAttemptId,
      qr_pending: true,
      reason: 'queued',
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
    };
  }
}
