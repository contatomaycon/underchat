import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IDeleteWorker } from '@core/common/interfaces/IDeleteWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerDeleterUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly streamProducerService: StreamProducerService
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

  private async onWorkerDeleted(
    t: TFunction<'translation', undefined>,
    payload: IDeleteWorker
  ): Promise<void> {
    try {
      await this.streamProducerService.send(
        `delete.${payload.server_id}.worker`,
        payload
      );
    } catch {
      throw new Error(t('kafka_error'));
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

    const inputDeleter: IDeleteWorker = {
      worker_id: workerId,
      server_id: viewWorkerBalancer.server_id,
      account_id: accountId,
      is_administrator: isAdministrator,
    };

    await this.onWorkerDeleted(t, inputDeleter);

    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.deleting,
    };

    return this.workerService.updateWorkerById(
      isAdministrator,
      accountId,
      inputUpdate
    );
  }
}
