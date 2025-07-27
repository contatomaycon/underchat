import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { AccountService } from '@core/services/account.service';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';

@injectable()
export class WorkerUpdaterUseCase {
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
    input: EditWorkerRequest
  ): Promise<boolean> {
    await this.validate(t, accountId);

    const updateWorkerById = await this.workerService.updateWorkerById(
      input.worker_id,
      input.name
    );

    if (!updateWorkerById) {
      throw new Error(t('error_updating_worker'));
    }

    return updateWorkerById;
  }
}
