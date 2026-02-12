import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListTransferSectorsResponse } from '@core/schema/chat/listTransferSectors/response.schema';

@injectable()
export class ChatTransferSectorsListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(accountId: string): Promise<ListTransferSectorsResponse> {
    return this.sectorService.listSectorsForTransfer(accountId);
  }
}
