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
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import { WorkerService } from '@core/services/worker.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import {
  type PrepareWorkerConnectionPairingActivationResult,
  WorkerRuntimeRepository,
} from '@core/repositories/worker/WorkerRuntime.repository';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';

interface ActiveQrAttempt {
  ack: IBaileysConnectionState;
  authorized_connection_epoch?: string;
  queued_at: string;
  stream_key: string;
  stream_id?: string;
  consumer_group: string;
  source: WorkerConnectionQrCodeQueueSource;
  worker_type_id?: string;
  runtime_generation?: number;
}

interface ReconciledQrRuntime {
  workerStatusId?: string;
  exactDisconnectBarrier: boolean;
}

type PairingActivationProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

interface PairingGrantContext {
  provider: PairingActivationProvider;
  runtime: IWorkerRuntime;
  identity: {
    worker_id: string;
    account_id: string;
    provider: PairingActivationProvider;
    runtime_generation: number;
    container_id: string;
    connection_attempt_id: string;
    authorized_connection_epoch: string;
  };
}

const CLEAR_ACTIVE_ATTEMPT_IF_MATCHES_SCRIPT = `
-- qr_active_attempt_compare_delete_v1
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local decoded_ok, decoded = pcall(cjson.decode, raw)
if not decoded_ok or type(decoded) ~= 'table' or
   type(decoded.ack) ~= 'table' or
   decoded.ack.connection_attempt_id ~= ARGV[1] then
  return 0
end
return redis.call('DEL', KEYS[1])
`;

const STORE_ACTIVE_ATTEMPT_STREAM_ID_IF_MATCHES_SCRIPT = `
-- qr_active_attempt_compare_stream_v1
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local decoded_ok, decoded = pcall(cjson.decode, raw)
if not decoded_ok or type(decoded) ~= 'table' or
   type(decoded.ack) ~= 'table' or
   decoded.ack.connection_attempt_id ~= ARGV[1] then
  return 0
end
decoded.stream_id = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(decoded), 'EX', ARGV[3])
return 1
`;

const STORE_ACTIVE_ATTEMPT_PAIRING_READY_IF_MATCHES_SCRIPT = `
-- qr_active_attempt_compare_pairing_ready_v1
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local decoded_ok, decoded = pcall(cjson.decode, raw)
if not decoded_ok or type(decoded) ~= 'table' or
   type(decoded.ack) ~= 'table' or
   decoded.ack.connection_attempt_id ~= ARGV[1] then
  return 0
end
decoded.ack.event_type = 'status'
decoded.ack.worker_status_id = ARGV[2]
decoded.ack.worker_status_observed_at = ARGV[3]
decoded.ack.disconnected_user = false
redis.call('SET', KEYS[1], cjson.encode(decoded), 'EX', ARGV[4])
return 1
`;

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

function optionalObservedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const normalized = value.trim();
  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

