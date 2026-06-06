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
    await this.validate(t, accountId);

    let serverId: string;

    if (input.server_id) {
      const eligibleServers = await this.workerService.listWorkerServers();
      const serverEligible = eligibleServers.some(
        (s) => s.server_id === input.server_id
      );

      if (!serverEligible) {
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = input.server_id;
    } else {
      const viewWorkerServer =
        await this.workerService.viewWorkerServer(accountId);

      if (!viewWorkerServer?.server_id) {
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = viewWorkerServer.server_id;
    }

    const workerType =
      (input.worker_type as EWorkerType) ?? EWorkerType.baileys;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new Error(t('worker_name_required'));
    }

    const workerId = uuidv7();
    const lifecycleOperationId = uuidv7();
    const connectionLifecycleId = uuidv7();

    const createWorkerPayload: ICreateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
    };

    const isCreated =
      await this.workerService.createWorker(createWorkerPayload);

    if (!isCreated) {
      throw new Error(t('worker_creation_failed'));
    }

    const lifecycleMarked = await this.workerService.updateWorkerById(
      accountId,
      {
        worker_id: workerId,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

    if (!lifecycleMarked) {
      throw new Error(t('worker_creation_failed'));
    }

    await Promise.all([
      this.workerConfigService.ensureTypingSimulationDefault(workerId),
      this.workerConfigService.ensureSecurityKeyDefault(workerId),
    ]);

    const payloadCreate: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
      lifecycle_operation_id: lifecycleOperationId,
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payloadCreate.account_id),
      payloadCreate
    );

    const warmSettings = await this.workerWarmPoolSettingsService.view();
    const warmReserved = await this.tryReserveWarmWorker(
      payloadCreate,
      warmSettings
    );
    const lifecycleMessage = this.buildLifecycleMessage({
      payload: payloadCreate,
      action: warmReserved ? 'activate_warm' : 'create',
      connectionLifecycleId,
      operationId: lifecycleOperationId,
      warmPoolId: warmReserved?.warm_pool_id,
    });
    await this.enqueueLifecycleOrMarkError(payloadCreate, lifecycleMessage);

    return {
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
      warm_pool_claimed: Boolean(warmReserved),
      warm_pool_id: warmReserved?.warm_pool_id,
      fallback_created: !warmReserved && warmSettings.warmup_enabled,
    };
  }
}
