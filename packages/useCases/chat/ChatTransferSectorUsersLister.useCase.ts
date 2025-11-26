import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';

@injectable()
export class ChatTransferSectorUsersListerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    accountId: string,
    sectorId: string
  ): Promise<TransferSectorUserResponse[]> {
    return this.sectorService.listSectorUsersForTransfer(accountId, sectorId);
  }
}
