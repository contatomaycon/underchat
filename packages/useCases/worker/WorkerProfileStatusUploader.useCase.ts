import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { WorkerService } from '@core/services/worker.service';
import { UploadProfileStatusResponse } from '@core/schema/worker/uploadProfileStatus/response.schema';
import { UploadProfileStatusRequest } from '@core/schema/worker/uploadProfileStatus/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { VisibilityType } from '@core/common/interfaces/IVisibilityData';

@injectable()
export class WorkerProfileStatusUploaderUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService,
    private readonly workerService: WorkerService
  ) {}

  private normalizeField(field: unknown): string | undefined {
    if (field === undefined || field === null) return undefined;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      return String((field as { value: unknown }).value);
    }
    return String(field);
  }

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_status_file_size_exceeded', { max: '16 MB' }));
    }
  }

  private async validatePhotos(
    t: TFunction<'translation', undefined>,
    photos: unknown
  ): Promise<UploadFileRequest | UploadFileRequest[]> {
    if (!photos) {
      throw new Error(t('profile_status_no_photos_selected'));
    }

    if (Array.isArray(photos) && photos.length === 0) {
      throw new Error(t('profile_status_no_photos_selected'));
    }

    const photosArray = Array.isArray(photos) ? photos : [photos];

    for (const photo of photosArray) {
      await this.validateFileSize(photo as UploadFileRequest, t);
    }

    return photos as UploadFileRequest | UploadFileRequest[];
  }

  private normalizeArrayField(field: unknown): string[] | undefined {
    if (field === undefined || field === null) return undefined;
    if (Array.isArray(field)) {
      return field.filter((item): item is string => typeof item === 'string');
    }
    if (typeof field === 'string') {
      return [field];
    }
    return undefined;
  }

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
    accountId: string,
    isAdministrator: boolean,
    workerId: string,
    body: UploadProfileStatusRequest
  ): Promise<UploadProfileStatusResponse> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const workerProfileStatusTypeId = this.normalizeField(
      body.worker_profile_status_type_id
    );

    if (!workerProfileStatusTypeId) {
      throw new Error(t('profile_status_type_required'));
    }

    const photos = body.photos;
    const text = this.normalizeField(body.text);
    const caption = this.normalizeField(body.caption);
    const isPermanent = this.normalizeIsPermanent(body.is_permanent);
    const visibilityType = this.normalizeField(
      body.visibility_type
    ) as VisibilityType;
    const contactGroupIds = this.normalizeArrayField(body.contact_group_ids);
    const contactIds = this.normalizeArrayField(body.contact_ids);

    if (!visibilityType) {
      throw new Error(t('profile_status_visibility_required'));
    }

    const validatedPhotos = photos
      ? await this.validatePhotos(t, photos)
      : undefined;

    const result = await this.workerProfileStatusService.uploadProfileStatus(
      t,
      workerId,
      accountId,
      workerProfileStatusTypeId,
      validatedPhotos,
      text,
      caption,
      isPermanent,
      {
        visibility_type: visibilityType,
        contact_group_ids: contactGroupIds,
        contact_ids: contactIds,
      }
    );

    if (!result || result.length === 0) {
      throw new Error(t('profile_status_upload_error'));
    }

    return result;
  }
}
