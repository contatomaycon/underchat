import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerProfileStatusViewerRepository } from '@core/repositories/worker/WorkerProfileStatusViewer.repository';

@injectable()
export class WorkerProfileStatusDeleterUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    private readonly workerService: WorkerService,
    private readonly workerProfileStatusViewerRepository: WorkerProfileStatusViewerRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    workerProfileStatusId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    const profileStatus =
      await this.workerProfileStatusViewerRepository.viewWorkerProfileStatusById(
        workerProfileStatusId
      );

    if (!profileStatus) {
      throw new Error(t('profile_status_not_found'));
    }

    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      profileStatus.worker_id
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

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
