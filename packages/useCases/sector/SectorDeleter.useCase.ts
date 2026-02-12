import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorDeleterUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    sectorId: string,
    accountId: string
  ): Promise<boolean> {
    const exists = await this.sectorService.existsSectorById(
      sectorId,
      accountId
    );

    if (!exists) {
      throw new Error(t('sector_not_found'));
    }

    const deleteSectorById = await this.sectorService.deleteSectorById(
      sectorId,
      accountId
    );

    if (!deleteSectorById) {
      throw new Error(t('sector_deleter_error'));
    }

    return true;
  }
}
