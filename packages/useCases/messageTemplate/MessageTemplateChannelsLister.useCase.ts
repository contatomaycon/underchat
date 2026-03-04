import { injectable, inject } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';

type ListMessageTemplateChannelsResponse = Array<{
  id: string;
  name: string;
  number: string | null;
}>;

@injectable()
export class MessageTemplateChannelsListerUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListMessageTemplateChannelsResponse> {
    const workers = await this.workerService.listAllWorkers(accountId);

    const filteredWorkers =
      userChannels.length > 0
        ? workers.filter((worker) =>
            userChannels.some((channel) => channel.id === worker.id)
          )
        : workers;

    return filteredWorkers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      number: worker.number,
    }));
  }
}
