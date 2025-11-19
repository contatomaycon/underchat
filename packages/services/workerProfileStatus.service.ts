import { injectable } from 'tsyringe';
import { WorkerProfileStatusCreatorRepository } from '@core/repositories/worker/WorkerProfileStatusCreator.repository';
import { WorkerProfileStatusListerRepository } from '@core/repositories/worker/WorkerProfileStatusLister.repository';
import { WorkerProfileStatusUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusUpdater.repository';
import { WorkerProfileStatusDeleterRepository } from '@core/repositories/worker/WorkerProfileStatusDeleter.repository';
import { WorkerProfileStatusViewerRepository } from '@core/repositories/worker/WorkerProfileStatusViewer.repository';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { WorkerProfileStatus } from '@core/schema/worker/uploadProfileStatus/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';

@injectable()
export class WorkerProfileStatusService {
  constructor(
    private readonly workerProfileStatusCreatorRepository: WorkerProfileStatusCreatorRepository,
    private readonly workerProfileStatusListerRepository: WorkerProfileStatusListerRepository,
    private readonly workerProfileStatusUpdaterRepository: WorkerProfileStatusUpdaterRepository,
    private readonly workerProfileStatusDeleterRepository: WorkerProfileStatusDeleterRepository,
    private readonly workerProfileStatusViewerRepository: WorkerProfileStatusViewerRepository,
    private readonly storageService: StorageService
  ) {}

  async uploadProfileStatus(
    workerId: string,
    accountId: string,
    workerProfileStatusTypeId: string,
    photos?: UploadFileRequest | UploadFileRequest[],
    text?: string,
    caption?: string,
    isPermanent: boolean = false
  ): Promise<WorkerProfileStatus[]> {
    const typeId = workerProfileStatusTypeId as EWorkerProfileStatusType;

    if (typeId === EWorkerProfileStatusType.text) {
      if (!text) {
        throw new Error('TEXT_REQUIRED');
      }

      const workerProfileStatusId =
        await this.workerProfileStatusCreatorRepository.createWorkerProfileStatus(
          {
            worker_id: workerId,
            worker_profile_status_type_id: typeId,
            value: text,
            is_permanent: isPermanent,
          }
        );

      return [
        {
          worker_profile_status_id: workerProfileStatusId,
          worker_id: workerId,
          worker_profile_status_type_id: typeId,
          value: text,
          is_permanent: isPermanent,
        } as WorkerProfileStatus,
      ];
    }

    if (!photos) {
      throw new Error('FILES_REQUIRED');
    }

    const photosArray = Array.isArray(photos) ? photos : [photos];
    const uploadPromises = photosArray.map(async (photo) => {
      let uploadResult;

      if (typeId === EWorkerProfileStatusType.image) {
        uploadResult = await this.storageService.uploadImage(photo, accountId);
      }
      if (typeId === EWorkerProfileStatusType.video) {
        uploadResult = await this.storageService.uploadVideo(photo, accountId);
      }
      if (typeId === EWorkerProfileStatusType.audio) {
        uploadResult = await this.storageService.uploadAudio(photo, accountId);
      }

      if (!uploadResult) {
        throw new Error('INVALID_TYPE');
      }

      let value = uploadResult.url;
      if (
        caption &&
        (typeId === EWorkerProfileStatusType.image ||
          typeId === EWorkerProfileStatusType.video ||
          typeId === EWorkerProfileStatusType.audio)
      ) {
        value = `${uploadResult.url}|${caption}`;
      }

      const workerProfileStatusId =
        await this.workerProfileStatusCreatorRepository.createWorkerProfileStatus(
          {
            worker_id: workerId,
            worker_profile_status_type_id: typeId,
            value,
            is_permanent: isPermanent,
          }
        );

      return {
        worker_profile_status_id: workerProfileStatusId,
        worker_id: workerId,
        worker_profile_status_type_id: typeId,
        value,
        is_permanent: isPermanent,
      } as WorkerProfileStatus;
    });

    const results = await Promise.all(uploadPromises);

    return results.filter(
      (status): status is WorkerProfileStatus => status !== null
    );
  }

  async listProfileStatus(workerId: string): Promise<ProfileStatus[]> {
    return this.workerProfileStatusListerRepository.listWorkerProfileStatus(
      workerId
    );
  }

  async updateIsPermanent(
    workerProfileStatusId: string,
    isPermanent: boolean
  ): Promise<boolean> {
    return this.workerProfileStatusUpdaterRepository.updateIsPermanent(
      workerProfileStatusId,
      isPermanent
    );
  }

  async deleteProfileStatus(workerProfileStatusId: string): Promise<boolean> {
    const profileStatus =
      await this.workerProfileStatusViewerRepository.viewWorkerProfileStatusById(
        workerProfileStatusId
      );

    if (!profileStatus) {
      return false;
    }

    if (
      profileStatus.worker_profile_status_type_id !==
      EWorkerProfileStatusType.text
    ) {
      const url = profileStatus.value.split('|')[0];
      const deleteFromS3 = await this.storageService.deleteImage(url);

      if (!deleteFromS3) {
        return false;
      }
    }

    return this.workerProfileStatusDeleterRepository.deleteWorkerProfileStatus(
      workerProfileStatusId
    );
  }
}
