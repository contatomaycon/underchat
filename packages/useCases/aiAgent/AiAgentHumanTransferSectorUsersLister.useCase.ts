import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListAiAgentHumanTransferSectorUsersResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/response.schema';

@injectable()
export class AiAgentHumanTransferSectorUsersListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    accountId: string,
    sectorId: string
  ): Promise<ListAiAgentHumanTransferSectorUsersResponse> {
    return this.sectorService.listSectorUsersForTransfer(accountId, sectorId);
  }
}
