import { injectable } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';
import { ListChatWorkersResponse } from '@core/schema/chat/listChatWorkers/response.schema';

@injectable()
export class ChatWorkersListerUseCase {
  constructor(private readonly workerService: WorkerService) {}

  async execute(accountId: string): Promise<ListChatWorkersResponse> {
    const workers = await this.workerService.listAllWorkers(accountId);

    return workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      number: worker.number,
    }));
  }
}
