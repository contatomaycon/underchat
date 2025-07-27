import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { AccountService } from '@core/services/account.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { ManagerCreateWorkerRequest } from '@core/schema/worker/managerCreateWorker/request.schema';
import { ManagerCreateWorkerResponse } from '@core/schema/worker/managerCreateWorker/response.schema';
import { BalanceService } from '@core/services/balance.service';
import { BalanceCreateWorkerRequest } from '@core/schema/worker/balanceCreateWorker/request.schema';

@injectable()
export class WorkerManagerCreatorUseCase {
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

    const [viewAccountQuantityProduct, totalWorkerByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.worker
        ),
        this.workerService.totalWorkerByAccountId(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('worker_not_available'));
    }

    if (totalWorkerByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('worker_not_available_additional'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: ManagerCreateWorkerRequest
  ): Promise<ManagerCreateWorkerResponse> {
    await this.validate(t, accountId);

    const workerType = input.worker_type as EWorkerType;

    const viewWorkerBalancerServer =
      await this.workerService.viewWorkerBalancerServer(accountId);

    console.log('viewWorkerBalancerServer', viewWorkerBalancerServer);

    if (!viewWorkerBalancerServer) {
      throw new Error(t('worker_balancer_server_not_disponible'));
    }

    const payload: BalanceCreateWorkerRequest = {
      server_id: viewWorkerBalancerServer.server_id,
      worker_type: workerType,
    };

    const createWorker = await this.balanceService.createWorker(
      t,
      viewWorkerBalancerServer,
      payload
    );

    console.log('workerId', createWorker);

    return {
      worker_id: createWorker.worker_id,
    };
  }
}
