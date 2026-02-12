import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ListUserSectorsResponse } from '@core/schema/user/listUserSectors/response.schema';

@injectable()
export class UserSectorsListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(accountId: string): Promise<ListUserSectorsResponse> {
    const sectors = await this.sectorService.listAllSectors(accountId);

    return sectors.map((sector) => ({
      sector_id: sector.sector_id,
      name: sector.name,
      color: sector.color,
    }));
  }
}