@injectable()
export class WorkerConnectionQrCodeRequesterUseCase {
  private readonly activeAttemptTtlSeconds = Math.max(
    180,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_TTL_SECONDS) || 600
  );
  private readonly activeAttemptDedupeMaxAgeMs = Math.max(
    150_000,
    Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_DEDUPE_MAX_AGE_MS) ||
      180_000
  );
  private readonly activeAttemptSetupMaxAgeMs = Math.min(
    this.activeAttemptDedupeMaxAgeMs,
    Math.max(
      5_000,
      Number(process.env.CONNECTION_QRCODE_ACTIVE_ATTEMPT_SETUP_MAX_AGE_MS) ||
        15_000
    )
  );
  private readonly cachedQrMaxAgeMs = 120_000;
  private readonly supportedWorkerTypes = new Set<string>([
    EWorkerType.baileys,
    EWorkerType.wwebjs,
    EWorkerType.whatsmeow,
  ]);
  private readonly qrRequestableWorkerStatuses = new Set<string>([
    EWorkerStatus.disponible,
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
    EWorkerStatus.connecting,
  ]);
  private readonly qrStatusesThatRequireReusableRuntime = new Set<string>([
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
    EWorkerStatus.connecting,
  ]);
  private readonly qrStatusesThatCanOwnReusableRuntime = new Set<string>([
    EWorkerStatus.disponible,
    EWorkerStatus.offline,
    EWorkerStatus.mismatched,
    EWorkerStatus.error,
    EWorkerStatus.connecting,
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
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService = undefined as never,
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
    debugTraceIdInput?: string,
    setupRetryBudget = 1
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
    const persistedWorkerStatusId = view?.status?.id;
    const serverId = view?.server?.id;
    const runtime = await this.resolveRuntimeSafely(workerId);
    const runtimeGeneration = runtime?.runtime_generation;
    const reconciledRuntime = await this.reconcileDisconnectBarrierBeforeQr({
      accountId,
      workerId,
      workerStatusId: persistedWorkerStatusId,
      runtime,
    });
    const workerStatusId = reconciledRuntime.workerStatusId;

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

    // A delayed modal callback must never turn an already authenticated
    // session back into a pairing attempt. Requesting QR from this point can
    // authorize remove_session=true in the provider and erase the secure
    // import that has just become canonical.
    if (
      view.connection_online_acknowledged === true &&
      isWhatsappConnectionOnline(view.connection_status ?? undefined)
    ) {
      throw new Error(t('worker_qrcode_not_ready'));
    }

    if (workerStatusId === EWorkerStatus.blocked) {
      throw new Error(t('worker_blocked_by_plan'));
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

    if (
      this.qrStatusesThatRequireReusableRuntime.has(workerStatusId) &&
      !this.isReusableRuntime(runtime)
    ) {
      throw new Error(t('worker_qrcode_not_ready'));
    }

    const pairingProvider = this.pairingProviderForWorkerType(workerTypeId);
    const shouldUsePairingGrant = Boolean(
      runtime &&
      pairingProvider &&
      workerStatusId &&
      this.qrStatusesThatCanOwnReusableRuntime.has(workerStatusId) &&
      this.isReusableRuntime(runtime)
    );
    let existing = await this.getActiveAttempt(workerId, workerTypeId);
    if (existing) {
      let invalidReason = await this.getActiveAttemptInvalidReason(
        workerId,
        workerTypeId,
        existing,
        runtimeGeneration
      );
      if (
        !invalidReason &&
        shouldUsePairingGrant &&
        runtime &&
        pairingProvider
      ) {
        const grantInvalidReason = await this.getPairingGrantInvalidReason({
          accountId,
          workerId,
          provider: pairingProvider,
          runtime,
          attempt: existing,
        });
        if (
          grantInvalidReason &&
          !this.isActiveAttemptSetupInProgress(existing)
        ) {
          invalidReason = grantInvalidReason;
        }
      }

      if (invalidReason) {
        await this.clearActiveAttempt(
          workerId,
          workerTypeId,
          existing.ack.connection_attempt_id as string
        );
        if (runtime && pairingProvider) {
          await this.revokePairingGrantForAttempt({
            accountId,
            workerId,
            provider: pairingProvider,
            runtime,
            attempt: existing,
          });
        }
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

    let cachedQr = await this.getAuthorizedCachedQrAttemptState({
      workerId,
      accountId,
      workerTypeId,
      workerStatusId,
      workerStatusObservedAt: view.worker_status_observed_at ?? view.updated_at,
      runtimeGeneration,
      activeAttempt: existing,
      runtime,
      pairingProvider,
      shouldUsePairingGrant,
      source,
    });
    if (workerStatusId === EWorkerStatus.connecting && existing) {
      const response = this.pairingAckFromActiveAttempt(
        existing,
        workerTypeId,
        runtimeGeneration,
        debugTraceId
      );
      await this.publishPendingAck(response);
      return response;
    }
    if (cachedQr && this.hasConnectionCredential(cachedQr)) {
      return this.respondWithCachedQr({
        cachedQr,
        existing,
        debugTraceId,
        workerId,
        accountId,
        workerTypeId,
        runtimeGeneration,
      });
    }

    existing = await this.reconcileProcessedAttemptWithoutCredential({
      existing,
      workerId,
      accountId,
      workerTypeId,
      runtimeGeneration,
      runtime,
      pairingProvider,
      debugTraceId,
    });

    if (existing && !existing.stream_id) {
      existing = await this.waitForActiveAttemptInitialization(
        workerId,
        workerTypeId,
        existing
      );

      cachedQr = await this.getAuthorizedCachedQrAttemptState({
        workerId,
        accountId,
        workerTypeId,
        workerStatusId,
        workerStatusObservedAt:
          view.worker_status_observed_at ?? view.updated_at,
        runtimeGeneration,
        activeAttempt: existing,
        runtime,
        pairingProvider,
        shouldUsePairingGrant,
        source,
      });
      if (cachedQr && this.hasConnectionCredential(cachedQr)) {
        return this.respondWithCachedQr({
          cachedQr,
          existing,
          debugTraceId,
          workerId,
          accountId,
          workerTypeId,
          runtimeGeneration,
        });
      }

      if (existing && !existing.stream_id) {
        const staleAttempt = existing;
        const cleared = await this.clearActiveAttempt(
          workerId,
          workerTypeId,
          staleAttempt.ack.connection_attempt_id as string
        );
        if (cleared && runtime && pairingProvider) {
          await this.revokePairingGrantForAttempt({
            accountId,
            workerId,
            provider: pairingProvider,
            runtime,
            attempt: staleAttempt,
          });
        }
        existing = null;
      }

      if (!existing) {
        if (setupRetryBudget > 0) {
          return this.executeWithLifecycle(
            t,
            accountId,
            workerId,
            source,
            debugTraceId,
            setupRetryBudget - 1
          );
        }
        throw new Error(t('worker_qrcode_not_ready'));
      }
    }

    if (existing) {
      const existingConnectionAttemptId = existing.ack.connection_attempt_id;
      if (!existingConnectionAttemptId) {
        await this.redis.del(this.activeAttemptKey(workerId, workerTypeId));
      } else {
        const response = this.pendingAckFromActiveAttempt(
          existing,
          workerTypeId,
          workerStatusId,
          runtimeGeneration,
          debugTraceId,
          view.worker_status_observed_at ?? view.updated_at
        );

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
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + this.activeAttemptDedupeMaxAgeMs
    ).toISOString();
    const authorizedConnectionEpoch = shouldUsePairingGrant
      ? uuidv7()
      : undefined;
    const grantContext: PairingGrantContext | null =
      shouldUsePairingGrant &&
      runtime &&
      pairingProvider &&
      authorizedConnectionEpoch
        ? {
            provider: pairingProvider,
            runtime,
            identity: {
              worker_id: workerId,
              account_id: accountId,
              provider: pairingProvider,
              runtime_generation: runtime.runtime_generation,
              container_id: runtime.container_id as string,
              connection_attempt_id: connectionAttemptId,
              authorized_connection_epoch: authorizedConnectionEpoch,
            },
          }
        : null;
    if (!grantContext && reconciledRuntime.exactDisconnectBarrier) {
      // Never release an exact disconnect barrier without a durable,
      // attempt-bound grant. A delayed provider recovery could otherwise
      // become authoritative again after the session was removed.
      throw new Error(t('worker_qrcode_not_ready'));
    }
    const streamKey = this.redisQueueService.streamKey(workerId, workerTypeId);
    const consumerGroup = this.redisQueueService.consumerGroup(
      workerId,
      workerTypeId
    );
    const ack = this.buildPendingResponse(
      accountId,
      workerId,
      connectionAttemptId,
      authorizedConnectionEpoch,
      workerTypeId,
      workerStatusId,
      runtimeGeneration,
      debugTraceId
    );

    const activeAttempt: ActiveQrAttempt = {
      ack,
      authorized_connection_epoch: authorizedConnectionEpoch,
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
      const current = await this.waitForActiveAttemptInitialization(
        workerId,
        workerTypeId,
        await this.getActiveAttempt(workerId, workerTypeId)
      );
      if (current?.stream_id) {
        return this.pendingAckFromActiveAttempt(
          current,
          workerTypeId,
          workerStatusId,
          runtimeGeneration,
          debugTraceId,
          view.worker_status_observed_at ?? view.updated_at
        );
      }

      if (current?.ack.connection_attempt_id) {
        const cleared = await this.clearActiveAttempt(
          workerId,
          workerTypeId,
          current.ack.connection_attempt_id
        );
        if (cleared && runtime && pairingProvider) {
          await this.revokePairingGrantForAttempt({
            accountId,
            workerId,
            provider: pairingProvider,
            runtime,
            attempt: current,
          });
        }
      }

      if (setupRetryBudget > 0) {
        return this.executeWithLifecycle(
          t,
          accountId,
          workerId,
          source,
          debugTraceId,
          setupRetryBudget - 1
        );
      }

      throw new Error(t('worker_qrcode_not_ready'));
    }

    let pairingGrantPrepared = false;
    if (grantContext) {
      try {
        const prepared = await this.preparePairingActivationGrant({
          context: grantContext,
          workerStatusId,
          serverId,
          workerTypeId,
          expiresAt,
        });
        pairingGrantPrepared = await this.acceptPairingGrantPreparation({
          prepared,
          ack,
          debugTraceId,
          workerId,
          accountId,
          workerTypeId,
          runtimeGeneration,
          connectionAttemptId,
        });
      } catch (error) {
        await this.clearActiveAttempt(
          workerId,
          workerTypeId,
          connectionAttemptId
        );
        throw error;
      }
      if (!pairingGrantPrepared) {
        await this.clearActiveAttempt(
          workerId,
          workerTypeId,
          connectionAttemptId
        );
        throw new Error(t('worker_qrcode_not_ready'));
      }
    }

    const payload: IWorkerConnectionQrCodeQueueMessage = {
      request_id: uuidv7(),
      connection_attempt_id: connectionAttemptId,
      authorized_connection_epoch: authorizedConnectionEpoch,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
      source,
      requested_at: requestedAt.toISOString(),
      expires_at: expiresAt,
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
      const streamStored = await this.storeActiveAttemptStreamId(
        workerId,
        workerTypeId,
        connectionAttemptId,
        streamId
      );
      if (!streamStored) {
        throw new Error(t('worker_qrcode_not_ready'));
      }
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
      if (pairingGrantPrepared && grantContext) {
        await this.workerRuntimeRepository.revokeWorkerConnectionPairingActivation(
          grantContext.identity
        );
      }
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

  private async verifyReusableRuntimeContainerForPairing(input: {
    workerId: string;
    accountId: string;
    serverId: string;
    workerTypeId: string;
    workerStatusId?: string;
    runtime: IWorkerRuntime;
  }): Promise<string | undefined> {
    if (
      !input.workerStatusId ||
      !this.qrStatusesThatCanOwnReusableRuntime.has(input.workerStatusId)
    ) {
      return undefined;
    }

    const expectedContainerId = input.runtime.container_id?.trim();
    if (!expectedContainerId) {
      return undefined;
    }

    const health = await this.workerGrpcClientService
      .runtimeHealth(input.serverId, { worker_id: input.workerId }, 5_000)
      .catch(() => null);
    if (
      !health ||
      health.worker_id !== input.workerId ||
      health.account_id !== input.accountId ||
      health.worker_type_id !== input.workerTypeId ||
      optionalRuntimeGeneration(health.runtime_generation) !==
        input.runtime.runtime_generation ||
      health.activated !== true ||
      health.standby === true ||
      Boolean(health.error)
    ) {
      return undefined;
    }

    return expectedContainerId;
  }

  private async preparePairingActivationGrant(input: {
    context: PairingGrantContext;
    workerStatusId?: string;
    serverId: string;
    workerTypeId: string;
    expiresAt: string;
  }): Promise<PrepareWorkerConnectionPairingActivationResult> {
    const verifiedRunningContainerId =
      await this.verifyReusableRuntimeContainerForPairing({
        workerId: input.context.identity.worker_id,
        accountId: input.context.identity.account_id,
        serverId: input.serverId,
        workerTypeId: input.workerTypeId,
        workerStatusId: input.workerStatusId,
        runtime: input.context.runtime,
      });

    return this.workerRuntimeRepository.prepareWorkerConnectionPairingActivation(
      {
        ...input.context.identity,
        expected_runtime_generation: input.context.runtime.runtime_generation,
        expected_container_id: input.context.identity.container_id,
        expected_connection_epoch:
          input.context.runtime.connection_epoch ?? null,
        verified_running_container_id: verifiedRunningContainerId,
        expires_at: input.expiresAt,
      }
    );
  }

  private async acceptPairingGrantPreparation(input: {
    prepared: PrepareWorkerConnectionPairingActivationResult;
    ack: IBaileysConnectionState;
    debugTraceId?: string;
    workerId: string;
    accountId: string;
    workerTypeId: string;
    runtimeGeneration?: number;
    connectionAttemptId: string;
  }): Promise<boolean> {
    if (input.prepared.status !== 'granted') {
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.pairing_grant_rejected',
        {
          trace_id: input.debugTraceId,
          layer: 'manager',
          worker_id: input.workerId,
          account_id: input.accountId,
          worker_type_id: input.workerTypeId,
          runtime_generation: input.runtimeGeneration,
          connection_attempt_id: input.connectionAttemptId,
          reason: input.prepared.status,
        }
      );
      return false;
    }

    input.ack.event_type = 'status';
    input.ack.worker_status_id = input.prepared.worker_status_id;
    input.ack.worker_status_observed_at =
      input.prepared.worker_status_observed_at;
    input.ack.disconnected_user = false;
    const stored = await this.redis.eval(
      STORE_ACTIVE_ATTEMPT_PAIRING_READY_IF_MATCHES_SCRIPT,
      1,
      this.activeAttemptKey(input.workerId, input.workerTypeId),
      input.connectionAttemptId,
      input.prepared.worker_status_id,
      input.prepared.worker_status_observed_at,
      String(this.activeAttemptTtlSeconds)
    );
    if (Number(stored) !== 1) {
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.pairing_grant_rejected',
        {
          trace_id: input.debugTraceId,
          layer: 'manager',
          worker_id: input.workerId,
          account_id: input.accountId,
          worker_type_id: input.workerTypeId,
          runtime_generation: input.runtimeGeneration,
          connection_attempt_id: input.connectionAttemptId,
          reason: 'active_attempt_ownership_lost_after_grant',
        }
      );
      return false;
    }
    return true;
  }

  private activeAttemptKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`;
  }

  private async resolveRuntimeSafely(
    workerId: string
  ): Promise<IWorkerRuntime | null> {
    if (!this.workerRuntimeRepository) {
      return null;
    }

    return this.workerRuntimeRepository.viewByWorkerIdConsistent(workerId);
  }

  private async reconcileDisconnectBarrierBeforeQr(input: {
    accountId: string;
    workerId: string;
    workerStatusId?: string;
    runtime: IWorkerRuntime | null;
  }): Promise<ReconciledQrRuntime> {
    const { runtime } = input;
    const connectionEpoch = runtime?.connection_epoch ?? null;
    const exactDisconnectBarrier =
      Boolean(runtime?.connection_disconnected_at) &&
      (runtime?.disconnected_connection_epoch ?? null) === connectionEpoch;
    if (!exactDisconnectBarrier) {
      return {
        workerStatusId: input.workerStatusId,
        exactDisconnectBarrier: false,
      };
    }

    if (
      !runtime ||
      !Number.isSafeInteger(runtime.runtime_generation) ||
      runtime.runtime_generation <= 0
    ) {
      return { workerStatusId: undefined, exactDisconnectBarrier: true };
    }

    const finalized =
      await this.workerRuntimeRepository.finalizeWorkerConnectionDisconnect({
        worker_id: input.workerId,
        account_id: input.accountId,
        expected_runtime_generation: runtime.runtime_generation,
        expected_container_id: runtime.container_id ?? null,
        expected_connection_epoch: connectionEpoch,
      });

    return {
      workerStatusId:
        finalized.status === 'completed' ? EWorkerStatus.disponible : undefined,
      exactDisconnectBarrier: true,
    };
  }

  private pairingProviderForWorkerType(
    workerTypeId?: string
  ): PairingActivationProvider | undefined {
    switch (workerTypeId) {
      case EWorkerType.baileys:
        return 'baileys';
      case EWorkerType.wwebjs:
        return 'wwebjs';
      case EWorkerType.whatsmeow:
        return 'whatsmeow';
      default:
        return undefined;
    }
  }

  private async getPairingGrantInvalidReason(input: {
    accountId: string;
    workerId: string;
    provider: PairingActivationProvider;
    runtime: IWorkerRuntime;
    attempt: ActiveQrAttempt;
  }): Promise<string | undefined> {
    const connectionAttemptId = input.attempt.ack.connection_attempt_id;
    const authorizedConnectionEpoch =
      input.attempt.authorized_connection_epoch ??
      input.attempt.ack.authorized_connection_epoch;
    const containerId = input.runtime.container_id?.trim();
    if (!connectionAttemptId || !authorizedConnectionEpoch || !containerId) {
      return 'active_attempt_missing_pairing_authorization';
    }

    const active =
      await this.workerRuntimeRepository.hasCurrentWorkerConnectionPairingAuthorization(
        {
          worker_id: input.workerId,
          account_id: input.accountId,
          provider: input.provider,
          runtime_generation: input.runtime.runtime_generation,
          container_id: containerId,
          connection_attempt_id: connectionAttemptId,
          authorized_connection_epoch: authorizedConnectionEpoch,
        }
      );
    return active ? undefined : 'active_attempt_pairing_authorization_stale';
  }

  private async getAuthorizedCachedQrAttemptState(input: {
    workerId: string;
    accountId: string;
    workerTypeId: string;
    workerStatusId?: string;
    workerStatusObservedAt?: unknown;
    runtimeGeneration?: number;
    activeAttempt: ActiveQrAttempt | null;
    runtime: IWorkerRuntime | null;
    pairingProvider?: PairingActivationProvider;
    shouldUsePairingGrant: boolean;
    source: WorkerConnectionQrCodeQueueSource;
  }): Promise<IBaileysConnectionState | null> {
    const cachedQr = await this.getCachedQrAttemptState(
      input.workerId,
      input.accountId,
      input.workerTypeId,
      input.workerStatusId,
      input.runtimeGeneration
    );
    if (!cachedQr) {
      return null;
    }

    if (
      !this.isCachedCredentialForActiveAttempt(cachedQr, input.activeAttempt)
    ) {
      await this.redis.del(
        this.qrAttemptCacheKey(input.workerId, input.workerTypeId)
      );
      return null;
    }

    if (
      !input.shouldUsePairingGrant ||
      !input.runtime ||
      !input.pairingProvider
    ) {
      return this.withPairingReadyWorkerStatus(
        cachedQr,
        input.activeAttempt,
        input.workerStatusId,
        input.workerStatusObservedAt
      );
    }

    const cachedAttempt: ActiveQrAttempt = {
      ack: cachedQr,
      authorized_connection_epoch: cachedQr.authorized_connection_epoch,
      queued_at: cachedQr.qr_generated_at ?? '',
      stream_key: '',
      consumer_group: '',
      source: input.source,
      worker_type_id: input.workerTypeId,
      runtime_generation: cachedQr.runtime_generation,
    };
    const invalidReason = await this.getPairingGrantInvalidReason({
      accountId: input.accountId,
      workerId: input.workerId,
      provider: input.pairingProvider,
      runtime: input.runtime,
      attempt: cachedAttempt,
    });
    if (!invalidReason) {
      return this.withPairingReadyWorkerStatus(
        cachedQr,
        input.activeAttempt,
        input.workerStatusId,
        input.workerStatusObservedAt
      );
    }

    await this.redis.del(
      this.qrAttemptCacheKey(input.workerId, input.workerTypeId)
    );
    return null;
  }

  private isCachedCredentialForActiveAttempt(
    cached: IBaileysConnectionState,
    activeAttempt: ActiveQrAttempt | null
  ): boolean {
    if (!activeAttempt) {
      return false;
    }

    const cachedAttemptId = cached.connection_attempt_id?.trim();
    const activeAttemptId = activeAttempt.ack.connection_attempt_id?.trim();
    if (
      !cachedAttemptId ||
      !activeAttemptId ||
      cachedAttemptId !== activeAttemptId
    ) {
      return false;
    }

    const cachedRuntimeGeneration = optionalRuntimeGeneration(
      cached.runtime_generation
    );
    const activeRuntimeGeneration = optionalRuntimeGeneration(
      activeAttempt.runtime_generation ?? activeAttempt.ack.runtime_generation
    );
    if (
      cachedRuntimeGeneration !== activeRuntimeGeneration &&
      (cachedRuntimeGeneration !== undefined ||
        activeRuntimeGeneration !== undefined)
    ) {
      return false;
    }

    const cachedConnectionEpoch = cached.authorized_connection_epoch?.trim();
    const activeConnectionEpoch = (
      activeAttempt.authorized_connection_epoch ??
      activeAttempt.ack.authorized_connection_epoch
    )?.trim();
    return (
      cachedConnectionEpoch === activeConnectionEpoch ||
      (!cachedConnectionEpoch && !activeConnectionEpoch)
    );
  }

  private async respondWithCachedQr(input: {
    cachedQr: IBaileysConnectionState;
    existing: ActiveQrAttempt | null;
    debugTraceId?: string;
    workerId: string;
    accountId: string;
    workerTypeId: string;
    runtimeGeneration?: number;
  }): Promise<IBaileysConnectionState> {
    const response = {
      ...this.hydrateCachedQrResponse(input.cachedQr, input.existing),
      debug_trace_id: input.debugTraceId,
    };

    await this.publishCachedQr(response);
    void this.connectionLifecycleDebugService.log(
      'manager.qr_request.cached_qr_returned',
      {
        trace_id: input.debugTraceId,
        layer: 'manager',
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: input.workerTypeId,
        runtime_generation: input.runtimeGeneration,
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

  private async revokePairingGrantForAttempt(input: {
    accountId: string;
    workerId: string;
    provider: PairingActivationProvider;
    runtime: IWorkerRuntime;
    attempt: ActiveQrAttempt;
  }): Promise<void> {
    const connectionAttemptId = input.attempt.ack.connection_attempt_id;
    const authorizedConnectionEpoch =
      input.attempt.authorized_connection_epoch ??
      input.attempt.ack.authorized_connection_epoch;
    const containerId = input.runtime.container_id?.trim();
    if (!connectionAttemptId || !authorizedConnectionEpoch || !containerId) {
      return;
    }
    await this.workerRuntimeRepository.revokeWorkerConnectionPairingActivation({
      worker_id: input.workerId,
      account_id: input.accountId,
      provider: input.provider,
      runtime_generation: input.runtime.runtime_generation,
      container_id: containerId,
      connection_attempt_id: connectionAttemptId,
      authorized_connection_epoch: authorizedConnectionEpoch,
    });
  }

  private isReusableRuntime(runtime: IWorkerRuntime | null): boolean {
    return Boolean(
      runtime &&
      Number.isSafeInteger(runtime.runtime_generation) &&
      runtime.runtime_generation > 0 &&
      typeof runtime.container_id === 'string' &&
      runtime.container_id.trim()
    );
  }

  private processedAttemptKey(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:processed:${connectionAttemptId}`;
  }

  private async isAttemptProcessed(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): Promise<boolean> {
    return Boolean(
      await this.redis.get(
        this.processedAttemptKey(workerId, workerTypeId, connectionAttemptId)
      )
    );
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

  private qrAttemptCacheKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:attempt`;
  }

  private async getActiveAttemptInvalidReason(
    workerId: string,
    workerTypeId: string,
    attempt: ActiveQrAttempt,
    runtimeGeneration?: number
  ): Promise<string | undefined> {
    // The processed marker belongs to Redis Stream delivery deduplication.
    // It must not terminate this provider-lifecycle identity: the same
    // attempt may emit renewed QR/status events until online, terminal state
    // or the bounded active-attempt age below.
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
  ): Promise<boolean> {
    const stored = await this.redis.eval(
      STORE_ACTIVE_ATTEMPT_STREAM_ID_IF_MATCHES_SCRIPT,
      1,
      this.activeAttemptKey(workerId, workerTypeId),
      connectionAttemptId,
      streamId,
      String(this.activeAttemptTtlSeconds)
    );
    return Number(stored) === 1;
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
      await this.clearCorruptActiveAttemptIfUnchanged(
        this.activeAttemptKey(workerId, workerTypeId),
        raw
      );
      return null;
    }
  }

  private async waitForActiveAttemptInitialization(
    workerId: string,
    workerTypeId: string,
    initial: ActiveQrAttempt | null
  ): Promise<ActiveQrAttempt | null> {
    let current = initial;
    while (current && !current.stream_id) {
      const ageMs = this.getActiveAttemptAgeMs(current);
      if (ageMs === undefined || ageMs >= this.activeAttemptSetupMaxAgeMs) {
        break;
      }
      const remainingMs = this.activeAttemptSetupMaxAgeMs - ageMs;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(1, remainingMs)))
      );
      current = await this.getActiveAttempt(workerId, workerTypeId);
    }
    return current;
  }

  private async clearCorruptActiveAttemptIfUnchanged(
    key: string,
    expectedRaw: string
  ): Promise<void> {
    await this.redis.eval(
      `
-- qr_active_attempt_compare_raw_delete_v1
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`,
      1,
      key,
      expectedRaw
    );
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
      connection_attempt_id: cached.connection_attempt_id,
      authorized_connection_epoch:
        cached.authorized_connection_epoch ??
        activeAttempt?.authorized_connection_epoch ??
        activeAttempt?.ack.authorized_connection_epoch,
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

  private isActiveAttemptSetupInProgress(attempt: ActiveQrAttempt): boolean {
    const ageMs = this.getActiveAttemptAgeMs(attempt);
    return (
      !attempt.stream_id &&
      ageMs !== undefined &&
      ageMs < this.activeAttemptSetupMaxAgeMs
    );
  }

  private isProcessedAttemptPublicationInFlight(
    attempt: ActiveQrAttempt
  ): boolean {
    const ageMs = this.getActiveAttemptAgeMs(attempt);
    return ageMs !== undefined && ageMs < this.activeAttemptSetupMaxAgeMs;
  }

  private async reconcileProcessedAttemptWithoutCredential(input: {
    existing: ActiveQrAttempt | null;
    workerId: string;
    accountId: string;
    workerTypeId: string;
    runtimeGeneration?: number;
    runtime: IWorkerRuntime | null;
    pairingProvider?: PairingActivationProvider;
    debugTraceId?: string;
  }): Promise<ActiveQrAttempt | null> {
    const { existing } = input;
    const connectionAttemptId = existing?.ack.connection_attempt_id;
    if (
      !existing ||
      !connectionAttemptId ||
      !(await this.isAttemptProcessed(
        input.workerId,
        input.workerTypeId,
        connectionAttemptId
      ))
    ) {
      return existing;
    }

    if (this.isProcessedAttemptPublicationInFlight(existing)) {
      // A Redis Stream consumer marks delivery as processed before the
      // provider's QR/status callback is necessarily visible in the manager
      // cache. Keep the same lifecycle identity through that publication
      // window; replacing it here races the first QR and resets the provider
      // socket a few milliseconds after successful generation.
      void this.connectionLifecycleDebugService.log(
        'manager.qr_request.processed_attempt_publication_pending',
        {
          trace_id: input.debugTraceId,
          layer: 'manager',
          worker_id: input.workerId,
          account_id: input.accountId,
          worker_type_id: input.workerTypeId,
          runtime_generation: input.runtimeGeneration,
          connection_attempt_id: connectionAttemptId,
          reason: 'processed_attempt_cache_visibility_grace',
        }
      );
      return existing;
    }

    // Past the publication grace there is no retrievable credential and no
    // consumer work left. Requeue with a new fenced attempt instead of
    // returning "queued" indefinitely.
    const cleared = await this.clearActiveAttempt(
      input.workerId,
      input.workerTypeId,
      connectionAttemptId
    );
    if (cleared && input.runtime && input.pairingProvider) {
      await this.revokePairingGrantForAttempt({
        accountId: input.accountId,
        workerId: input.workerId,
        provider: input.pairingProvider,
        runtime: input.runtime,
        attempt: existing,
      });
    }
    void this.connectionLifecycleDebugService.log(
      'manager.qr_request.completed_attempt_without_cache_invalidated',
      {
        trace_id: input.debugTraceId,
        layer: 'manager',
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: input.workerTypeId,
        runtime_generation: input.runtimeGeneration,
        connection_attempt_id: connectionAttemptId,
        reason: 'processed_attempt_without_cached_credential',
      }
    );
    return null;
  }

  private async clearActiveAttempt(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): Promise<boolean> {
    const cleared = await this.redis.eval(
      CLEAR_ACTIVE_ATTEMPT_IF_MATCHES_SCRIPT,
      1,
      this.activeAttemptKey(workerId, workerTypeId),
      connectionAttemptId
    );
    return Number(cleared) === 1;
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

  private pendingAckFromActiveAttempt(
    attempt: ActiveQrAttempt,
    workerTypeId: string,
    workerStatusId?: string,
    runtimeGeneration?: number,
    debugTraceId?: string,
    workerStatusObservedAt?: unknown
  ): IBaileysConnectionState {
    return this.withPairingReadyWorkerStatus(
      {
        ...attempt.ack,
        authorized_connection_epoch:
          attempt.ack.authorized_connection_epoch ??
          attempt.authorized_connection_epoch,
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
        runtime_generation: attempt.ack.runtime_generation ?? runtimeGeneration,
      },
      attempt,
      workerStatusId,
      workerStatusObservedAt
    );
  }

  private pairingAckFromActiveAttempt(
    attempt: ActiveQrAttempt,
    workerTypeId: string,
    runtimeGeneration?: number,
    debugTraceId?: string
  ): IBaileysConnectionState {
    return {
      ...attempt.ack,
      status: EBaileysConnectionStatus.connecting,
      code: ECodeMessage.pairingInProgress,
      worker_type_id: workerTypeId as EWorkerType,
      worker_status_id: EWorkerStatus.connecting,
      connection_attempt_id: attempt.ack.connection_attempt_id,
      authorized_connection_epoch:
        attempt.ack.authorized_connection_epoch ??
        attempt.authorized_connection_epoch,
      runtime_generation:
        attempt.ack.runtime_generation ??
        attempt.runtime_generation ??
        runtimeGeneration,
      debug_trace_id: debugTraceId,
      reason: 'pairing_in_progress',
      qr_pending: false,
      qrcode: undefined,
      pairing_code: undefined,
      passkey_public_key: undefined,
      passkey_confirmation_code: undefined,
      passkey_pending: undefined,
    };
  }

  private withPairingReadyWorkerStatus(
    state: IBaileysConnectionState,
    activeAttempt: ActiveQrAttempt | null,
    workerStatusId?: string,
    workerStatusObservedAt?: unknown
  ): IBaileysConnectionState {
    const attemptPairingReady =
      activeAttempt?.ack.event_type === 'status' &&
      activeAttempt.ack.worker_status_id === EWorkerStatus.disponible;
    const pairingReadyObservedAt = optionalObservedAt(
      attemptPairingReady
        ? activeAttempt.ack.worker_status_observed_at
        : workerStatusId === EWorkerStatus.disponible
          ? workerStatusObservedAt
          : undefined
    );
    if (!pairingReadyObservedAt) {
      return state;
    }

    return {
      ...state,
      event_type: 'status',
      worker_status_id: EWorkerStatus.disponible,
      worker_status_observed_at: pairingReadyObservedAt,
      disconnected_user: false,
    };
  }

  private buildPendingResponse(
    accountId: string,
    workerId: string,
    connectionAttemptId: string,
    authorizedConnectionEpoch: string | undefined,
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
      authorized_connection_epoch: authorizedConnectionEpoch,
      qr_pending: true,
      reason: 'queued',
      runtime_generation: runtimeGeneration,
      debug_trace_id: debugTraceId,
    };
  }
}
