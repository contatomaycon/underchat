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

type WorkerUpdateResult = boolean | IWorkerLifecycleAck;

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
  }): Promise<IWorkerWarmPool | null> {
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
      reservationExpiresAt
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

  private buildLifecycleMessage(input: {
    action: IWorkerLifecycleQueueMessage['action'];
    payload: IWorkerPayload;
    operationId: string;
    source?: IWorkerLifecycleQueueMessage['source'];
    warmPoolId?: string;
    previousServerId?: string;
    previousWorkerTypeId?: EWorkerType;
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
      worker_status_id: input.payload.worker_status_id,
      source: input.source ?? 'worker_update',
      remove_session: input.payload.remove_session,
      remove_volume: input.payload.remove_volume,
      warm_pool_id: input.warmPoolId,
      previous_server_id: input.previousServerId,
      previous_worker_type_id: input.previousWorkerTypeId,
      previous_worker_status_id: input.payload.previous_worker_status_id,
      requested_at: currentTime(),
    };

    const debugTraceId = input.debugTraceId ?? input.payload.debug_trace_id;
    if (debugTraceId) {
      message.debug_trace_id = debugTraceId;
    }

    return message;
  }

  private async enqueueLifecycleOrMarkError(
    accountId: string,
    payload: IWorkerPayload,
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.workerLifecycleQueueService.publish(message);
    } catch (error) {
      await this.workerService.updateWorkerById(accountId, {
        worker_id: payload.worker_id,
        worker_status_id: EWorkerStatus.error,
        lifecycle_operation_id: null,
      });
      throw error;
    }
  }

  private async publishRecreatingState(payload: IWorkerPayload): Promise<void> {
    await Promise.all([
      this.centrifugoService.publishSub(
        workerCentrifugoQueue(payload.account_id),
        payload
      ),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
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
  }): IWorkerLifecycleAck {
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

    const currentWorkerType = await this.workerService.viewWorkerType(
      accountId,
      input.worker_id
    );
    const nextWorkerType = input.worker_type as EWorkerType | undefined;
    const currentType = currentWorkerType?.worker_type_id as
      EWorkerType | undefined;

    if (!currentType) {
      throw new Error(t('worker_not_found'));
    }

    if (
      nextWorkerType &&
      !Object.values(EWorkerType).includes(nextWorkerType)
    ) {
      throw new Error(t('worker_type_invalid'));
    }

    if (
      currentType === EWorkerType.whatsapp &&
      nextWorkerType &&
      nextWorkerType !== EWorkerType.whatsapp
    ) {
      throw new Error(t('whatsapp_official_type_change_not_allowed'));
    }

    if (
      currentType !== EWorkerType.whatsapp &&
      nextWorkerType === EWorkerType.whatsapp
    ) {
      throw new Error(t('whatsapp_official_connect_required'));
    }

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
      const [viewWorkerBalancer, viewWorker] = await Promise.all([
        this.workerService.viewWorkerBalancer(accountId, input.worker_id),
        this.workerService.viewWorker(accountId, input.worker_id),
      ]);

      if (!viewWorkerBalancer?.server_id) {
        throw new Error(t('worker_not_found'));
      }

      currentServerId = viewWorkerBalancer.server_id;
      currentServerStatusId = viewWorkerBalancer.server_status_id;
      previousWorkerStatusId = viewWorker?.status?.id as
        EWorkerStatus | undefined;

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
    const lifecycleOperationId = shouldRecreateWorker ? uuidv7() : undefined;
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

    if (shouldRecreateOnTypeChange) {
      inputUpdate.number = null;
      inputUpdate.connection_date = null;
    }

    if (input.worker_type) {
      inputUpdate.worker_type_id = input.worker_type as EWorkerType;
    }

    if (input.server_id && shouldRecreateOnServerChange) {
      inputUpdate.server_id = input.server_id;
    }

    const updateWorkerById = await this.workerService.updateWorkerById(
      accountId,
      inputUpdate
    );

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

    await this.workerConfigService.refreshTypingSimulationCache(
      input.worker_id
    );

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

    const targetServerId = input.server_id ?? currentServerId;
    const targetWorkerType = nextWorkerType ?? currentType;

    if (!targetServerId || !targetWorkerType || !lifecycleOperationId) {
      throw new Error(t('worker_not_found'));
    }

    const recreatePayload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: input.worker_id,
      server_id: targetServerId,
      account_id: accountId,
      worker_type_id: targetWorkerType,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: lifecycleOperationId,
      previous_worker_status_id: previousWorkerStatusId,
      remove_session: true,
      remove_volume: true,
    };
    if (debugTraceId) {
      recreatePayload.debug_trace_id = debugTraceId;
    }

    await this.publishRecreatingState(recreatePayload);
    void this.connectionLifecycleDebugService.log(
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
    );

    const warmReserved = await this.tryReserveWarmRuntimeForRecreate({
      accountId,
      workerId: input.worker_id,
      serverId: targetServerId,
      workerType: targetWorkerType,
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
      }
    );

    const shouldCleanupPreviousRuntime =
      Boolean(currentServerId) &&
      currentServerId !== targetServerId &&
      currentServerStatusId !== EServerStatus.offline &&
      shouldRecreateOnServerChange;

    if (
      warmReserved &&
      currentServerId === targetServerId &&
      currentServerStatusId !== EServerStatus.offline
    ) {
    }

    if (shouldCleanupPreviousRuntime && currentServerId) {
      const cleanupPayload: IWorkerPayload = {
        ...recreatePayload,
        action: EWorkerAction.cleanup,
        server_id: currentServerId,
        worker_type_id: currentType,
      };

      await this.enqueueLifecycleOrMarkError(
        accountId,
        cleanupPayload,
        this.buildLifecycleMessage({
          action: 'cleanup_previous_runtime',
          payload: cleanupPayload,
          operationId: lifecycleOperationId,
          previousServerId: currentServerId,
          previousWorkerTypeId: currentType,
          debugTraceId,
        })
      );
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

    await this.enqueueLifecycleOrMarkError(
      accountId,
      recreatePayload,
      this.buildLifecycleMessage({
        action: warmReserved ? 'activate_warm' : 'recreate',
        payload: recreatePayload,
        operationId: lifecycleOperationId,
        warmPoolId: warmReserved?.warm_pool_id,
        previousServerId: currentServerId,
        previousWorkerTypeId: currentType,
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

    const ack = this.buildAck({
      workerId: input.worker_id,
      accountId,
      serverId: targetServerId,
      workerType: targetWorkerType,
      operationId: lifecycleOperationId,
      reason: warmReserved ? 'warm_activation_queued' : 'recreate_queued',
      debugTraceId,
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
