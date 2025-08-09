import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ListSectorRoleAccountSectorResponse } from '@core/schema/sector/listSectorRoleAccountSector/response.schema';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class SectorRoleAccountSectorListerUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly sectorService: SectorService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    sectorId: string
  ): Promise<ListSectorRoleAccountSectorResponse[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const sectorExists =
      await this.sectorService.existsSectorRoleById(sectorId);
    if (!sectorExists) {
      return [];
    }

    return this.sectorService.listSectorRoleAccountSectorById(
      accountId,
      sectorId
    );
  }
}
