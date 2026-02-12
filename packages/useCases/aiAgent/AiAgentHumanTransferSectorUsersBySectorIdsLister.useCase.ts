import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListAiAgentHumanTransferSectorUsersResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/response.schema';

@injectable()
export class AiAgentHumanTransferSectorUsersBySectorIdsListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(
    accountId: string,
    sectorIds: string[]
  ): Promise<ListAiAgentHumanTransferSectorUsersResponse> {
    return this.sectorService.listSectorUsersForTransferBySectorIds(
      accountId,
      sectorIds
    );
  }
}
