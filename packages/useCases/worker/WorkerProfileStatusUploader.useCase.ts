import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { UploadProfileStatusPhotosResponse } from '@core/schema/worker/uploadProfileStatusPhotos/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

@injectable()
export class WorkerProfileStatusUploaderUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  private validatePhotos(
    t: TFunction<'translation', undefined>,
    photos: unknown
  ): UploadFileRequest | UploadFileRequest[] {
    if (!photos) {
      throw new Error(t('profile_status_no_photos_selected'));
    }

    if (Array.isArray(photos) && photos.length === 0) {
      throw new Error(t('profile_status_no_photos_selected'));
    }

    return photos as UploadFileRequest | UploadFileRequest[];
  }

  private normalizeIsPermanent(isPermanent: unknown): boolean {
    if (isPermanent === undefined || isPermanent === null) {
      return false;
    }

    if (typeof isPermanent !== 'object' || !('value' in isPermanent)) {
      return false;
    }

    const value = (isPermanent as { value: boolean | string }).value;

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return false;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    photos: unknown,
    isPermanent?: unknown
  ): Promise<UploadProfileStatusPhotosResponse> {
    const validatedPhotos = this.validatePhotos(t, photos);
    const normalizedIsPermanent = this.normalizeIsPermanent(isPermanent);

    const result =
      await this.workerProfileStatusService.uploadProfileStatusPhotos(
        workerId,
        accountId,
        validatedPhotos,
        normalizedIsPermanent
      );

    if (!result || result.length === 0) {
      throw new Error(t('profile_status_upload_error'));
    }

    return result;
  }
}
