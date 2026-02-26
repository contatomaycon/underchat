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

@injectable()
export class WorkerUpdaterUseCase {
  private readonly recreatableWorkerTypes = new Set<EWorkerType>([
    EWorkerType.baileys,
    EWorkerType.wwebjs,
  ]);

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerRecreatorUseCase)
    private readonly workerRecreatorUseCase: WorkerRecreatorUseCase
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
    t: TFunction<'translation', undefined>,
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
      throw new Error(t('grpc_error'), { cause: err });
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

      if (input.server_id) {
        shouldRecreateOnServerChange = await this.validateServerEligibility(
          t,
          input.server_id,
          currentServerId
        );
      }
    }

    if (shouldRecreateOnTypeChange && currentServerId) {
      await this.disconnectCurrentWorker(
        t,
        accountId,
        input.worker_id,
        currentServerId
      );
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: input.worker_id,
      name: input.name,
    };

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

    const shouldRecreateWorker =
      shouldRecreateOnTypeChange || shouldRecreateOnServerChange;

    if (shouldRecreateWorker) {
      await this.workerRecreatorUseCase.execute(t, accountId, input.worker_id);
    }

    return updateWorkerById;
  }
}
