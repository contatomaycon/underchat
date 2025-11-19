import { injectable } from 'tsyringe';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { ListProfileStatusResponse } from '@core/schema/worker/listProfileStatus/response.schema';

@injectable()
export class WorkerProfileStatusListerUseCase {
  constructor(
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  async execute(workerId: string): Promise<ListProfileStatusResponse> {
    return this.workerProfileStatusService.listProfileStatus(workerId);
  }
}
