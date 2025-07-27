import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { BalanceCreateWorkerResponse } from '@core/schema/worker/balanceCreateWorker/response.schema';
import { BalanceCreateWorkerRequest } from '@core/schema/worker/balanceCreateWorker/request.schema';
import { WorkerService } from '@core/services/worker.service';
import { v4 as uuidv4 } from 'uuid';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { AccountService } from '@core/services/account.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class WorkerBalanceCreatorUseCase {
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

  private getImageWorker(workerType: EWorkerType) {
    if (workerType === EWorkerType.whatsapp) {
      return EWorkerImage.whatsapp;
    }

    if (workerType === EWorkerType.telegram) {
      return EWorkerImage.telegram;
    }

    if (workerType === EWorkerType.discord) {
      return EWorkerImage.discord;
    }

    return EWorkerImage.baileys;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: BalanceCreateWorkerRequest
  ): Promise<BalanceCreateWorkerResponse> {
    await this.validate(t, accountId);

    const workerType = input.worker_type as EWorkerType;
    const imageName = this.getImageWorker(workerType);
    const containerName = uuidv4();

    const containerId = await this.workerService.createContainerWorker(
      t,
      imageName,
      containerName
    );

    if (!containerId) {
      throw new Error(t('worker_creation_failed'));
    }

    const workerData: ICreateWorker = {
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: workerType,
      server_id: input.server_id,
      account_id: accountId,
      container_name: containerName,
      container_id: containerId,
      name: input.name,
    };

    const workerId = await this.workerService.createWorker(workerData);

    if (!workerId) {
      throw new Error(t('worker_creation_failed'));
    }

    return {
      worker_id: workerId,
    };
  }
}
