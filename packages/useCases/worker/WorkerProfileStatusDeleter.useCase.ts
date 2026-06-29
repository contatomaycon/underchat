import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerProfileStatusViewerRepository } from '@core/repositories/worker/WorkerProfileStatusViewer.repository';
import { assertNonOfficialRuntimeFeature } from '@core/common/functions/workerOfficialCapabilities';

@injectable()
export class WorkerProfileStatusDeleterUseCase {
  constructor(
    @inject(WorkerProfileStatusService)
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerProfileStatusViewerRepository)
    private readonly workerProfileStatusViewerRepository: WorkerProfileStatusViewerRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    workerProfileStatusId: string,
    accountId: string
  ): Promise<boolean> {
    const profileStatus =
      await this.workerProfileStatusViewerRepository.viewWorkerProfileStatusById(
        workerProfileStatusId
      );

    if (!profileStatus) {
      throw new Error(t('profile_status_not_found'));
    }

    const worker = await this.workerService.viewWorker(
      accountId,
      profileStatus.worker_id
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    assertNonOfficialRuntimeFeature(
      worker.type?.id,
      t('whatsapp_official_runtime_action_not_supported')
    );

    const result = await this.workerProfileStatusService.deleteProfileStatus(
      workerProfileStatusId,
      accountId
    );

    if (!result) {
      throw new Error(t('profile_status_delete_error'));
    }

    return result;
  }
}
