import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { WorkerService } from '@core/services/worker.service';
import { ListTransferOptionsResponse } from '@core/schema/chat/listTransferOptions/response.schema';

@injectable()
export class ChatTransferOptionsListerUseCase {
  constructor(
    private readonly sectorService: SectorService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListTransferOptionsResponse> {
    const [sectors, workers] = await Promise.all([
      this.sectorService.listAllSectors(accountId, isAdministrator),
      this.workerService.listAllWorkers(accountId, isAdministrator),
    ]);

    return {
      sectors,
      workers,
    };
  }
}
