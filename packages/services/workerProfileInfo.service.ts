import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { StorageService } from '@core/services/storage.service';
import { WorkerProfileInfoViewerRepository } from '@core/repositories/worker/WorkerProfileInfoViewer.repository';
import { WorkerProfileInfoUpserterRepository } from '@core/repositories/worker/WorkerProfileInfoUpserter.repository';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { IUpdateWorkerProfileInfo } from '@core/common/interfaces/IUpdateWorkerProfileInfo';
import { WorkerProfileInfo } from '@core/schema/worker/uploadProfileInfo/response.schema';
import { workerProfileInfo } from '@core/models';

@injectable()
export class WorkerProfileInfoService {
  constructor(
    private readonly storageService: StorageService,
    private readonly workerProfileInfoViewerRepository: WorkerProfileInfoViewerRepository,
    private readonly workerProfileInfoUpserterRepository: WorkerProfileInfoUpserterRepository
  ) {}

  async viewWorkerProfileInfo(
    workerId: string
  ): Promise<WorkerProfileInfo | null> {
    const result =
      await this.workerProfileInfoViewerRepository.viewWorkerProfileInfoByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return this.mapToWorkerProfileInfo(result);
  }

  async upsertWorkerProfileInfo(
    t: TFunction<'translation', undefined>,
    workerId: string,
    accountId: string,
    name?: string | null,
    message?: string | null,
    photo?: UploadFileRequest | null
  ): Promise<WorkerProfileInfo> {
    const updateData = this.buildUpdateData(name, message);
    await this.uploadPhotoIfProvided(photo, accountId, updateData, t);
    await this.performUpsert(workerId, updateData);
    return this.getAndValidateProfileInfo(workerId, t);
  }

  private mapToWorkerProfileInfo(
    result: typeof workerProfileInfo.$inferSelect
  ): WorkerProfileInfo {
    return {
      worker_profile_info_id: result.worker_profile_info_id,
      worker_id: result.worker_id,
      name: result.name,
      message: result.message,
      photo: result.photo,
      created_at: result.created_at || null,
      updated_at: result.updated_at || null,
    };
  }

  private buildUpdateData(
    name?: string | null,
    message?: string | null
  ): IUpdateWorkerProfileInfo {
    const updateData: IUpdateWorkerProfileInfo = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (message !== undefined) {
      updateData.message = message;
    }

    return updateData;
  }

  private async uploadPhotoIfProvided(
    photo: UploadFileRequest | null | undefined,
    accountId: string,
    updateData: IUpdateWorkerProfileInfo,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    if (!photo) {
      return;
    }

    const uploadResult = await this.storageService.uploadImage(
      photo,
      accountId
    );

    if (!uploadResult) {
      throw new Error(t('profile_info_photo_upload_error'));
    }

    updateData.photo = uploadResult.url;
  }

  private async performUpsert(
    workerId: string,
    updateData: IUpdateWorkerProfileInfo
  ): Promise<void> {
    await this.workerProfileInfoUpserterRepository.upsertWorkerProfileInfo(
      workerId,
      updateData
    );
  }

  private async getAndValidateProfileInfo(
    workerId: string,
    t: TFunction<'translation', undefined>
  ): Promise<WorkerProfileInfo> {
    const result =
      await this.workerProfileInfoViewerRepository.viewWorkerProfileInfoByWorkerId(
        workerId
      );

    if (!result) {
      throw new Error(t('profile_info_not_found'));
    }

    return this.mapToWorkerProfileInfo(result);
  }
}
