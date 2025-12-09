import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { WorkerService } from '@core/services/worker.service';
import { ViewProfileInfoResponse } from '@core/schema/worker/viewProfileInfo/response.schema';

@injectable()
export class WorkerProfileInfoViewerUseCase {
  constructor(
    private readonly workerProfileInfoService: WorkerProfileInfoService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<ViewProfileInfoResponse> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerProfileInfoService.viewWorkerProfileInfo(workerId);
  }
}
