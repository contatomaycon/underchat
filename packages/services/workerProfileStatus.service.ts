import { injectable } from 'tsyringe';
import { WorkerProfileStatusCreatorRepository } from '@core/repositories/worker/WorkerProfileStatusCreator.repository';
import { WorkerProfileStatusListerRepository } from '@core/repositories/worker/WorkerProfileStatusLister.repository';
import { ProfileStatusPhoto } from '@core/schema/worker/listProfileStatusPhotos/response.schema';
import { WorkerProfileStatusPhoto } from '@core/schema/worker/uploadProfileStatusPhotos/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class WorkerProfileStatusService {
  constructor(
    private readonly workerProfileStatusCreatorRepository: WorkerProfileStatusCreatorRepository,
    private readonly workerProfileStatusListerRepository: WorkerProfileStatusListerRepository,
    private readonly storageService: StorageService
  ) {}

  async uploadProfileStatusPhotos(
    workerId: string,
    accountId: string,
    photos: UploadFileRequest | UploadFileRequest[],
    isPermanent: boolean = false
  ): Promise<WorkerProfileStatusPhoto[]> {
    const photosArray = Array.isArray(photos) ? photos : [photos];

    const uploadPromises = photosArray.map(async (photo) => {
      const uploadResult = await this.storageService.uploadImage(
        photo,
        accountId
      );

      if (!uploadResult) {
        return null;
      }

      const workerProfileStatusId =
        await this.workerProfileStatusCreatorRepository.createWorkerProfileStatus(
          {
            worker_id: workerId,
            url: uploadResult.url,
            is_permanent: isPermanent,
          }
        );

      return {
        worker_profile_status_id: workerProfileStatusId,
        worker_id: workerId,
        url: uploadResult.url,
        is_permanent: isPermanent,
      } as WorkerProfileStatusPhoto;
    });

    const results = await Promise.all(uploadPromises);

    return results.filter(
      (photo): photo is WorkerProfileStatusPhoto => photo !== null
    );
  }

  async listProfileStatusPhotos(
    workerId: string
  ): Promise<ProfileStatusPhoto[]> {
    return this.workerProfileStatusListerRepository.listWorkerProfileStatus(
      workerId
    );
  }
}
