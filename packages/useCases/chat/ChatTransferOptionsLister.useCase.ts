import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { WorkerService } from '@core/services/worker.service';
import { ListTransferOptionsResponse } from '@core/schema/chat/listTransferOptions/response.schema';

@injectable()
export class ChatTransferOptionsListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListTransferOptionsResponse> {
    const [sectors, workers] = await Promise.all([
      this.sectorService.listAllSectors(accountId),
      this.workerService.listAllWorkers(accountId),
    ]);

    const filteredWorkers =
      userChannels.length > 0
        ? workers.filter((w) => userChannels.some((c) => c.id === w.id))
        : workers;

    return {
      sectors,
      workers: filteredWorkers,
      chatbots: [],
    };
  }
}
