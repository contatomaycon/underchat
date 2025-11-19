import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';

@injectable()
export class WorkerProfileStatusDeleterUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    workerProfileStatusId: string
  ): Promise<boolean> {
    const result =
      await this.workerProfileStatusService.deleteProfileStatusPhoto(
        workerProfileStatusId
      );

    if (!result) {
      throw new Error(t('profile_status_delete_error'));
    }

    return result;
  }
}
