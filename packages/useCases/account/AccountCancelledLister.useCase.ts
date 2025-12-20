import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountCancelledFinalResponse } from '@core/schema/account/listAccountCancelled/response.schema';
import { ListAccountCancelledRequest } from '@core/schema/account/listAccountCancelled/request.schema';

@injectable()
export class AccountCancelledListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountCancelledRequest
  ): Promise<ListAccountCancelledFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountCancelled(
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
