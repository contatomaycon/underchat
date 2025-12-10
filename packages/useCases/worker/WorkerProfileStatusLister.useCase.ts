import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { WorkerService } from '@core/services/worker.service';
import { ListProfileStatusResponse } from '@core/schema/worker/listProfileStatus/response.schema';

@injectable()
export class WorkerProfileStatusListerUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<ListProfileStatusResponse> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerProfileStatusService.listProfileStatus(workerId);
  }
}
