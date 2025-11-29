import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListChatboxSectorsResponse } from '@core/schema/chatbox/listSectors/response.schema';

@injectable()
export class ChatboxSectorsListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListChatboxSectorsResponse> {
    return this.sectorService.listSectorsForTransfer(
      accountId,
      isAdministrator
    );
  }
}
