import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountDeletedFinalResponse } from '@core/schema/account/listAccountDeleted/response.schema';
import { ListAccountDeletedRequest } from '@core/schema/account/listAccountDeleted/request.schema';

@injectable()
export class AccountDeletedListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountDeletedRequest
  ): Promise<ListAccountDeletedFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountDeleted(
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
