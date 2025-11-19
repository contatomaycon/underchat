import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';

@injectable()
export class WorkerProfileStatusUpdaterUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    workerProfileStatusId: string,
    isPermanent: boolean
  ): Promise<boolean> {
    const result = await this.workerProfileStatusService.updateIsPermanent(
      workerProfileStatusId,
      isPermanent
    );

    if (!result) {
      throw new Error(t('profile_status_update_error'));
    }

    return result;
  }
}
