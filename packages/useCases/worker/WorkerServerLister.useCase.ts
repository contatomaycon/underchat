import { injectable } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';
import { ListWorkerServersResponse } from '@core/schema/worker/listWorkerServers/response.schema';

@injectable()
export class WorkerServerListerUseCase {
  constructor(private readonly workerService: WorkerService) {}

  async execute(): Promise<ListWorkerServersResponse> {
    const results = await this.workerService.listWorkerServers();

    return { results };
  }
}
