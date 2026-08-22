import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { v7 as uuidv7 } from 'uuid';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { currentTime } from '@core/common/functions/currentTime';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { WorkerWarmPoolQueueService } from '@core/services/workerWarmPoolQueue.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';
import {
  publishPreparedWorkerLifecycle,
  retryWorkerLifecycleBoundary,
} from '@core/common/functions/workerLifecycleBoundary';
import { canActivateWorkerWarmRuntime } from '@core/common/functions/workerWarmActivationPolicy';
import { getWorkerWarmHealthFreshAfter } from '@core/common/functions/workerWarmHealthLease';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  buildManagerWorkerRecreatingStatusEvent,
  normalizeWorkerLifecycleRuntimeGeneration,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';

type WorkerUpdateResult = boolean | IWorkerLifecycleAck;
type WhatsappSessionProvider = 'baileys' | 'wwebjs' | 'whatsmeow';

@injectable()
export class WorkerUpdaterUseCase {
  private readonly recreatableWorkerTypes = new Set<EWorkerType>([
    EWorkerType.baileys,
    EWorkerType.wwebjs,
    EWorkerType.whatsmeow,
  ]);

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(WorkerWarmPoolQueueService)
    private readonly workerWarmPoolQueueService: WorkerWarmPoolQueueService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }
  }

  private shouldRecreateWorkerOnTypeChange(
    currentType?: EWorkerType,
    nextType?: EWorkerType
  ): boolean {
    if (!currentType || !nextType || currentType === nextType) {
      return false;
    }

    return (
      this.recreatableWorkerTypes.has(currentType) &&
      this.recreatableWorkerTypes.has(nextType)
    );
  }

  private whatsappProviderForWorkerType(
    workerType: EWorkerType
  ): WhatsappSessionProvider | undefined {
    if (workerType === EWorkerType.baileys) return 'baileys';
    if (workerType === EWorkerType.wwebjs) return 'wwebjs';
    if (workerType === EWorkerType.whatsmeow) return 'whatsmeow';
    return undefined;
  }

  private validateRequestedWorkerType(
    t: TFunction<'translation', undefined>,
    currentType: EWorkerType,
    nextType: EWorkerType | undefined
  ): void {
    if (nextType && !Object.values(EWorkerType).includes(nextType)) {
      throw new Error(t('worker_type_invalid'));
    }
    if (
      currentType === EWorkerType.whatsapp &&
      nextType &&
      nextType !== EWorkerType.whatsapp
    ) {
      throw new Error(t('whatsapp_official_type_change_not_allowed'));
    }
    if (
      currentType !== EWorkerType.whatsapp &&
      nextType === EWorkerType.whatsapp
    ) {
      throw new Error(t('whatsapp_official_connect_required'));
    }
    if (!nextType || currentType === nextType) return;
    if (
      !this.recreatableWorkerTypes.has(currentType) ||
      !this.recreatableWorkerTypes.has(nextType)
    ) {
      throw new Error(t('worker_type_change_unofficial_only'));
    }
  }

  private buildWhatsappProviderHandoffGuard(
    currentType: EWorkerType,
    targetType: EWorkerType,
    lifecycleOperationId: string | undefined
  ): {
    source_provider: WhatsappSessionProvider;
    target_provider: WhatsappSessionProvider;
    lifecycle_operation_id: string;
  } {
    const sourceProvider = this.whatsappProviderForWorkerType(currentType);
    const targetProvider = this.whatsappProviderForWorkerType(targetType);
    if (!sourceProvider || !targetProvider || !lifecycleOperationId) {
      throw new Error('whatsapp_provider_handoff_identity_missing');
    }
    return {
      source_provider: sourceProvider,
      target_provider: targetProvider,
      lifecycle_operation_id: lifecycleOperationId,
    };
  }

  private resolveRecreateSessionStorageTransition(
    sessionStorage: EWorkerSessionStorage,
    shouldRecreateWorker: boolean,
    currentType: EWorkerType,
    targetWorkerType: EWorkerType
  ): {
    resetsLegacySession: boolean;
    convertsLegacyWhatsappSession: boolean;
    targetSessionStorage: EWorkerSessionStorage;
  } {
    const resetsLegacySession =
      sessionStorage === EWorkerSessionStorage.legacy_volume &&
      shouldRecreateWorker;
    /*
     * PostgreSQL session storage is only supported by the three managed
     * WhatsApp providers. Keep existing non-WhatsApp legacy behavior intact
     * instead of accidentally changing their storage backend on a server
     * move.
     */
    const convertsLegacyWhatsappSession =
      resetsLegacySession &&
      this.recreatableWorkerTypes.has(currentType) &&
      this.recreatableWorkerTypes.has(targetWorkerType);

    return {
      resetsLegacySession,
      convertsLegacyWhatsappSession,
      targetSessionStorage: convertsLegacyWhatsappSession
        ? EWorkerSessionStorage.postgres
        : sessionStorage,
    };
  }

  private async validateServerEligibility(
    t: TFunction<'translation', undefined>,
    nextServerId: string,
    currentServerId?: string
  ): Promise<boolean> {
    if (currentServerId && nextServerId === currentServerId) {
      return false;
    }

    const eligibleServers = await this.workerService.listWorkerServers();
    const serverEligible = eligibleServers.some(
      (server) => server.server_id === nextServerId
    );

    if (!serverEligible) {
      throw new Error(t('worker_server_not_disponible'));
    }

    return true;
  }

  private async publishWarmReplenish(
    serverId: string,
    workerType: EWorkerType,
    reason: 'claim_replenish' | 'pool_miss'
  ): Promise<void> {
    try {
      await this.workerWarmPoolQueueService.publishReplenish({
        request_id: uuidv7(),
        server_id: serverId,
        worker_type_id: workerType,
        reason,
        requested_at: currentTime(),
      });
    } catch (error) {
      console.error('Failed to publish warm replenish message', {
        serverId,
        workerType,
        reason,
        error,
      });
    }
  }

  private async tryReserveWarmRuntimeForRecreate(input: {
    accountId: string;
    workerId: string;
    serverId: string;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    removeSession?: boolean;
    removeVolume?: boolean;
    forceCold?: boolean;
  }): Promise<IWorkerWarmPool | null> {
    if (
      input.forceCold === true ||
      input.sessionStorage !== EWorkerSessionStorage.postgres ||
      !canActivateWorkerWarmRuntime({
        source: 'worker_update',
        session_storage: input.sessionStorage,
        remove_session: input.removeSession,
        remove_volume: input.removeVolume,
      })
    ) {
      return null;
    }

    if (!this.workerWarmPoolRepository) {
      return null;
    }

    const settings = await this.workerWarmPoolSettingsService.view();
    await this.workerWarmPoolRepository.releaseExpiredReservations();
    const reservationExpiresAt = new Date(
      Date.now() + settings.reservation_ttl_seconds * 1000
    ).toISOString();
    const warm = await this.workerWarmPoolRepository.reserveReady(
      input.serverId,
      input.workerType,
      input.workerId,
      reservationExpiresAt,
      getWorkerWarmHealthFreshAfter(settings)
    );

    if (!warm) {
      if (settings.warmup_enabled) {
        await this.publishWarmReplenish(
          input.serverId,
          input.workerType,
          'pool_miss'
        );
      }
      return null;
    }

    if (settings.warmup_enabled) {
      await this.publishWarmReplenish(
        input.serverId,
        input.workerType,
        'claim_replenish'
      );
    }

    return warm;
  }

  private async reserveWarmRuntimeForWorkerUpdate(input: {
    accountId: string;
    workerId: string;
    serverId: string;
    workerType: EWorkerType;
    sessionStorage: EWorkerSessionStorage;
    removeSession?: boolean;
    removeVolume?: boolean;
    forceCold: boolean;
    lifecycleOperationId: string;
    debugTraceId?: string;
  }): Promise<IWorkerWarmPool | null> {
    try {
      return await this.tryReserveWarmRuntimeForRecreate(input);
    } catch (error) {
      void this.connectionLifecycleDebugService.log(
        'manager.worker_update.warm_reservation_failed',
        {
          trace_id: input.debugTraceId,
          layer: 'manager',
          worker_id: input.workerId,
          account_id: input.accountId,
          worker_type_id: input.workerType,
          lifecycle_operation_id: input.lifecycleOperationId,
          reason: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private buildLifecycleMessage(input: {
    action: IWorkerLifecycleQueueMessage['action'];
    payload: IWorkerPayload;
    operationId: string;
    source?: IWorkerLifecycleQueueMessage['source'];
    warmPoolId?: string;
    previousServerId?: string;
    previousWorkerTypeId?: EWorkerType;
    cleanupPreviousRuntimeRequired?: boolean;
    debugTraceId?: string;
  }): IWorkerLifecycleQueueMessage {
    const message: IWorkerLifecycleQueueMessage = {
      request_id: uuidv7(),
      operation_id: input.operationId,
      action: input.action,
      worker_id: input.payload.worker_id,
      account_id: input.payload.account_id,
      server_id: input.payload.server_id,
      worker_type_id: input.payload.worker_type_id,
      session_storage: input.payload.session_storage,
      previous_session_storage: input.payload.previous_session_storage,
      worker_status_id: input.payload.worker_status_id,
      source: input.source ?? 'worker_update',
      remove_session: input.payload.remove_session,
      remove_volume: input.payload.remove_volume,
      warm_pool_id: input.warmPoolId,
      previous_server_id: input.previousServerId,
      previous_worker_type_id: input.previousWorkerTypeId,
      previous_worker_status_id: input.payload.previous_worker_status_id,
      cleanup_previous_runtime_required: input.cleanupPreviousRuntimeRequired,
      requested_at: currentTime(),
    };

    const debugTraceId = input.debugTraceId ?? input.payload.debug_trace_id;
    if (debugTraceId) {
      message.debug_trace_id = debugTraceId;
    }

    return message;
  }

  private async enqueuePreparedLifecycle(
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    await retryWorkerLifecycleBoundary(() =>
      this.workerLifecycleQueueService.prepare(message)
    );
    await publishPreparedWorkerLifecycle({
      publish: () => this.workerLifecycleQueueService.publish(message),
    });
  }

  private async publishRecreatingState(
    payload: IWorkerPayload,
    runtimeGeneration?: number | null
  ): Promise<void> {
    const recreatingStatus = buildManagerWorkerRecreatingStatusEvent(
      payload,
      runtimeGeneration
    );
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(payload.account_id),
        recreatingStatus
      ),
      this.centrifugoService.publish(
        channelsConfigCentrifugo(),
        recreatingStatus
      ),
    ]);
  }

  private buildAck(input: {
    workerId: string;
    accountId: string;
    serverId: string;
    workerType?: EWorkerType;
    operationId: string;
    reason: string;
    debugTraceId?: string;
    runtimeGeneration?: number | null;
  }): IWorkerLifecycleAck {
    const runtimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
      input.runtimeGeneration
    );
    const ack: IWorkerLifecycleAck = {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: input.workerId,
      account_id: input.accountId,
      server_id: input.serverId,
      worker_type_id: input.workerType,
      worker_status_id: EWorkerStatus.recreating,
      operation_id: input.operationId,
      reason: input.reason,
      ...(runtimeGeneration ? { runtime_generation: runtimeGeneration } : {}),
    };

    if (input.debugTraceId) {
      ack.debug_trace_id = input.debugTraceId;
    }

    return ack;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: EditWorkerRequest,
    debugTraceIdInput?: string
  ): Promise<WorkerUpdateResult> {
    const debugTraceId =
      debugTraceIdInput ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('worker_update')
        : undefined);
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: input.worker_type,
        has_server_id: Boolean(input.server_id),
        connection_strategy: input.connection_strategy,
      }
    );

    try {
      await this.validate(t, accountId);
    } catch (error) {
      throw error;
    }
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.validated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
      }
    );

    const workerSnapshot =
      await this.workerService.viewWorkerForMonitorConsistent(input.worker_id);
    if (
      !workerSnapshot ||
      workerSnapshot.worker_id !== input.worker_id ||
      workerSnapshot.account_id !== accountId ||
      workerSnapshot.deleted_at !== null ||
      !workerSnapshot.server_id ||
      !workerSnapshot.worker_type_id ||
      !workerSnapshot.worker_status_id
    ) {
      throw new Error(t('worker_not_found'));
    }

    const nextWorkerType = input.worker_type as EWorkerType | undefined;
    const currentType = workerSnapshot.worker_type_id as EWorkerType;
    const sessionStorage =
      workerSnapshot.session_storage ?? EWorkerSessionStorage.legacy_volume;
    this.validateRequestedWorkerType(t, currentType, nextWorkerType);

    if (currentType === EWorkerType.whatsapp) {
      const inputUpdate: IUpdateWorker = {
        worker_id: input.worker_id,
        name: input.name,
      };

      const updateWorkerById = await this.workerService.updateWorkerById(
        accountId,
        inputUpdate
      );

      if (!updateWorkerById) {
        throw new Error(t('error_updating_worker'));
      }

      await this.workerConfigService.refreshTypingSimulationCache(
        input.worker_id
      );

      return updateWorkerById;
    }

    const shouldRecreateOnTypeChange = this.shouldRecreateWorkerOnTypeChange(
      currentType,
      nextWorkerType
    );
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.current_type_resolved',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        previous_worker_type_id: currentType,
        worker_type_id: nextWorkerType,
        should_recreate_on_type_change: shouldRecreateOnTypeChange,
      }
    );

    let currentServerId: string | undefined;
    let currentServerStatusId: string | undefined;
    let previousWorkerStatusId: EWorkerStatus | undefined;
    let shouldRecreateOnServerChange = false;

    if (shouldRecreateOnTypeChange || input.server_id) {
      // Use an authoritative lifecycle-only read. The old balancer projection
      // INNER JOINed api_key and server_web, making a perfectly valid channel
      // look missing before a PostgreSQL provider handoff could even start.
      const viewWorkerLifecycleServer =
        await this.workerService.viewWorkerLifecycleServer(
          accountId,
          input.worker_id
        );

      if (
        !viewWorkerLifecycleServer?.server_id ||
        viewWorkerLifecycleServer.account_id !== workerSnapshot.account_id ||
        viewWorkerLifecycleServer.server_id !== workerSnapshot.server_id
      ) {
        throw new Error(t('worker_not_found'));
      }

      currentServerId = workerSnapshot.server_id;
      currentServerStatusId = viewWorkerLifecycleServer.server_status_id;
      previousWorkerStatusId = workerSnapshot.worker_status_id;

      if (
        previousWorkerStatusId === EWorkerStatus.blocked ||
        previousWorkerStatusId === EWorkerStatus.deleting ||
        previousWorkerStatusId === EWorkerStatus.delete
      ) {
        throw new Error(t('worker_blocked_by_plan'));
      }

      if (input.server_id) {
        shouldRecreateOnServerChange = await this.validateServerEligibility(
          t,
          input.server_id,
          currentServerId
        );
      }
    }

    const shouldRecreateWorker =
      shouldRecreateOnTypeChange || shouldRecreateOnServerChange;
    if (
      shouldRecreateWorker &&
      (workerSnapshot.lifecycle_operation_id !== null ||
        workerSnapshot.worker_status_id === EWorkerStatus.blocked ||
        workerSnapshot.worker_status_id === EWorkerStatus.deleting ||
        workerSnapshot.worker_status_id === EWorkerStatus.delete)
    ) {
      throw new Error(t('worker_blocked_by_plan'));
    }
    const lifecycleOperationId = shouldRecreateWorker ? uuidv7() : undefined;
    const targetServerId = input.server_id ?? currentServerId;
    const targetWorkerType = nextWorkerType ?? currentType;
    const startsFreshConnection =
      shouldRecreateWorker &&
      input.connection_strategy === EWorkerConnectionStrategy.fresh;

    if (
      shouldRecreateWorker &&
      (!targetServerId || !targetWorkerType || !lifecycleOperationId)
    ) {
      throw new Error(t('worker_not_found'));
    }
    const {
      resetsLegacySession,
      convertsLegacyWhatsappSession,
      targetSessionStorage,
    } = this.resolveRecreateSessionStorageTransition(
      sessionStorage,
      shouldRecreateWorker,
      currentType,
      targetWorkerType
    );
    const shouldCleanupForTypeChange =
      shouldRecreateOnTypeChange && currentType !== targetWorkerType;
    const shouldCleanupForServerChange =
      shouldRecreateOnServerChange &&
      currentServerId !== targetServerId &&
      /*
       * A portable PostgreSQL session may move away from an unreachable
       * server. A legacy volume, however, must keep its cleanup dependency
       * durable even while that source is offline; otherwise the new
       * PostgreSQL connection would orphan the old authenticated volume.
       */
      (currentServerStatusId !== EServerStatus.offline ||
        convertsLegacyWhatsappSession);
    const shouldCleanupPreviousRuntime =
      Boolean(currentServerId) &&
      (shouldCleanupForTypeChange || shouldCleanupForServerChange);
    const preservesPostgresSession =
      sessionStorage === EWorkerSessionStorage.postgres &&
      !startsFreshConnection;
    const resetsPostgresSession =
      sessionStorage === EWorkerSessionStorage.postgres &&
      startsFreshConnection;
    const removesSession = resetsLegacySession || resetsPostgresSession;
    /*
     * A legacy WhatsApp Docker volume cannot safely move across a provider or
     * server. Treat either change as a destructive one-way conversion:
     * cleanup proves and removes the source volume, while the replacement
     * starts fresh with PostgreSQL session storage. A plain legacy recreate
     * does not enter this branch and therefore still preserves its
     * volume/session.
     */

    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.recreate_decision',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: nextWorkerType ?? currentType,
        lifecycle_operation_id: lifecycleOperationId,
        previous_worker_status_id: previousWorkerStatusId,
        previous_server_id: currentServerId,
        next_server_id: input.server_id,
        should_recreate_on_type_change: shouldRecreateOnTypeChange,
        should_recreate_on_server_change: shouldRecreateOnServerChange,
        should_recreate_worker: shouldRecreateWorker,
        previous_session_storage: sessionStorage,
        session_storage: targetSessionStorage,
        resets_legacy_session: resetsLegacySession,
        converts_legacy_whatsapp_session: convertsLegacyWhatsappSession,
        connection_strategy:
          input.connection_strategy ?? EWorkerConnectionStrategy.migrate,
        removes_session: removesSession,
      }
    );

    const inputUpdate: IUpdateWorker = {
      worker_id: input.worker_id,
      name: input.name,
    };

    if (shouldRecreateWorker && lifecycleOperationId) {
      inputUpdate.worker_status_id = EWorkerStatus.recreating;
      inputUpdate.lifecycle_operation_id = lifecycleOperationId;
    }

    if (
      resetsPostgresSession ||
      (shouldRecreateOnTypeChange && !preservesPostgresSession) ||
      convertsLegacyWhatsappSession
    ) {
      inputUpdate.number = null;
      inputUpdate.connection_date = null;
    }
    if (convertsLegacyWhatsappSession) {
      inputUpdate.session_storage = EWorkerSessionStorage.postgres;
    }

    const isPostgresProviderHandoff =
      shouldRecreateOnTypeChange && preservesPostgresSession;

    // A PostgreSQL provider handoff keeps the source provider authoritative
    // until the candidate revision is promoted. Persisting the target here
    // lets the target lifecycle race ahead of source drain/checkpoint and
    // makes rollback unable to prove which provider still owns the session.
    if (input.worker_type && !isPostgresProviderHandoff) {
      inputUpdate.worker_type_id = input.worker_type as EWorkerType;
    }

    if (input.server_id && shouldRecreateOnServerChange) {
      inputUpdate.server_id = input.server_id;
    }

    let recreatePayload: IWorkerPayload | undefined;
    let recreateRecoveryMessage: IWorkerLifecycleQueueMessage | undefined;
    let cleanupRecoveryPayload: IWorkerPayload | undefined;
    let cleanupRecoveryMessage: IWorkerLifecycleQueueMessage | undefined;
    if (
      shouldRecreateWorker &&
      targetServerId &&
      targetWorkerType &&
      lifecycleOperationId
    ) {
      recreatePayload = {
        action: EWorkerAction.recreate,
        worker_id: input.worker_id,
        server_id: targetServerId,
        account_id: accountId,
        worker_type_id: targetWorkerType,
        previous_worker_type_id: currentType,
        session_storage: targetSessionStorage,
        ...(convertsLegacyWhatsappSession
          ? {
              previous_session_storage: EWorkerSessionStorage.legacy_volume,
            }
          : {}),
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: lifecycleOperationId,
        previous_worker_status_id: previousWorkerStatusId,
        remove_session: removesSession,
        remove_volume: resetsLegacySession,
      };
      if (debugTraceId) {
        recreatePayload.debug_trace_id = debugTraceId;
      }

      /*
       * Build a direct-recreate recovery message before the database claim.
       * If the database connection fails after committing, this message closes
       * the claim -> Kafka boundary. When the claim did not commit, the
       * lifecycle consumer rejects it by operation_id without side effects.
       */
      recreateRecoveryMessage = this.buildLifecycleMessage({
        action: 'recreate',
        payload: recreatePayload,
        operationId: lifecycleOperationId,
        previousServerId: currentServerId,
        previousWorkerTypeId: currentType,
        cleanupPreviousRuntimeRequired: shouldCleanupPreviousRuntime,
        debugTraceId,
      });

      if (shouldCleanupPreviousRuntime && currentServerId) {
        cleanupRecoveryPayload = {
          ...recreatePayload,
          action: EWorkerAction.cleanup,
          server_id: currentServerId,
          worker_type_id: currentType,
          /*
           * During a destructive PostgreSQL provider switch the cleanup owns
           * only retirement of the source runtime. The target cold recreate
           * remains the single owner of the fenced database-session delete.
           * This ordering prevents the source cleanup from resolving the
           * already-updated target provider and also keeps retries from
           * deleting a replacement session after the target has started.
           */
          ...(resetsPostgresSession && shouldCleanupForTypeChange
            ? { remove_session: false, remove_volume: false }
            : {}),
        };
        cleanupRecoveryMessage = this.buildLifecycleMessage({
          action: 'cleanup_previous_runtime',
          payload: cleanupRecoveryPayload,
          operationId: lifecycleOperationId,
          previousServerId: currentServerId,
          previousWorkerTypeId: currentType,
          debugTraceId,
        });
      }

      await this.workerLifecycleQueueService.prepare(recreateRecoveryMessage);
      if (cleanupRecoveryMessage) {
        await this.workerLifecycleQueueService.prepare(cleanupRecoveryMessage);
      }
    }

    let updateWorkerById: boolean;
    if (shouldRecreateWorker) {
      try {
        updateWorkerById =
          await this.workerService.updateWorkerByIdIfLifecycleMatches(
            accountId,
            inputUpdate,
            {
              lifecycle_operation_id: null,
              server_id: workerSnapshot.server_id,
              worker_type_id: workerSnapshot.worker_type_id,
              worker_status_id: workerSnapshot.worker_status_id,
              ...(isPostgresProviderHandoff
                ? {
                    whatsapp_provider_handoff:
                      this.buildWhatsappProviderHandoffGuard(
                        currentType,
                        targetWorkerType,
                        lifecycleOperationId
                      ),
                  }
                : {}),
            }
          );
      } catch (claimError) {
        if (!recreatePayload || !recreateRecoveryMessage) {
          throw claimError;
        }

        try {
          if (cleanupRecoveryPayload && cleanupRecoveryMessage) {
            await this.enqueuePreparedLifecycle(cleanupRecoveryMessage);
          }
          await this.enqueuePreparedLifecycle(recreateRecoveryMessage);
        } catch (boundaryError) {
          throw new AggregateError(
            [claimError, boundaryError],
            'Worker update lifecycle claim could not be recovered'
          );
        }

        throw claimError;
      }
    } else {
      updateWorkerById = await this.workerService.updateWorkerById(
        accountId,
        inputUpdate
      );
    }

    if (!updateWorkerById) {
      throw new Error(t('error_updating_worker'));
    }
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.db_updated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: inputUpdate.worker_type_id,
        lifecycle_operation_id: lifecycleOperationId,
        status: inputUpdate.worker_status_id,
      }
    );

    if (shouldRecreateWorker) {
      await this.workerConfigService
        .refreshTypingSimulationCache(input.worker_id)
        .catch(() => undefined);
    } else {
      await this.workerConfigService.refreshTypingSimulationCache(
        input.worker_id
      );
    }

    if (!shouldRecreateWorker) {
      void this.connectionLifecycleDebugService.log(
        'manager.worker_update.response',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: input.worker_id,
          account_id: accountId,
          status: 'updated',
          reason: 'no_recreate_required',
        }
      );
      return updateWorkerById;
    }

    if (!targetServerId || !targetWorkerType || !lifecycleOperationId) {
      throw new Error(t('worker_not_found'));
    }

    if (!recreatePayload) {
      throw new Error(t('worker_not_found'));
    }

    const warmReserved = await this.reserveWarmRuntimeForWorkerUpdate({
      accountId,
      workerId: input.worker_id,
      serverId: targetServerId,
      workerType: targetWorkerType,
      sessionStorage: recreatePayload.session_storage as EWorkerSessionStorage,
      removeSession: recreatePayload.remove_session,
      removeVolume: recreatePayload.remove_volume,
      forceCold: resetsPostgresSession && shouldCleanupForTypeChange,
      lifecycleOperationId,
      debugTraceId,
    });
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.warm_reservation_checked',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: targetWorkerType,
        lifecycle_operation_id: lifecycleOperationId,
        warm_pool_id: warmReserved?.warm_pool_id,
        warm_reserved: Boolean(warmReserved),
        cold_destructive_provider_reset:
          resetsPostgresSession && shouldCleanupForTypeChange,
      }
    );

    if (cleanupRecoveryPayload && cleanupRecoveryMessage) {
      await this.enqueuePreparedLifecycle(cleanupRecoveryMessage);
      void this.connectionLifecycleDebugService.log(
        'manager.worker_update.cleanup_previous_enqueued',
        {
          trace_id: debugTraceId,
          layer: 'manager',
          worker_id: input.worker_id,
          account_id: accountId,
          worker_type_id: currentType,
          lifecycle_operation_id: lifecycleOperationId,
          previous_server_id: currentServerId,
        }
      );
    }

    await this.enqueuePreparedLifecycle(
      this.buildLifecycleMessage({
        action: warmReserved ? 'activate_warm' : 'recreate',
        payload: recreatePayload,
        operationId: lifecycleOperationId,
        warmPoolId: warmReserved?.warm_pool_id,
        previousServerId: currentServerId,
        previousWorkerTypeId: currentType,
        cleanupPreviousRuntimeRequired: shouldCleanupPreviousRuntime,
        debugTraceId,
      })
    );
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.lifecycle_enqueued',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: targetWorkerType,
        lifecycle_operation_id: lifecycleOperationId,
        warm_pool_id: warmReserved?.warm_pool_id,
        lifecycle_action: warmReserved ? 'activate_warm' : 'recreate',
      }
    );

    await this.publishRecreatingState(
      recreatePayload,
      workerSnapshot.runtime_generation
    )
      .then(() =>
        this.connectionLifecycleDebugService.log(
          'manager.worker_update.recreating_published',
          {
            trace_id: debugTraceId,
            layer: 'manager',
            worker_id: input.worker_id,
            account_id: accountId,
            worker_type_id: targetWorkerType,
            lifecycle_operation_id: lifecycleOperationId,
            status: EWorkerStatus.recreating,
          }
        )
      )
      .catch(() => undefined);

    const ack = this.buildAck({
      workerId: input.worker_id,
      accountId,
      serverId: targetServerId,
      workerType: targetWorkerType,
      operationId: lifecycleOperationId,
      reason: warmReserved ? 'warm_activation_queued' : 'recreate_queued',
      debugTraceId,
      runtimeGeneration: workerSnapshot.runtime_generation,
    });
    void this.connectionLifecycleDebugService.log(
      'manager.worker_update.response',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: targetWorkerType,
        lifecycle_operation_id: lifecycleOperationId,
        status: ack.status,
        reason: ack.reason,
      }
    );

    return ack;
  }
}
