import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EditSectorParamsBody } from '@core/schema/sector/editSector/request.schema';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorUpdaterUseCase {
  constructor(private readonly sectorService: SectorService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    sectorId: string,
    input: EditSectorParamsBody,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    const exists = await this.sectorService.existsSectorById(
      sectorId,
      accountId,
      isAdministrator
    );

    if (!exists) {
      throw new Error(t('sector_not_found'));
    }

    if (input.sector_status_id) {
      const existsSectorStatus =
        await this.sectorService.existsSectorStatusById(input.sector_status_id);
      if (!existsSectorStatus) {
        throw new Error(t('sector_status_not_found'));
      }
    }

    const sectorUpdate = await this.sectorService.updateSectorById(
      sectorId,
      input,
      accountId
    );

    if (!sectorUpdate) {
      throw new Error(t('sector_update_error'));
    }

    return true;
  }
}
