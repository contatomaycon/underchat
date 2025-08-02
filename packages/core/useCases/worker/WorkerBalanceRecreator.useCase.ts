import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { AccountService } from '@core/services/account.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { BalanceRecreateWorkerResponse } from '@core/schema/worker/balanceRecreateWorker/response.schema';

@injectable()
export class WorkerBalanceRecreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService
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

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<BalanceRecreateWorkerResponse> {
    await this.validate(t, accountId);

    const viewWorkerType = await this.workerService.viewWorkerType(
      accountId,
      isAdministrator,
      workerId
    );

    if (!viewWorkerType) {
      throw new Error(t('worker_not_found'));
    }

    const removeContainerWorker =
      await this.workerService.removeContainerWorker(t, workerId, false);

    if (!removeContainerWorker) {
      throw new Error(t('worker_removal_failed'));
    }

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
    const imageName = getImageWorker(workerType);

    const containerId = await this.workerService.createContainerWorker(
      t,
      imageName,
      workerId,
      false
    );

    if (!containerId) {
      throw new Error(t('worker_recreation_failed'));
    }

    const workerData: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: workerType,
      container_id: containerId,
    };

    const statusRecreateCreate =
      await this.workerService.updateWorkerRecreate(workerData);

    if (!statusRecreateCreate) {
      throw new Error(t('worker_recreation_failed'));
    }

    return {
      worker_id: workerId,
    };
  }
}
