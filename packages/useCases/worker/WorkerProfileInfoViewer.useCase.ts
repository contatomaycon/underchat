import { injectable } from 'tsyringe';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { ViewProfileInfoResponse } from '@core/schema/worker/viewProfileInfo/response.schema';

@injectable()
export class WorkerProfileInfoViewerUseCase {
  constructor(
    private readonly workerProfileInfoService: WorkerProfileInfoService
  ) {}

  async execute(workerId: string): Promise<ViewProfileInfoResponse> {
    return this.workerProfileInfoService.viewWorkerProfileInfo(workerId);
  }
}
