import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';

@injectable()
export class WorkerConfigViewerUseCase {
  constructor(
    private readonly workerConfigService: WorkerConfigService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string
  ): Promise<ViewWorkerConfigResponse> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerConfigService.viewWorkerConfig(workerId);
  }
}
