import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountFinalResponse } from '@core/schema/account/listAccount/response.schema';
import { ListAccountRequest } from '@core/schema/account/listAccount/request.schema';

@injectable()
export class AccountListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListAccountRequest,
    isAdministrator: boolean
  ): Promise<ListAccountFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const [results, total] = await this.accountService.listAccounts(
      perPage,
      currentPage,
      query,
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
