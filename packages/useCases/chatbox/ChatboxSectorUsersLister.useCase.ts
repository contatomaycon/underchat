import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ChatboxSectorUserResponse } from '@core/schema/chatbox/listSectorUsers/response.schema';

@injectable()
export class ChatboxSectorUsersListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    accountId: string,
    sectorId: string
  ): Promise<ChatboxSectorUserResponse[]> {
    return this.sectorService.listSectorUsersForTransfer(accountId, sectorId);
  }
}
