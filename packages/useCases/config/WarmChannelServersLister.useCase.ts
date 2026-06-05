import { injectable, inject } from 'tsyringe';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { ListWarmChannelServersResponse } from '@core/schema/config/listWarmChannelServers/response.schema';

@injectable()
export class WarmChannelServersListerUseCase {
  constructor(
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository
  ) {}

  async execute(): Promise<ListWarmChannelServersResponse> {
    const results =
      await this.workerServerListerRepository.listWarmPoolEligibleServers();

    return { results };
  }
}
