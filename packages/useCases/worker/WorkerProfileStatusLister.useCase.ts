import { injectable } from 'tsyringe';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { ListProfileStatusPhotosResponse } from '@core/schema/worker/listProfileStatusPhotos/response.schema';

@injectable()
export class WorkerProfileStatusListerUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  async execute(workerId: string): Promise<ListProfileStatusPhotosResponse> {
    return this.workerProfileStatusService.listProfileStatusPhotos(workerId);
  }
}
