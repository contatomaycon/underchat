import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListAiAgentHumanTransferSectorsResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectors/response.schema';

@injectable()
export class AiAgentHumanTransferSectorsListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    accountId: string
  ): Promise<ListAiAgentHumanTransferSectorsResponse> {
    return this.sectorService.listSectorsForTransfer(accountId);
  }
}
