import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListTransferSectorsResponse } from '@core/schema/chat/listTransferSectors/response.schema';

@injectable()
export class ChatTransferSectorsListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(accountId: string): Promise<ListTransferSectorsResponse> {
    return this.sectorService.listSectorsForTransfer(accountId);
  }
}
