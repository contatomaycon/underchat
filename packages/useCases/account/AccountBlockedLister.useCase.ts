import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountBlockedFinalResponse } from '@core/schema/account/listAccountBlocked/response.schema';
import { ListAccountBlockedRequest } from '@core/schema/account/listAccountBlocked/request.schema';

@injectable()
export class AccountBlockedListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountBlockedRequest
  ): Promise<ListAccountBlockedFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountBlocked(
      perPage,
      currentPage,
      query
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
