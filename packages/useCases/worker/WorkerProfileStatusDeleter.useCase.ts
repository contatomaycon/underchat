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
    workerProfileStatusId: string,
    accountId: string
  ): Promise<boolean> {
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
