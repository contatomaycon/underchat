import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { WorkerService } from '@core/services/worker.service';
import { ListTransferOptionsResponse } from '@core/schema/chat/listTransferOptions/response.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { filterChannelsForTransferAndForwarding } from '@core/common/functions/transferAndForwardChannelAccess';

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
    userChannels: { id: string; name: string }[] = [],
    actions: IJwtGroupHierarchy[] = []
  ): Promise<ListTransferOptionsResponse> {
    const [sectors, workers] = await Promise.all([
      this.sectorService.listAllSectors(accountId),
      this.workerService.listAllWorkers(accountId),
    ]);

    return {
      sectors,
      workers: filterChannelsForTransferAndForwarding(
        workers,
        userChannels,
        actions
      ),
      chatbots: [],
    };
  }
}
