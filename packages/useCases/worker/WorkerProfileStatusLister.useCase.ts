import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { WorkerService } from '@core/services/worker.service';
import { ListProfileStatusResponse } from '@core/schema/worker/listProfileStatus/response.schema';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class WorkerProfileStatusListerUseCase {
  constructor(
    @inject(WorkerProfileStatusService)
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<ListProfileStatusResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    assertNonOfficialRuntimeFeature(
      worker.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    return this.workerProfileStatusService.listProfileStatus(workerId);
  }
}
