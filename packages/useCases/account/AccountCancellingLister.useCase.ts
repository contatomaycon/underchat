import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountCancellingFinalResponse } from '@core/schema/account/listAccountCancelling/response.schema';
import { ListAccountCancellingRequest } from '@core/schema/account/listAccountCancelling/request.schema';

@injectable()
export class AccountCancellingListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountCancellingRequest
  ): Promise<ListAccountCancellingFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountCancelling(
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
