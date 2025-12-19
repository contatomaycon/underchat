import { injectable } from 'tsyringe';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { AccountService } from '@core/services/account.service';
import { ListAccountExpiredFinalResponse } from '@core/schema/account/listAccountExpired/response.schema';
import { ListAccountExpiredRequest } from '@core/schema/account/listAccountExpired/request.schema';

@injectable()
export class AccountExpiredListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    query: ListAccountExpiredRequest
  ): Promise<ListAccountExpiredFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const [results, total] = await this.accountService.listAccountExpired(
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
