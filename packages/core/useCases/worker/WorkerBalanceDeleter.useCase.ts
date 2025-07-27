import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';

@injectable()
export class WorkerBalanceDeleterUseCase {
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
    workerId: string
  ): Promise<boolean> {
    await this.validate(t, accountId);

    const viewWorkerNameAndId = await this.workerService.viewWorkerNameAndId(
      accountId,
      workerId
    );

    if (!viewWorkerNameAndId) {
      throw new Error(t('worker_not_found'));
    }

    const containerId = await this.workerService.removeContainerWorker(
      viewWorkerNameAndId.container_name,
      t
    );

    if (!containerId) {
      throw new Error(t('worker_removal_failed'));
    }

    return true;
  }
}
