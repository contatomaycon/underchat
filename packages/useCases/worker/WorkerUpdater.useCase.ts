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
    private readonly workerConfigService: WorkerConfigService
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
    let shouldRecreateOnServerChange = false;

    if (shouldRecreateOnTypeChange || input.server_id) {
      const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
        accountId,
        input.worker_id
      );

      if (!viewWorkerBalancer?.server_id) {
        throw new Error(t('worker_not_found'));
      }

      currentServerId = viewWorkerBalancer.server_id;
      currentServerStatusId = viewWorkerBalancer.server_status_id;

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
      await this.workerRecreatorUseCase.execute(
        t,
        accountId,
        input.worker_id,
        shouldRecreateOnServerChange
          ? {
              remove_session: true,
              remove_volume: true,
              lifecycle_operation_id: lifecycleOperationId,
            }
          : { lifecycle_operation_id: lifecycleOperationId }
      );
    }

    return updateWorkerById;
  }
}
