import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { UpdateProfileStatusRequest } from '@core/schema/worker/updateProfileStatus/request.schema';

@injectable()
export class WorkerProfileStatusUpdaterUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  private normalizeIsPermanent(isPermanent: unknown): boolean {
    if (isPermanent === undefined || isPermanent === null) {
      return false;
    }

    if (typeof isPermanent === 'boolean') {
      return isPermanent;
    }

    if (typeof isPermanent === 'string') {
      return isPermanent.toLowerCase() === 'true' || isPermanent === '1';
    }

    if (
      typeof isPermanent === 'object' &&
      isPermanent !== null &&
      'value' in isPermanent
    ) {
      const value = (isPermanent as { value: unknown }).value;
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        return value.toLowerCase() === 'true' || value === '1';
      }
    }

    return false;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    workerProfileStatusId: string,
    body: UpdateProfileStatusRequest
  ): Promise<boolean> {
    const isPermanent = this.normalizeIsPermanent(body.is_permanent);

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
