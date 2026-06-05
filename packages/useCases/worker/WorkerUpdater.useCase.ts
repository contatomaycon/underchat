import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { getErrorMessage } from '@core/common/functions/toError';
import { v7 as uuidv7 } from 'uuid';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { currentTime } from '@core/common/functions/currentTime';
import { logger } from '@core/plugins/telemetry/logger';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';

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
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerRecreatorUseCase)
    private readonly workerRecreatorUseCase: WorkerRecreatorUseCase,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never
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

  private async disconnectCurrentWorker(
    accountId: string,
    workerId: string,
    serverId: string
  ): Promise<void> {
    const payload: StatusConnectionWorkerRequest = {
      worker_id: workerId,
      status: EWorkerStatus.disponible,
      type: EBaileysConnectionType.qrcode,
    };

    try {
      await this.workerGrpcClientService.changeConnectionStatus(
        serverId,
        payload,
        accountId
      );
    } catch (err) {
      console.error('Failed to disconnect current worker before type change', {
        workerId,
        accountId,
        serverId,
        error: getErrorMessage(err),
      });
    }
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

  private isGrpcUnavailableError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const grpcError = error as { code?: number };

    return (
      grpcError.code === GrpcStatus.UNAVAILABLE ||
      grpcError.code === GrpcStatus.DEADLINE_EXCEEDED
    );
  }

  private async tryActivateWarmRuntimeForRecreate(input: {
    accountId: string;
    workerId: string;
    serverId: string;
    workerType: EWorkerType;
    oldServerId?: string;
    currentRuntime?: IWorkerRuntime | null;
    lifecycleOperationId?: string;
  }): Promise<boolean> {
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
      logger.warn(
        {
          type: 'warm_pool.miss',
          worker_id: input.workerId,
          account_id: input.accountId,
          server_id: input.serverId,
          worker_type_id: input.workerType,
          source: 'worker_update',
        },
        'Warm worker pool miss during update/recreate'
      );
      return false;
    }

    try {
      await this.workerGrpcClientService.activateWarmWorker(
        input.serverId,
        {
          warm_pool_id: warm.warm_pool_id,
          worker_id: input.workerId,
          account_id: input.accountId,
          server_id: input.serverId,
          worker_type_id: input.workerType,
          lifecycle_operation_id: input.lifecycleOperationId,
        },
        60_000
      );

      await this.workerService.updateWorkerById(input.accountId, {
        worker_id: input.workerId,
        worker_status_id: EWorkerStatus.disponible,
        lifecycle_operation_id: null,
        number: null,
        connection_date: null,
      });

      if (input.currentRuntime?.session_volume_name) {
        const sameServer = input.oldServerId === input.serverId;
        await this.workerGrpcClientService.deleteWarmWorker(
          input.oldServerId ?? input.serverId,
          {
            request_id: uuidv7(),
            worker_id: input.workerId,
            server_id: input.oldServerId ?? input.serverId,
            worker_type_id: input.workerType,
            container_name: sameServer
              ? undefined
              : (input.currentRuntime.container_name ?? input.workerId),
            session_volume_name: input.currentRuntime.session_volume_name,
            remove_volume: true,
            reason: 'worker_type_change',
            requested_at: currentTime(),
          },
          60_000
        );
      }

      logger.info(
        {
          type: 'warm_pool.claim',
          worker_id: input.workerId,
          account_id: input.accountId,
          server_id: input.serverId,
          worker_type_id: input.workerType,
          warm_pool_id: warm.warm_pool_id,
          source: 'worker_update',
        },
        'Warm worker claimed for update/recreate'
      );

      return true;
    } catch (error) {
      logger.error(
        {
          type: 'warm_pool.activate.error',
          worker_id: input.workerId,
          account_id: input.accountId,
          server_id: input.serverId,
          worker_type_id: input.workerType,
          warm_pool_id: warm.warm_pool_id,
          error: getErrorMessage(error),
        },
        'Warm worker activation for update failed'
      );

      await this.workerGrpcClientService.deleteWarmWorker(
        input.serverId,
        {
          request_id: uuidv7(),
          warm_pool_id: warm.warm_pool_id,
          server_id: input.serverId,
          worker_type_id: input.workerType,
          container_id: warm.container_id ?? undefined,
          container_name: warm.container_name ?? undefined,
          session_volume_name: warm.session_volume_name ?? undefined,
          remove_volume: true,
          reason: 'pool_reconcile',
          requested_at: currentTime(),
        },
        60_000
      );
      return false;
    }
  }

  private async cleanupPreviousWorkerServer(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    currentServerId: string,
    currentServerStatusId?: string,
    lifecycleOperationId?: string
  ): Promise<void> {
    if (currentServerStatusId === EServerStatus.offline) {
      return;
    }

    const payload: IWorkerPayload = {
      action: EWorkerAction.cleanup,
      worker_id: workerId,
      server_id: currentServerId,
      account_id: accountId,
      remove_session: true,
      remove_volume: true,
      ...(lifecycleOperationId
        ? { lifecycle_operation_id: lifecycleOperationId }
        : {}),
    };

    try {
      await this.workerGrpcClientService.cleanupWorker(payload);
    } catch (err) {
      if (this.isGrpcUnavailableError(err)) {
        return;
      }

      throw new Error(t('worker_removal_failed'), { cause: err });
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: EditWorkerRequest
  ): Promise<boolean> {
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
    let currentRuntime: IWorkerRuntime | null = null;

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
      currentRuntime =
        (await this.workerRuntimeRepository?.viewByWorkerId(input.worker_id)) ??
        null;

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

    if (
      shouldRecreateOnTypeChange &&
      currentServerId &&
      !shouldRecreateOnServerChange &&
      lifecycleOperationId
    ) {
      await this.workerService.updateWorkerById(accountId, {
        worker_id: input.worker_id,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: lifecycleOperationId,
      });

      await this.disconnectCurrentWorker(
        accountId,
        input.worker_id,
        currentServerId
      );
    }

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

    if (
      shouldRecreateOnServerChange &&
      currentServerId &&
      lifecycleOperationId
    ) {
      await this.cleanupPreviousWorkerServer(
        t,
        accountId,
        input.worker_id,
        currentServerId,
        currentServerStatusId,
        lifecycleOperationId
      );
    }

    if (shouldRecreateWorker) {
      const warmWorkerType = nextWorkerType ?? currentType;
      const warmActivated =
        warmWorkerType &&
        (input.server_id || currentServerId) &&
        (await this.tryActivateWarmRuntimeForRecreate({
          accountId,
          workerId: input.worker_id,
          serverId: input.server_id ?? currentServerId ?? '',
          workerType: warmWorkerType,
          oldServerId: currentServerId,
          currentRuntime,
          lifecycleOperationId,
        }));

      if (warmActivated) {
        return true;
      }

      const shouldResetSessionForRecreate =
        shouldRecreateOnTypeChange || shouldRecreateOnServerChange;

      await this.workerRecreatorUseCase.execute(
        t,
        accountId,
        input.worker_id,
        shouldResetSessionForRecreate
          ? {
              remove_session: true,
              remove_volume: true,
              lifecycle_operation_id: lifecycleOperationId,
              previous_worker_status_id: previousWorkerStatusId,
            }
          : {
              lifecycle_operation_id: lifecycleOperationId,
              previous_worker_status_id: previousWorkerStatusId,
            }
      );
    }

    return updateWorkerById;
  }
}
