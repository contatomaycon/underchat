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
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { getWorkerRecreateAvailableAt } from '@core/common/functions/workerRecreateCooldown';
import {
  ConnectionLifecycleDebugService,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
} from '@core/services/connectionLifecycleDebug.service';

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
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never,
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

    await this.planAccountService.validateCanCreateWorker(t, accountId);
  }

  private async publishWorkerCreateEnqueueError(
    payload: IWorkerPayload
  ): Promise<void> {
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
    } catch {}
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

    return warm;
  }

  private buildLifecycleMessage(input: {
    payload: IWorkerPayload;
    action: IWorkerLifecycleQueueMessage['action'];
    operationId: string;
    warmPoolId?: string;
  }): IWorkerLifecycleQueueMessage {
    return {
      request_id: uuidv7(),
      operation_id: input.operationId,
      action: input.action,
      worker_id: input.payload.worker_id,
      account_id: input.payload.account_id,
      server_id: input.payload.server_id,
      worker_type_id: input.payload.worker_type_id,
      worker_status_id: input.payload.worker_status_id,
      source: 'worker_create',
      warm_pool_id: input.warmPoolId,
      debug_trace_id: input.payload.debug_trace_id,
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
      await this.publishWorkerCreateEnqueueError(payload);
      throw error;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateWorkerRequest,
    debugTraceIdInput?: string
  ): Promise<ICreateWorkerResponse> {
    const debugTraceId =
      debugTraceIdInput ??
      (isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('worker_create')
        : undefined);
    const workerId = uuidv7();
    const lifecycleOperationId = uuidv7();
    const requestedWorkerType =
      (input.worker_type as EWorkerType) ?? EWorkerType.baileys;

    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.start',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: requestedWorkerType,
        lifecycle_operation_id: lifecycleOperationId,
        has_server_id: Boolean(input.server_id),
      }
    );

    await this.validate(t, accountId);
    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.validated',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: requestedWorkerType,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

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

    const workerType = requestedWorkerType;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (!input.name || input.name.trim().length === 0) {
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

    const isCreated =
      await this.workerService.createWorker(createWorkerPayload);

    if (!isCreated) {
      throw new Error(t('worker_creation_failed'));
    }
    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.db_created',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
        server_id: serverId,
      }
    );

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
    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.lifecycle_marked',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
      }
    );

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
      recreate_available_at: recreateAvailableAt,
      debug_trace_id: debugTraceId,
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
      operationId: lifecycleOperationId,
      warmPoolId: warmReserved?.warm_pool_id,
    });
    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.lifecycle_enqueue',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
        action: lifecycleMessage.action,
        server_id: serverId,
        warm_pool_id: warmReserved?.warm_pool_id,
      }
    );
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
      operation_id: lifecycleOperationId,
      reason: warmReserved ? 'warm_activation_queued' : 'create_queued',
      recreate_available_at: recreateAvailableAt,
      warm_pool_claimed: Boolean(warmReserved),
      warm_pool_id: warmReserved?.warm_pool_id,
      fallback_created: !warmReserved && warmSettings.warmup_enabled,
      debug_trace_id: debugTraceId,
    };

    void this.connectionLifecycleDebugService.log(
      'manager.worker_create.response',
      {
        trace_id: debugTraceId,
        layer: 'manager',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerType,
        lifecycle_operation_id: lifecycleOperationId,
        status: response.status,
        reason: response.reason,
      }
    );

    return response;
  }
}
