import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { WorkerService } from '@core/services/worker.service';
import { ViewProfileInfoResponse } from '@core/schema/worker/viewProfileInfo/response.schema';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class WorkerProfileInfoViewerUseCase {
  constructor(
    @inject(WorkerProfileInfoService)
    private readonly workerProfileInfoService: WorkerProfileInfoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<ViewProfileInfoResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (isOfficialWhatsappWorker(worker.type?.id)) {
      return null;
    }

    return this.workerProfileInfoService.viewWorkerProfileInfo(workerId);
  }
}
