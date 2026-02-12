import { injectable, inject } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';
import { ListChatWorkersResponse } from '@core/schema/chat/listChatWorkers/response.schema';

@injectable()
export class ChatWorkersListerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListChatWorkersResponse> {
    const workers = await this.workerService.listAllWorkers(accountId);

    const filteredWorkers =
      userChannels.length > 0
        ? workers.filter((w) => userChannels.some((c) => c.id === w.id))
        : workers;

    return filteredWorkers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      number: worker.number,
    }));
  }
}
