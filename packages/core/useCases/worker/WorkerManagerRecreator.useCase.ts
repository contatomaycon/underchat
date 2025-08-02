import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { BalanceService } from '@core/services/balance.service';
import { ManagerRecreateWorkerResponse } from '@core/schema/worker/managerRecreateWorker/response.schema';

@injectable()
export class WorkerManagerRecreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly balanceService: BalanceService
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
  ): Promise<ManagerRecreateWorkerResponse> {
    await this.validate(t, accountId);

    const viewWorkerBalancer = await this.workerService.viewWorkerBalancer(
      accountId,
      isAdministrator,
      workerId
    );

    if (!viewWorkerBalancer) {
      throw new Error(t('worker_balancer_not_available'));
    }

    const recreateWorker = await this.balanceService.recreateWorker(
      t,
      viewWorkerBalancer,
      workerId
    );

    return {
      worker_id: recreateWorker.worker_id,
    };
  }
}
