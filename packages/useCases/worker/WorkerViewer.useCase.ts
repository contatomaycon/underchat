import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';

@injectable()
export class WorkerViewerUseCase {
  constructor(private readonly workerService: WorkerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<ViewWorkerResponse> {
    const worker = await this.workerService.viewWorker(
      accountId,
      isAdministrator,
      workerId
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    return worker;
  }
}
