import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';
import { ListSectorFinalResponse } from '@core/schema/sector/listSector/response.schema';
import { SectorService } from '@core/services/sector.service';
import { AccountService } from '@core/services/account.service';

@injectable()
export class SectorListerUseCase {
  constructor(
    private readonly sectorService: SectorService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListSectorRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListSectorFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const [results, total] = await this.sectorService.listSector(
      perPage,
      currentPage,
      query,
      accountId,
      isAdministrator
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
