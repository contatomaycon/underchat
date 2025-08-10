import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewSectorResponse } from '@core/schema/sector/viewSector/response.schema';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorViewerUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    sectorId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewSectorResponse | null> {
    const exists = await this.sectorService.existsSectorById(
      sectorId,
      accountId,
      isAdministrator
    );

    if (!exists) {
      throw new Error(t('sector_not_found'));
    }

    return this.sectorService.viewSectorById(
      sectorId,
      accountId,
      isAdministrator
    );
  }
}
