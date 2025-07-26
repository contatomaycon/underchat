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
export class WorkerCreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    input: BalanceCreateWorkerRequest
  ) {
    const existsAccountById = await this.accountService.existsAccountById(
      input.account_id
    );

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }

    const [viewAccountQuantityProduct, totalWorkerByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          input.account_id,
          EPlanProduct.worker
        ),
        this.workerService.totalWorkerByAccountId(input.account_id),
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
    input: BalanceCreateWorkerRequest
  ): Promise<BalanceCreateWorkerResponse> {
    await this.validate(t, input);

    const workerType = input.worker_type as EWorkerType;
    const imageName = this.getImageWorker(workerType);
    const containerName = uuidv4();

    const serverId = await this.workerService.viewWorkerBalancerServerId();

    if (!serverId) {
      throw new Error(t('worker_balancer_server_not_disponible'));
    }

    const containerId = await this.workerService.createContainerWorker(
      t,
      imageName,
      containerName
    );

    if (!containerId) {
      throw new Error(t('worker_creation_failed'));
    }

    const workerData: ICreateWorker = {
      worker_status_id: EWorkerStatus.online,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: input.account_id,
      name: containerName,
      container_id: containerId,
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
