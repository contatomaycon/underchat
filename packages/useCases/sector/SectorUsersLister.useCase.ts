import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { SectorService } from '@core/services/sector.service';
import { ListSectorUsersResponse } from '@core/schema/sector/listSectorUsers/response.schema';

@injectable()
export class SectorUsersListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    sectorId: string
  ): Promise<ListSectorUsersResponse[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const sectorExists = await this.sectorService.sectorByIdExists(
      sectorId,
      accountId
    );
    if (!sectorExists) {
      throw new Error(t('sector_not_found'));
    }

    return this.sectorService.listSectorUsers(accountId, sectorId);
  }
}
