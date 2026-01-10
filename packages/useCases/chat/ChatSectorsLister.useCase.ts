import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListChatSectorsResponse } from '@core/schema/chat/listChatSectors/response.schema';

@injectable()
export class ChatSectorsListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(accountId: string): Promise<ListChatSectorsResponse> {
    const sectors = await this.sectorService.listSectorsForTransfer(accountId);

    return sectors.map((sector) => ({
      id: sector.id,
      name: sector.name,
      color: sector.color ?? null,
    }));
  }
}
