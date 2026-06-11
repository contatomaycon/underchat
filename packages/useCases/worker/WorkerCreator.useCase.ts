import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { AccountService } from '@core/services/account.service';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { PlanAccountService } from '@core/services/planAccount.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { currentTime } from '@core/common/functions/currentTime';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { getWorkerRecreateAvailableAt } from '@core/common/functions/workerRecreateCooldown';

@injectable()
export class WorkerCreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerLifecycleQueueService)
    private readonly workerLifecycleQueueService: WorkerLifecycleQueueService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never
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

    await this.planAccountService.validateCanCreateWorker(t, accountId);
  }

  private async publishWorkerCreateEnqueueError(
    payload: IWorkerPayload,
    error: unknown
  ): Promise<void> {
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.enqueue_error',
      decision: 'enqueue_worker_create',
      outcome: 'error',
      reason: 'lifecycle_enqueue_failed',
      level: 'error',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      lifecycle_operation_id: payload.lifecycle_operation_id,
      error: error instanceof Error ? error.message : String(error),
    });

    await this.workerService.updateWorkerById(payload.account_id, {
      worker_id: payload.worker_id,
      worker_status_id: EWorkerStatus.error,
      lifecycle_operation_id: null,
    });

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payload.account_id),
      {
        ...payload,
        worker_status_id: EWorkerStatus.error,
      }
    );
  }

  private async publishWarmReplenish(
    serverId: string,
    workerType: EWorkerType,
    reason: 'claim_replenish' | 'pool_miss'
  ): Promise<void> {
    try {
      const { WorkerWarmPoolQueueService } =
        await import('@core/services/workerWarmPoolQueue.service');
      const { container } = await import('tsyringe');
      const queueService = container.resolve(WorkerWarmPoolQueueService);
      await queueService.publishReplenish({
        request_id: uuidv7(),
        server_id: serverId,
        worker_type_id: workerType,
        reason,
        requested_at: currentTime(),
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.warm_replenish_error',
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

  private async tryReserveWarmWorker(
    payload: IWorkerPayload,
    settings: IWorkerWarmPoolSettings
  ): Promise<IWorkerWarmPool | null> {
    if (!payload.worker_type_id || !this.workerWarmPoolRepository) {
      return null;
    }

    await this.workerWarmPoolRepository.releaseExpiredReservations();
    const reservationExpiresAt = new Date(
      Date.now() + settings.reservation_ttl_seconds * 1000
    ).toISOString();
    const warm = await this.workerWarmPoolRepository.reserveReady(
      payload.server_id,
      payload.worker_type_id,
      payload.worker_id,
      reservationExpiresAt
    );

    if (!warm) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.warm_pool_miss',
        decision: 'reserve_warm_worker',
        outcome: 'miss',
        level: 'warn',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        worker_type_id: payload.worker_type_id,
      });
      if (settings.warmup_enabled) {
        await this.publishWarmReplenish(
          payload.server_id,
          payload.worker_type_id,
          'pool_miss'
        );
      }
      return null;
    }

    if (settings.warmup_enabled) {
      await this.publishWarmReplenish(
        payload.server_id,
        payload.worker_type_id,
        'claim_replenish'
      );
    }

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.warm_pool_reserved',
      decision: 'reserve_warm_worker',
      outcome: 'reserved',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      server_id: payload.server_id,
      worker_type: payload.worker_type_id,
      worker_type_id: payload.worker_type_id,
      warm_pool_id: warm.warm_pool_id,
      container_id: warm.container_id,
      container_name: warm.container_name,
      session_volume_name: warm.session_volume_name,
    });

    return warm;
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    action: IWorkerLifecycleQueueMessage['action'];
    connectionLifecycleId: string;
    operationId: string;
    warmPoolId?: string;
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
      source: 'worker_create',
      warm_pool_id: input.warmPoolId,
      requested_at: currentTime(),
    };
  }

  private async enqueueLifecycleOrMarkError(
    payload: IWorkerPayload,
    message: IWorkerLifecycleQueueMessage
  ): Promise<void> {
    try {
      await this.workerLifecycleQueueService.publish(message);
    } catch (error) {
      await this.publishWorkerCreateEnqueueError(payload, error);
      throw error;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateWorkerRequest
  ): Promise<ICreateWorkerResponse> {
    const workerId = uuidv7();
    const lifecycleOperationId = uuidv7();
    const connectionLifecycleId = uuidv7();
    const requestedWorkerType =
      (input.worker_type as EWorkerType) ?? EWorkerType.baileys;

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.received',
      decision: 'create_worker',
      outcome: 'received',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      worker_type: requestedWorkerType,
      worker_type_id: requestedWorkerType,
      requested_server_id: input.server_id,
      name_length: input.name?.trim().length ?? 0,
    });

    try {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.validation_start',
        decision: 'validate_create_worker',
        outcome: 'started',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
      });
      await this.validate(t, accountId);
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.validation_success',
        decision: 'validate_create_worker',
        outcome: 'success',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.validation_error',
        decision: 'validate_create_worker',
        outcome: 'error',
        reason: 'validation_failed',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    let serverId: string;

    if (input.server_id) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.server_validation_start',
        decision: 'validate_requested_server',
        outcome: 'started',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
        requested_server_id: input.server_id,
      });
      const eligibleServers = await this.workerService.listWorkerServers();
      const serverEligible = eligibleServers.some(
        (s) => s.server_id === input.server_id
      );

      if (!serverEligible) {
        recordConnectionLifecycle({
          stage: 'connection.manager.worker_creator.server_validation_error',
          decision: 'validate_requested_server',
          outcome: 'error',
          reason: 'worker_server_not_disponible',
          level: 'error',
          connection_lifecycle_id: connectionLifecycleId,
          worker_id: workerId,
          account_id: accountId,
          worker_type: requestedWorkerType,
          worker_type_id: requestedWorkerType,
          requested_server_id: input.server_id,
          eligible_server_count: eligibleServers.length,
        });
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = input.server_id;
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.server_validation_success',
        decision: 'validate_requested_server',
        outcome: 'success',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
        eligible_server_count: eligibleServers.length,
      });
    } else {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.server_auto_select_start',
        decision: 'select_worker_server',
        outcome: 'started',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
      });
      const viewWorkerServer =
        await this.workerService.viewWorkerServer(accountId);

      if (!viewWorkerServer?.server_id) {
        recordConnectionLifecycle({
          stage: 'connection.manager.worker_creator.server_auto_select_error',
          decision: 'select_worker_server',
          outcome: 'error',
          reason: 'worker_server_not_disponible',
          level: 'error',
          connection_lifecycle_id: connectionLifecycleId,
          worker_id: workerId,
          account_id: accountId,
          worker_type: requestedWorkerType,
          worker_type_id: requestedWorkerType,
        });
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = viewWorkerServer.server_id;
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.server_auto_select_success',
        decision: 'select_worker_server',
        outcome: 'success',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: requestedWorkerType,
        worker_type_id: requestedWorkerType,
      });
    }

    const workerType = requestedWorkerType;
    if (!Object.values(EWorkerType).includes(workerType)) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.worker_type_error',
        decision: 'validate_worker_type',
        outcome: 'error',
        reason: 'worker_type_invalid',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerType,
        worker_type_id: workerType,
      });
      throw new Error(t('worker_type_invalid'));
    }

    if (!input.name || input.name.trim().length === 0) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.worker_name_error',
        decision: 'validate_worker_name',
        outcome: 'error',
        reason: 'worker_name_required',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerType,
        worker_type_id: workerType,
      });
      throw new Error(t('worker_name_required'));
    }

    const recreateAvailableAt = getWorkerRecreateAvailableAt();
    const createWorkerPayload: ICreateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
      recreate_available_at: recreateAvailableAt,
    };

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.db_create_start',
      decision: 'persist_worker',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.creating,
    });
    const isCreated =
      await this.workerService.createWorker(createWorkerPayload);

    if (!isCreated) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.db_create_error',
        decision: 'persist_worker',
        outcome: 'error',
        reason: 'worker_creation_failed',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerType,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
        worker_status_id: EWorkerStatus.creating,
      });
      throw new Error(t('worker_creation_failed'));
    }
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.db_create_success',
      decision: 'persist_worker',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.creating,
    });

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.lifecycle_mark_start',
      decision: 'persist_lifecycle_operation',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
    });
    const lifecycleMarked = await this.workerService.updateWorkerById(
      accountId,
      {
        worker_id: workerId,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

    if (!lifecycleMarked) {
      recordConnectionLifecycle({
        stage: 'connection.manager.worker_creator.lifecycle_mark_error',
        decision: 'persist_lifecycle_operation',
        outcome: 'error',
        reason: 'worker_creation_failed',
        level: 'error',
        connection_lifecycle_id: connectionLifecycleId,
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerType,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
      });
      throw new Error(t('worker_creation_failed'));
    }
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.lifecycle_mark_success',
      decision: 'persist_lifecycle_operation',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
    });

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.config_defaults_start',
      decision: 'ensure_worker_config_defaults',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
    });
    await Promise.all([
      this.workerConfigService.ensureTypingSimulationDefault(workerId),
      this.workerConfigService.ensureSecurityKeyDefault(workerId),
    ]);
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.config_defaults_success',
      decision: 'ensure_worker_config_defaults',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
    });

    const payloadCreate: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
      lifecycle_operation_id: lifecycleOperationId,
      recreate_available_at: recreateAvailableAt,
    };

    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.centrifugo_publish_start',
      decision: 'publish_worker_creating_state',
      outcome: 'started',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.creating,
      centrifugo_channel: workerCentrifugoQueue(payloadCreate.account_id),
    });
    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payloadCreate.account_id),
      payloadCreate
    );
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.centrifugo_publish_success',
      decision: 'publish_worker_creating_state',
      outcome: 'success',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.creating,
    });

    const warmSettings = await this.workerWarmPoolSettingsService.view();
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.warm_settings_loaded',
      decision: 'evaluate_warm_pool',
      outcome: 'loaded',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      warmup_enabled: warmSettings.warmup_enabled,
      reservation_ttl_seconds: warmSettings.reservation_ttl_seconds,
    });
    const warmReserved = await this.tryReserveWarmWorker(
      payloadCreate,
      warmSettings
    );
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.lifecycle_action_selected',
      decision: 'select_worker_lifecycle_action',
      outcome: warmReserved ? 'activate_warm' : 'create',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      warm_pool_id: warmReserved?.warm_pool_id,
      warm_pool_claimed: Boolean(warmReserved),
    });
    const lifecycleMessage = this.buildLifecycleMessage({
      payload: payloadCreate,
      action: warmReserved ? 'activate_warm' : 'create',
      connectionLifecycleId,
      operationId: lifecycleOperationId,
      warmPoolId: warmReserved?.warm_pool_id,
    });
    await this.enqueueLifecycleOrMarkError(payloadCreate, lifecycleMessage);

    const response: ICreateWorkerResponse = {
      code: 202,
      status: 'queued',
      queued: true,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type_id: workerType,
      worker_status_id: EWorkerStatus.creating,
      connection_lifecycle_id: connectionLifecycleId,
      operation_id: lifecycleOperationId,
      reason: warmReserved ? 'warm_activation_queued' : 'create_queued',
      recreate_available_at: recreateAvailableAt,
      warm_pool_claimed: Boolean(warmReserved),
      warm_pool_id: warmReserved?.warm_pool_id,
      fallback_created: !warmReserved && warmSettings.warmup_enabled,
    };
    recordConnectionLifecycle({
      stage: 'connection.manager.worker_creator.ack_returned',
      decision: 'create_worker',
      outcome: 'queued',
      connection_lifecycle_id: connectionLifecycleId,
      worker_id: workerId,
      account_id: accountId,
      server_id: serverId,
      worker_type: workerType,
      worker_type_id: workerType,
      lifecycle_operation_id: lifecycleOperationId,
      worker_status_id: EWorkerStatus.creating,
      warm_pool_id: warmReserved?.warm_pool_id,
      warm_pool_claimed: Boolean(warmReserved),
      reason: response.reason,
    });

    return response;
  }
}
