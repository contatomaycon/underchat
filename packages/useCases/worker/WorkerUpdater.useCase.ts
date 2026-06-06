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
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

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
    private readonly centrifugoService: CentrifugoService
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
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_updater.warm_replenish_error',
        decision: 'enqueue_warm_replenish',
        outcome: 'error',
        reason,
        level: 'warn',
        server_id: serverId,
        worker_type: workerType,
        worker_type_id: workerType,
        error: error instanceof Error ? error.message : String(error),
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
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_updater.warm_pool_miss',
        decision: 'reserve_warm_worker',
        outcome: 'miss',
        level: 'warn',
        worker_id: input.workerId,
        account_id: input.accountId,
        server_id: input.serverId,
        worker_type: input.workerType,
        worker_type_id: input.workerType,
        source: 'worker_update',
      });
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

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_updater.warm_pool_reserved',
      decision: 'reserve_warm_worker',
      outcome: 'reserved',
      worker_id: input.workerId,
      account_id: input.accountId,
      server_id: input.serverId,
      worker_type: input.workerType,
      worker_type_id: input.workerType,
      warm_pool_id: warm.warm_pool_id,
      container_id: warm.container_id,
      container_name: warm.container_name,
      session_volume_name: warm.session_volume_name,
      source: 'worker_update',
    });

    return warm;
  }

  private buildLifecycleMessage(input: {
    action: IWorkerLifecycleQueueMessage['action'];
    payload: IWorkerPayload;
    connectionLifecycleId: string;
    operationId: string;
    source?: IWorkerLifecycleQueueMessage['source'];
    warmPoolId?: string;
    previousServerId?: string;
    previousWorkerTypeId?: EWorkerType;
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      connection_lifecycle_id: input.connectionLifecycleId,
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
  }

  private async enqueueLifecycleOrMarkError(
    accountId: string,
    payload: IWorkerPayload,
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.workerLifecycleQueueService.publish(message);
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_updater.enqueue_error',
        decision: 'enqueue_worker_update_lifecycle',
        outcome: 'error',
        reason: 'lifecycle_enqueue_failed',
        level: 'error',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        lifecycle_operation_id: payload.lifecycle_operation_id,
        lifecycle_action: message.action,
        error: error instanceof Error ? error.message : String(error),
      });
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
    connectionLifecycleId: string;
    operationId: string;
    reason: string;
  }): IWorkerLifecycleAck {
    return {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: input.workerId,
      account_id: input.accountId,
      server_id: input.serverId,
      worker_type_id: input.workerType,
      worker_status_id: EWorkerStatus.recreating,
      connection_lifecycle_id: input.connectionLifecycleId,
      operation_id: input.operationId,
      reason: input.reason,
    };
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: EditWorkerRequest
  ): Promise<WorkerUpdateResult> {
    await this.validate(t, accountId);

    const currentWorkerType = await this.workerService.viewWorkerType(
      accountId,
      input.worker_id
    );
    const nextWorkerType = input.worker_type as EWorkerType | undefined;
    const currentType = currentWorkerType?.worker_type_id as
      | EWorkerType
      | undefined;

    const shouldRecreateOnTypeChange = this.shouldRecreateWorkerOnTypeChange(
      currentType,
      nextWorkerType
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
        | EWorkerStatus
        | undefined;

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
    const connectionLifecycleId = shouldRecreateWorker ? uuidv7() : undefined;

    const inputUpdate: IUpdateWorker = {
      worker_id: input.worker_id,
      name: input.name,
    };

    if (shouldRecreateWorker && lifecycleOperationId) {
      inputUpdate.worker_status_id = EWorkerStatus.recreating;
      inputUpdate.lifecycle_operation_id = lifecycleOperationId;
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

    await this.workerConfigService.refreshTypingSimulationCache(
      input.worker_id
    );

    if (!shouldRecreateWorker) {
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

    await this.publishRecreatingState(recreatePayload);

    const warmReserved = await this.tryReserveWarmRuntimeForRecreate({
      accountId,
      workerId: input.worker_id,
      serverId: targetServerId,
      workerType: targetWorkerType,
    });

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
      recordConnectionLifecycle({
        stage:
          'connection.manager.worker_updater.cleanup_skipped_for_same_server_warm_activation',
        decision: 'enqueue_worker_update_lifecycle',
        outcome: 'skipped',
        reason: 'activate_warm_owns_same_server_runtime_replacement',
        worker_id: input.worker_id,
        account_id: accountId,
        server_id: targetServerId,
        previous_server_id: currentServerId,
        worker_type: targetWorkerType,
        worker_type_id: targetWorkerType,
        previous_worker_type_id: currentType,
        warm_pool_id: warmReserved.warm_pool_id,
        lifecycle_operation_id: lifecycleOperationId,
      });
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
          connectionLifecycleId: connectionLifecycleId ?? uuidv7(),
          operationId: lifecycleOperationId,
          previousServerId: currentServerId,
          previousWorkerTypeId: currentType,
        })
      );
    }

    await this.enqueueLifecycleOrMarkError(
      accountId,
      recreatePayload,
      this.buildLifecycleMessage({
        action: warmReserved ? 'activate_warm' : 'recreate',
        payload: recreatePayload,
        connectionLifecycleId: connectionLifecycleId ?? uuidv7(),
        operationId: lifecycleOperationId,
        warmPoolId: warmReserved?.warm_pool_id,
        previousServerId: currentServerId,
        previousWorkerTypeId: currentType,
      })
    );

    return this.buildAck({
      workerId: input.worker_id,
      accountId,
      serverId: targetServerId,
      workerType: targetWorkerType,
      connectionLifecycleId: connectionLifecycleId ?? lifecycleOperationId,
      operationId: lifecycleOperationId,
      reason: warmReserved ? 'warm_activation_queued' : 'recreate_queued',
    });
  }
}
