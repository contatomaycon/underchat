import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountTestsFinalResponse } from '@core/schema/account/listAccountTests/response.schema';
import { ListAccountTestsRequest } from '@core/schema/account/listAccountTests/request.schema';

@injectable()
export class AccountTestsListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountTestsRequest
  ): Promise<ListAccountTestsFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountTests(
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
