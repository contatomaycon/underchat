import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { BalanceService } from '@core/services/balance.service';

@injectable()
export class WorkerManagerDeleterUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly balanceService: BalanceService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    isAdministrator: boolean,
    workerId: string,
    accountId: string
  ) {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<boolean> {
    await this.validate(t, isAdministrator, workerId, accountId);

    const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
      accountId,
      isAdministrator,
      workerId
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_not_found'));
    }

    const deleteWorker = await this.balanceService.deleteWorker(
      t,
      viewWorkerBalancer,
      workerId
    );

    if (!deleteWorker) {
      throw new Error(t('worker_delete_error'));
    }

    return this.workerService.deleteWorkerById(
      isAdministrator,
      accountId,
      workerId
    );
  }
}
